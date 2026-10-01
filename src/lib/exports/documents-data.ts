import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SCALEUP_LABEL } from "@/lib/constants";
import { getStaffDisplayNames } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import type { PeriodCloseStatus } from "@/lib/types/enums";

import {
  DOCUMENTS_BUCKET,
  uploaderName,
  type DocumentPackOptions,
  type PackAudience,
  type PackClose,
  type PackDocument,
  type PlannedDocument,
  type UploaderProfile,
} from "./documents-zip";
import { exportQueryError, fetchAllPages, fetchByIdChunks, mapWithConcurrency } from "./fetch-all";

// Loads a company's documents and their files with the caller's RLS-scoped client: the `documents` rows
// the caller can see, and the files through the storage API (bucket policy: anyone who can view the
// company). No service-role client: the caller's own access decides what goes into the pack. Uploaders
// are named as the caller may see them (BRD B28): profiles the caller can read (RLS), and for company
// owners ScaleUp staff as "<full name> (ScaleUp)" through staff_display_names — never an email or role.

const OP = "loadDocumentPack";

type UploaderProfileRow = UploaderProfile & { id: string };

/**
 * Who uploaded each document, keyed by the lower-case uploader id: the profiles the caller can read
 * and, for company owners, the "(ScaleUp)" display names of the uploaders whose profile is hidden. A
 * failed name lookup never blocks the pack: hidden uploaders then show as "ScaleUp".
 */
async function loadUploaderNames(
  sb: SupabaseClient<Database>,
  uploaderIds: readonly string[],
  audience: PackAudience,
): Promise<{ profiles: Map<string, UploaderProfile>; staffNames: Record<string, string> }> {
  const profiles = new Map<string, UploaderProfile>();
  const staffNames: Record<string, string> = {};
  if (uploaderIds.length === 0) return { profiles, staffNames };

  const rows = await fetchByIdChunks(uploaderIds, async (chunk) => {
    const { data, error } = await sb.from("profiles").select("id, full_name, email, scaleup_role").in("id", chunk);
    if (error) throw exportQueryError(OP, "load the uploaders", error);
    const found: UploaderProfileRow[] = data;
    return found;
  });
  for (const { id, ...profile } of rows) profiles.set(id.toLowerCase(), profile);
  if (audience === "scaleup") return { profiles, staffNames };

  // Company owners cannot read ScaleUp staff profiles (RLS): name those uploaders "<name> (ScaleUp)".
  const hidden = uploaderIds.filter((id) => {
    const profile = profiles.get(id.toLowerCase());
    return !profile || profile.scaleup_role !== null;
  });
  if (hidden.length === 0) return { profiles, staffNames };
  try {
    Object.assign(staffNames, await getStaffDisplayNames(sb, hidden));
  } catch (error) {
    console.warn("[exports] could not load the names of ScaleUp uploaders", error);
    for (const id of hidden) staffNames[id.toLowerCase()] = SCALEUP_LABEL;
  }
  return { profiles, staffNames };
}

type DocumentListRow = {
  id: string;
  period_close_id: string | null;
  doc_type: PackDocument["doc_type"];
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  uploaded_at: string;
  uploaded_by: string | null;
};

type CloseRow = PackClose & { status: PeriodCloseStatus };

export type DocumentPackLoad =
  | {
      found: true;
      company: { id: string; name: string };
      close: PackClose | null;
      closes: PackClose[];
      documents: PackDocument[];
    }
  | { found: false; what: "company" | "close" };

async function loadCloses(sb: SupabaseClient<Database>, companyId: string): Promise<CloseRow[]> {
  const { data, error } = await sb
    .from("period_closes")
    .select("id, label, period_start, period_end, period_type, status")
    .eq("company_id", companyId)
    .order("period_end", { ascending: false })
    .order("period_type", { ascending: false });
  if (error) throw exportQueryError(OP, `load the period closes of company ${companyId}`, error);
  const rows: CloseRow[] = data;
  return rows;
}

/**
 * The company, the chosen period close (null = every document) and the documents to pack, each with
 * its uploader named for `audience` (uploaderName: ScaleUp staff see names and roles; company owners
 * see their own people by name and ScaleUp staff as "<full name> (ScaleUp)", BRD B28).
 */
