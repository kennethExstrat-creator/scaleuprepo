"use server";

// Documents and period closes (BRD C4, §6.1; docs/ARCHITECTURE.md §2.2, §2.4, §2.8, §6 "Period close").
//
// Upload flow (§2.8): prepareDocumentUpload checks the permission and signs an upload to the exact
// storage path the database accepts → the browser uploads the file with `uploadToSignedUrl` → saveDocument
// inserts the `documents` row (the database checks the path, that the object exists, and assigns the
// version). Both signing and inserting use the caller's RLS client, so Storage and the database apply
// their own policies too. confirmPeriodClose / reopenPeriodClose call the RPCs of the same names.
//
// Every action re-checks the session and the caller's rights (the database enforces them as well).

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import {
  confirmCloseSchema,
  prepareUploadSchema,
  reopenCloseSchema,
  saveDocumentSchema,
} from "@/components/documents/action-schemas";
import {
  buildDocumentPath,
  documentMimeType,
  DOCUMENTS_BUCKET,
  isDocumentPathFor,
  storageErrorMessage,
} from "@/components/documents/document-rules";
import { deriveRestatement, type RestatedTotals } from "@/components/documents/totals";
import { liveCloseTotals } from "@/components/documents/view-model";
import { ActionError, MESSAGES, ok, toActionError, type ActionResult } from "@/lib/actions/result";
import { canConfirmPeriodClose, canEnterData, canReopenPeriodClose } from "@/lib/auth/permissions";
import { assertCanViewCompany, assertScaleUp, assertUser } from "@/lib/auth/session";
import { getCompany, getFinancialSeries } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";
import type { DocumentType, PeriodCloseStatus } from "@/lib/types/enums";

type Client = SupabaseClient<Database>;

/** Where the browser uploads the file (`storage.from(bucket).uploadToSignedUrl(path, token, file)`). */
export type DocumentUploadTarget = { bucket: string; path: string; token: string; contentType: string };

/** The documents row saved for an upload. */
export type SavedDocument = { id: string; version: number; docType: DocumentType };

type CloseRow = {
  id: string;
  label: string;
  status: PeriodCloseStatus;
  period_start: string;
  period_end: string;
};

const MESSAGE_CLOSE_NOT_FOUND = "That period close was not found. Please reload the page.";
const MESSAGE_UPLOAD_NOT_ALLOWED = "Only the company's team, or a Fund Admin on its behalf, can upload documents.";
const MESSAGE_CONFIRM_NOT_ALLOWED = "Only the company owner, or a Fund Admin on their behalf, can confirm a period close.";
const MESSAGE_REASON_REQUIRED = "Please give a reason for restating the totals.";

/** The database's wording for exited and written-off companies (BRD B15, B21). */
function readOnlyMessage(companyName: string): string {
  return `${companyName} is no longer an active portfolio company, so its records are read-only.`;
}

/** Refreshes the documents pages of the company (portal) and the ScaleUp documents page. */
function revalidateDocuments(companyId: string): void {
  revalidatePath(`/portal/${companyId}/documents`);
  revalidatePath("/admin/documents");
}

async function requireCompany(sb: Client, companyId: string): Promise<CompanyRow> {
  const company = await getCompany(sb, companyId);
  if (!company) throw new ActionError(MESSAGES.notFound);
  return company;
}

/**
 * The caller may add documents for the company: a member of the active company, or a Fund Admin on its
 * behalf (canEnterData; the storage and documents policies check the same).
 */
async function assertCanUpload(sb: Client, companyId: string): Promise<CompanyRow> {
  const ctx = await assertCanViewCompany(companyId);
  const company = await requireCompany(sb, companyId);
  if (company.status !== "active") throw new ActionError(readOnlyMessage(company.name));
  if (!canEnterData(ctx, company.id, company.status)) throw new ActionError(MESSAGE_UPLOAD_NOT_ALLOWED);
  return company;
}

