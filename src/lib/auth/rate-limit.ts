// App-level throttling for calls that spend Supabase Auth's per-IP budget.
//
// Supabase counts Auth rate limits per calling IP, and every call comes from this app server, so
// one client could otherwise use up the budget for everybody (30 sign-ins, 150 token refreshes
// and 30 link verifications per 5 minutes by default). These limits make a single client hit
// our own, smaller limits first; Supabase is not called for a throttled attempt.
//
// Fixed-window counters held in memory, shared by every bundle in this server process. With
// several app instances each instance counts separately; move the counters into the database
// (an RPC) if that ever matters. Also raise the Supabase dashboard limits (Auth > Rate Limits)
// for about 150 users behind one egress IP.
//
// Pure module (no Next.js imports): safe for the proxy, route handlers and Server Actions.

const MINUTE = 60 * 1000;

export type RateLimitRule = { readonly id: string; readonly limit: number; readonly windowMs: number };

export const RATE_LIMITS = {
  /**
   * Password sign-ins (and current-password checks) from one client IP. Leaves room for a whole
   * office behind one NAT address signing in at the start of the day.
   */
  signInPerIp: { id: "sign-in:ip", limit: 20, windowMs: 5 * MINUTE },
  /** Password sign-ins for one email address, from anywhere. */
  signInPerEmail: { id: "sign-in:email", limit: 10, windowMs: 15 * MINUTE },
  /** Password-reset emails requested from one client IP. */
  passwordResetPerIp: { id: "password-reset:ip", limit: 5, windowMs: 15 * MINUTE },
  /** Password-reset emails for one email address. */
  passwordResetPerEmail: { id: "password-reset:email", limit: 3, windowMs: 60 * MINUTE },
  /** Email-link verifications and PKCE code exchanges from one client IP. */
  emailLinkPerIp: { id: "email-link:ip", limit: 10, windowMs: 5 * MINUTE },
  /** Session token refreshes the proxy performs for one client IP. */
  tokenRefreshPerIp: { id: "token-refresh:ip", limit: 30, windowMs: 5 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

/** Upper bound on tracked keys; the oldest are evicted first. */
const MAX_KEYS = 20_000;
const STORE_KEY = Symbol.for("scaleup.auth.rateLimits");

function store(): Map<string, Bucket> {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: Map<string, Bucket> };
  holder[STORE_KEY] ??= new Map();
  return holder[STORE_KEY];
}

/**
 * Counts one attempt against every `[rule, key]` pair, but only when none of them is already
 * at its limit (a throttled attempt consumes nothing). Keys are normalised (trimmed, lower-case).
 *
 * @example consumeRateLimits([[RATE_LIMITS.signInPerIp, ip], [RATE_LIMITS.signInPerEmail, email]])
 */
export function consumeRateLimits(
  checks: ReadonlyArray<readonly [RateLimitRule, string]>,
  now: number = Date.now(),
): RateLimitResult {
  const buckets = store();
  const entries = checks.map(([rule, key]) => {
    const id = `${rule.id}:${key.trim().toLowerCase()}`;
    const current = buckets.get(id);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + rule.windowMs };
    return { id, rule, bucket };
  });

  const blocked = entries.filter(({ rule, bucket }) => bucket.count >= rule.limit);
  if (blocked.length > 0) {
    const resetAt = Math.max(...blocked.map(({ bucket }) => bucket.resetAt));
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
  }

  for (const { id, bucket } of entries) {
    bucket.count += 1;
    buckets.delete(id); // re-insert so Map order tracks recency for eviction
    buckets.set(id, bucket);
  }
  evict(buckets, now);
  return { ok: true };
}

/** Single-rule shorthand for `consumeRateLimits`. */
export function consumeRateLimit(rule: RateLimitRule, key: string, now: number = Date.now()): RateLimitResult {
  return consumeRateLimits([[rule, key]], now);
}

/** Clears every counter (tests only). */
export function resetRateLimits(): void {
  store().clear();
}

function evict(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size <= MAX_KEYS) return;
  for (const [id, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(id);
  }
  for (const id of buckets.keys()) {
    if (buckets.size <= MAX_KEYS) break;
    buckets.delete(id);
  }
}

type HeaderReader = { get(name: string): string | null };

/**
 * Best-effort client IP for throttling: `x-real-ip`, else the first `x-forwarded-for` hop.
 * Only trustworthy when the host overwrites these headers (Vercel does; behind nginx set
 * `proxy_set_header X-Real-IP $remote_addr`). Without such a proxy a client can vary them, so
 * the per-email limits remain the backstop for sign-ins.
 */
export function clientIp(headers: HeaderReader): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 100);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 100) : "unknown";
}
