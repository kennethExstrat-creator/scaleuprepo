"use server";

import { z } from "zod";

import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canExport } from "@/lib/auth/permissions";
import { assertScaleUp } from "@/lib/auth/session";
import { listDocumentPackOptions } from "@/lib/exports/documents-data";
import type { DocumentPackOptions } from "@/lib/exports/documents-zip";
import { createClient } from "@/lib/supabase/server";

const companySchema = z.guid({ error: "Choose a company." });

/**
 * The period closes of a company with their document counts, for the document pack card on
 * /admin/exports. Read-only (nothing to revalidate). ScaleUp staff, any role (§1 Export).
 */
export async function getDocumentPackOptions(companyId: unknown): Promise<ActionResult<DocumentPackOptions>> {
  try {
    const ctx = await assertScaleUp();
    if (!canExport(ctx)) throw new ActionError(MESSAGES.permission);
    const id = companySchema.parse(companyId).toLowerCase();
    const sb = await createClient();
    return ok(await listDocumentPackOptions(sb, id));
  } catch (e) {
    return toActionError(e);
  }
}
