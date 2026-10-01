"use server";

// Server Actions of /admin/funds (M1, BRD A1): only Super Admins create and edit funds (RLS agrees:
// funds_insert / funds_update need super_admin). Codes are unique and upper case (funds_code_key).

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { assertScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { fundSchema, updateFundSchema } from "./_components/fund-schema";

const CODE_TAKEN = "Another fund already uses this code.";

function codeTakenOr(error: PostgrestError): PostgrestError | ActionError {
  return error.code === "23505" ? new ActionError(MESSAGES.invalid, { code: CODE_TAKEN }) : error;
}

function revalidateFundPages(): void {
  revalidatePath("/admin/funds");
  revalidatePath("/admin/companies");
}

export async function createFundAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = fundSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("funds")
      .insert({
        code: values.code,
        name: values.name,
        legal_name: values.legalName,
        description: values.description,
        is_active: values.isActive,
      })
      .select("id")
      .single();
    if (error) throw codeTakenOr(error);
    revalidateFundPages();
    return ok({ id: data.id });
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateFundAction(input: unknown): Promise<ActionResult> {
  try {
    await assertScaleUp(["super_admin"]);
    const values = updateFundSchema.parse(input);
    const sb = await createClient();
    const { data, error } = await sb
      .from("funds")
      .update({
        code: values.code,
        name: values.name,
        legal_name: values.legalName,
        description: values.description,
        is_active: values.isActive,
      })
      .eq("id", values.id)
      .select("id");
    if (error) throw codeTakenOr(error);
    if (data.length === 0) throw new ActionError(MESSAGES.notFound);
    revalidateFundPages();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
