// Validation for user-controlled redirect targets (`?next=`), to prevent open redirects.
// Pure module: usable from the proxy, Server Components, Server Actions, route handlers and
// Client Components.

const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

/** Paths that must never be a post-sign-in destination (they would loop or sign out). */
const DISALLOWED_PREFIXES = ["/login", "/auth/", "/mfa", "/forgot-password"];

/**
 * Returns `raw` when it is a same-origin relative path (starts with "/", not "//" or "/\",
 * no control characters or backslashes), normalised; otherwise `fallback`.
 *
 * @example safeNextPath("/admin/tracker?fund=SV1") // "/admin/tracker?fund=SV1"
 * @example safeNextPath("//evil.example")          // "/"
 * @example safeNextPath("https://evil.example")    // "/"
 */
export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (value === "" || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Browsers treat "\" like "/" and strip tabs/newlines, so reject them outright.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  // Re-check after normalisation: "/.//evil.example" normalises to "//evil.example".
  const normalised = `${url.pathname}${url.search}${url.hash}`;
  if (!normalised.startsWith("/") || normalised.startsWith("//")) return fallback;
  if (DISALLOWED_PREFIXES.some((prefix) => normalised === prefix || normalised.startsWith(prefix))) {
    return fallback;
  }
  return normalised;
}

/** First value of a search param (`string | string[] | undefined`) as a string, or undefined. */
export function firstParam(value: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Builds a path with a validated `next` param, e.g. `withNext("/mfa", "/portal")` → "/mfa?next=%2Fportal". */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = next ? safeNextPath(next, "") : "";
  if (!safe || safe === "/") return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}next=${encodeURIComponent(safe)}`;
}
