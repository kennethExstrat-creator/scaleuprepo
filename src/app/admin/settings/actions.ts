"use server";

// Server Action of /admin/settings (module M4, BRD A5, B11, B12, B25, B27, B29): Super Admins update the
// platform settings (RLS: platform_settings_update needs super_admin; CHECK constraints keep the values in
// range). Only the changed columns are written, and only when nobody else saved in between (the form sends
// the `updated_at` it loaded). Changing the terms version makes everyone accept the terms again — the
// Super Admin included — so that save ends on /terms.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ActionError, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { assertScaleUp } from "@/lib/auth/session";
import { getPlatformSettings } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

import { MFA_ALWAYS_ON_MESSAGE, settingsFromRow, settingsUpdate, updateSettingsSchema } from "./_lib/settings-model";

const STALE_MESSAGE =
  "Someone else changed the settings while you were editing. Reload the page to see their changes, then try again.";

/**
 * Saves the platform settings. Returns `{ changed: false }` when nothing differs from the saved row;
 * redirects to /terms after a terms version change (the action promise then rejects with Next.js's redirect).
 */
export async function updateSettingsAction(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const { expectedUpdatedAt, ...values } = updateSettingsSchema.parse(input);
    const sb = await createClient();
    const current = await getPlatformSettings(sb);
    const update = settingsUpdate(settingsFromRow(current), values);
    // BRD §11, B11: two-factor authentication is required for everyone; it can be turned (back) on here,
    // never off (a lost authenticator is handled per person with the 2FA reset on /admin/users).
    if (update.require_mfa === false) throw new ActionError(MFA_ALWAYS_ON_MESSAGE);
    if (Object.keys(update).length === 0) return ok({ changed: false });
    if (current.updated_at !== expectedUpdatedAt) throw new ActionError(STALE_MESSAGE);

    const { data, error } = await sb
      .from("platform_settings")
      .update(update)
      .eq("id", 1)
      .eq("updated_at", expectedUpdatedAt)
      .select("id");
    if (error) throw error;
    // No row: another save got in first (the role was checked above, so it is not RLS).
    if (data.length === 0) throw new ActionError(STALE_MESSAGE);

    revalidatePath("/admin/settings");
    revalidatePath("/admin/cycles");
    revalidatePath("/admin/tracker");
    if (update.terms_version === undefined) return ok({ changed: true });
  } catch (e) {
    return toActionError(e);
  }
  // The new terms version applies to the Super Admin too: accept it now (redirect outside the try block).
  redirect("/terms");
}