export async function loadDocumentPack(
  sb: SupabaseClient<Database>,
  companyId: string,
  closeId: string | null,
  options: { audience: PackAudience },
): Promise<DocumentPackLoad> {
  const [companyRes, closes, documentRows] = await Promise.all([
    sb.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
    loadCloses(sb, companyId),
    fetchAllPages<DocumentListRow>(OP, `load the documents of company ${companyId}`, (from, to) => {
      let request = sb
        .from("documents")
        .select(
          "id, period_close_id, doc_type, file_name, storage_path, mime_type, size_bytes, version, uploaded_at, uploaded_by",
        )
        .eq("company_id", companyId);
      if (closeId) request = request.eq("period_close_id", closeId);
      return request.order("uploaded_at").order("id").range(from, to);
    }),
  ]);
  if (companyRes.error) throw exportQueryError(OP, `load company ${companyId}`, companyRes.error);
  const company: { id: string; name: string } | null = companyRes.data;
  if (!company) return { found: false, what: "company" };
  const close = closeId ? (closes.find((row) => row.id === closeId) ?? null) : null;
  if (closeId && !close) return { found: false, what: "close" };

  const uploaderIds = [
    ...new Set(documentRows.flatMap((row) => (row.uploaded_by ? [row.uploaded_by.toLowerCase()] : []))),
  ];
  const { profiles, staffNames } = await loadUploaderNames(sb, uploaderIds, options.audience);

  const documents: PackDocument[] = documentRows.map((row) => {
    const uploader = row.uploaded_by?.toLowerCase() ?? null;
    return {
      id: row.id,
      period_close_id: row.period_close_id,
      doc_type: row.doc_type,
      file_name: row.file_name,
      storage_path: row.storage_path,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      version: row.version,
      uploaded_at: row.uploaded_at,
      uploaded_by_name: uploaderName(
        uploader,
        { profile: uploader ? profiles.get(uploader) : null, staffName: uploader ? staffNames[uploader] : null },
        options.audience,
      ),
    };
  });
  const toPackClose = ({ id, label, period_start, period_end, period_type }: CloseRow): PackClose => ({
    id,
    label,
    period_start,
    period_end,
    period_type,
  });
  return {
    found: true,
    company,
    close: close ? toPackClose(close) : null,
    closes: closes.map(toPackClose),
    documents,
  };
}

/**
 * Downloads the planned files (four at a time) with the caller's storage access. A file that cannot be
 * read is left out (null) and marked in the contents list instead of failing the whole pack.
 */
export async function downloadPackFiles(
  sb: SupabaseClient<Database>,
  entries: readonly PlannedDocument[],
  concurrency = 4,
): Promise<(Uint8Array | null)[]> {
  return mapWithConcurrency(entries, concurrency, async ({ document }) => {
    const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).download(document.storage_path);
    if (error || !data) {
      console.warn("[exports] document file could not be read", document.id, error?.message);
      return null;
    }
    return new Uint8Array(await data.arrayBuffer());
  });
}

/** The company's period closes (newest first) with how many documents each has, for the export form. */
export async function listDocumentPackOptions(
  sb: SupabaseClient<Database>,
  companyId: string,
): Promise<DocumentPackOptions> {
  const [closes, documents] = await Promise.all([
    loadCloses(sb, companyId),
    fetchAllPages<{ id: string; period_close_id: string | null; size_bytes: number | null }>(
      OP,
      `count the documents of company ${companyId}`,
      (from, to) =>
        sb
          .from("documents")
          .select("id, period_close_id, size_bytes")
          .eq("company_id", companyId)
          .order("id")
          .range(from, to),
    ),
  ]);
  const byClose = new Map<string, { count: number; bytes: number }>();
  let generalCount = 0;
  let totalBytes = 0;
  for (const document of documents) {
    const bytes = document.size_bytes ?? 0;
    totalBytes += bytes;
    if (!document.period_close_id) {
      generalCount += 1;
      continue;
    }
    const entry = byClose.get(document.period_close_id) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += bytes;
    byClose.set(document.period_close_id, entry);
  }
  return {
    closes: closes.map((close) => ({
      id: close.id,
      label: close.label,
      status: close.status,
      count: byClose.get(close.id)?.count ?? 0,
      bytes: byClose.get(close.id)?.bytes ?? 0,
    })),
    generalCount,
    totalCount: documents.length,
    totalBytes,
  };
}
