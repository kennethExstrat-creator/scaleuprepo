/**
 * Signs in as an E2E account with the publishable key (like the browser does): password, then the
 * TOTP challenge, so the session is aal2 and RLS / RPC checks apply exactly as for the real user.
 * Used to establish a flow's preconditions when an earlier flow failed, and for API-level checks
 * (e.g. a contributor's submit being refused by the database).
 */
import type { AnyClient } from "./supabase";
import { publicClient } from "./supabase";
import { nextTotpCode } from "./totp-ledger";
import type { UserState } from "./state";

export async function apiSignIn(user: UserState): Promise<AnyClient> {
  const sb = publicClient();
  const signIn = await sb.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signIn.error) throw new Error(`API sign-in as ${user.email} failed: ${signIn.error.message}`);
  if (!user.totpSecret) throw new Error(`${user.email} has no TOTP secret in the run state.`);
  const factors = await sb.auth.mfa.listFactors();
  if (factors.error) throw new Error(`Listing factors of ${user.email} failed: ${factors.error.message}`);
  const factor = factors.data.totp[0];
  if (!factor) throw new Error(`${user.email} has no verified TOTP factor.`);
  const code = await nextTotpCode(user.id, user.totpSecret);
  const verified = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verified.error) throw new Error(`TOTP verification for ${user.email} failed: ${verified.error.message}`);
  return sb;
}

/** Ends the API session (revokes only this session's refresh token). */
export async function apiSignOut(sb: AnyClient): Promise<void> {
  await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
}

export async function withApiUser<T>(user: UserState, fn: (sb: AnyClient) => Promise<T>): Promise<T> {
  const sb = await apiSignIn(user);
  try {
    return await fn(sb);
  } finally {
    await apiSignOut(sb);
  }
}