/** The company's period close (RLS read), or a friendly error. */
async function requireClose(sb: Client, companyId: string, closeId: string): Promise<CloseRow> {
  const { data, error } = await sb
    .from("period_closes")
    .select("id, label, status, period_start, period_end")
    .eq("id", closeId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  const close: CloseRow | null = data;
  if (!close) throw new ActionError(MESSAGE_CLOSE_NOT_FOUND);
  return close;
}

/**
 * Step 1 of an upload: checks the caller may add documents for the company (and that the close is the
 * company's), then signs an upload to `<company>/<close or general>/<uuid>-<file name>` (§2.8). The
 * signed upload runs through the caller's RLS client, so Storage's INSERT policy is checked too.
 */
export async function prepareDocumentUpload(input: unknown): Promise<ActionResult<DocumentUploadTarget>> {
  try {
    await assertUser();
    const { companyId, periodCloseId, fileName } = prepareUploadSchema.parse(input);
    const sb = await createClient();
    const company = await assertCanUpload(sb, companyId);
    if (periodCloseId) await requireClose(sb, company.id, periodCloseId);

    const contentType = documentMimeType(fileName);
    if (!contentType) throw new ActionError(MESSAGES.invalid);
    const path = buildDocumentPath(company.id, periodCloseId, randomUUID(), fileName);
    const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[documents] could not sign an upload", error?.message);
      throw new ActionError(storageErrorMessage(error, "We couldn't prepare the upload. Please try again."));
    }
    return ok({ bucket: DOCUMENTS_BUCKET, path: data.path, token: data.token, contentType });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Step 3 of an upload: records the uploaded file as a `documents` row. The database checks the path
 * against the row (company folder, close folder), that the object exists in storage, copies its size
 * and type, and assigns the version (1 + the highest version of the same close and type).
 */
export async function saveDocument(input: unknown): Promise<ActionResult<SavedDocument>> {
  try {
    await assertUser();
    const { companyId, periodCloseId, docType, fileName, sizeBytes, path } = saveDocumentSchema.parse(input);
    const sb = await createClient();
    const company = await assertCanUpload(sb, companyId);
    if (!isDocumentPathFor(path, company.id, periodCloseId)) {
      throw new ActionError("The uploaded file doesn't belong to this company. Please upload it again.");
    }
    if (periodCloseId) await requireClose(sb, company.id, periodCloseId);

    const { data, error } = await sb
      .from("documents")
      .insert({
        company_id: company.id,
        period_close_id: periodCloseId,
        doc_type: docType,
        file_name: fileName,
        storage_path: path,
        // Fallbacks only: the database copies both from the stored object's metadata.
        mime_type: documentMimeType(fileName),
        size_bytes: sizeBytes,
      })
      .select("id, version, doc_type")
      .single();
    if (error) throw error;
    const saved: { id: string; version: number; doc_type: DocumentType } = data;

    revalidateDocuments(company.id);
    return ok({ id: saved.id, version: saved.version, docType: saved.doc_type });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Confirms a quarter or half close (company owner, or a Fund Admin on behalf; active companies only).
 * `restated` holds the figures the company restates to match its management accounts; unchanged ones
 * are dropped and the margins are recomputed from the restated revenue and profit (deriveRestatement).
 * A restatement needs a reason. The database checks every month is submitted or approved and that the
 * management accounts are uploaded, then stores the computed totals.
 */
export async function confirmPeriodClose(input: unknown): Promise<ActionResult<void>> {
  try {
    await assertUser();
    const { companyId, closeId, restated, reason } = confirmCloseSchema.parse(input);
    const ctx = await assertCanViewCompany(companyId);
    const sb = await createClient();
    const company = await requireCompany(sb, companyId);
    if (company.status !== "active") throw new ActionError(readOnlyMessage(company.name));
    if (!canConfirmPeriodClose(ctx, company.id, company.status)) throw new ActionError(MESSAGE_CONFIRM_NOT_ALLOWED);
    const close = await requireClose(sb, company.id, closeId);
    if (close.status === "confirmed") throw new ActionError(`${close.label} is already confirmed.`);

    let restatement: RestatedTotals | null = null;
    if (restated && Object.values(restated).some((value) => value !== null && value !== undefined)) {
      const series = await getFinancialSeries(sb, company.id, close.period_start, close.period_end);
      restatement = deriveRestatement(liveCloseTotals(close, company.reporting_start_month, series), restated);
    }
    const trimmedReason = reason?.trim() ?? "";
    if (restatement && trimmedReason === "") {
      throw new ActionError(MESSAGE_REASON_REQUIRED, { reason: MESSAGE_REASON_REQUIRED });
    }

    const { error } = await sb.rpc("confirm_period_close", {
      p_close_id: close.id,
      p_restated_totals: restatement ?? undefined,
      p_reason: restatement ? trimmedReason : undefined,
    });
    if (error) throw error;

    revalidateDocuments(company.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Reopens a confirmed close (Super Admin, Fund Admin; active companies only). The company confirms it
 * again; its restated figures and reason are kept until then. The reason goes to the audit log.
 */
export async function reopenPeriodClose(input: unknown): Promise<ActionResult<void>> {
  try {
    const ctx = await assertScaleUp(["super_admin", "fund_admin"]);
    const { companyId, closeId, reason } = reopenCloseSchema.parse(input);
    const sb = await createClient();
    const company = await requireCompany(sb, companyId);
    if (!canReopenPeriodClose(ctx, company.status)) throw new ActionError(readOnlyMessage(company.name));
    const close = await requireClose(sb, company.id, closeId);
    if (close.status !== "confirmed") throw new ActionError(`${close.label} is not confirmed, so there is nothing to reopen.`);

    const { error } = await sb.rpc("reopen_period_close", { p_close_id: close.id, p_reason: reason });
    if (error) throw error;

    revalidateDocuments(company.id);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
