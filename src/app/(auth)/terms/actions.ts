"use server";

import { redirect } from "next/navigation";

import { toActionError } from "@/lib/actions/result";
import { getAccessContext, getAuthSettings, type AccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type AcceptTermsState = { error: string | null };

/** Records acceptance of the current terms version (rpc accept_terms), then continues to "/". */
export async function acceptTermsAction(_previous: AcceptTermsState, formData: FormData): Promise<AcceptTermsState> {
  if (formData.get("accept") !== "on") {
    return { error: "Tick the box to confirm you have read and accept the terms." };
  }

  let ctx: AccessContext | null;
  try {
    ctx = await getAccessContext();
  } catch (e) {
    const result = toActionError(e); // e.g. Supabase Auth unreachable: keep the user on the page
    return { error: result.ok ? null : result.error };
  }
  if (!ctx) return { error: "Your session has expired. Please sign in again." };
  if (!ctx.isActive) return { error: "Your account is inactive. Please contact ScaleUp." };
  if (ctx.mfaRequired && ctx.aal !== "aal2") redirect("/mfa");

  // The version comes from the server, never from the form; the hidden field only detects
  // that the terms changed while the page was open.
  const { termsVersion } = await getAuthSettings();
  if (formData.get("version") !== termsVersion) {
    return { error: "The terms have just been updated. Please review them again before accepting." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_terms", { p_version: termsVersion });
  if (error) {
    const result = toActionError(error);
    return { error: result.ok ? null : result.error };
  }

  redirect("/");
}
