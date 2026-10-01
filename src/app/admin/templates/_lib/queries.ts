import "server-only";

// Reads of the template builder (ScaleUp pages and actions). Every query runs on the RLS-scoped client
// (templates are readable by every active user; profiles and reporting periods by ScaleUp staff), and
// results are assigned to typed variables so tsc checks the select strings against the generated types.

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { diffTemplateVersions, type LockedField, type TemplateChange } from "./rules";
import { DataError, getTemplateVersion } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import type { TemplateRow, TemplateVersionFull, TemplateVersionRow } from "@/lib/types/domain";

type Sb = SupabaseClient<Database>;

function failed(operation: string, what: string, error: PostgrestError): DataError {
  return new DataError(operation, `could not ${what}: ${error.message}`, {
    code: error.code || undefined,
    details: error.details,
    hint: error.hint,
    cause: error,
  });
}

// ---------------------------------------------------------------------------------------------
// Versions with their section and field counts
// ---------------------------------------------------------------------------------------------

const VERSION_SELECT =
  "id, template_id, version_no, status, notes, created_at, created_by, published_at, published_by, sections:template_sections!template_sections_template_version_id_fkey(id), fields:template_fields!template_fields_template_version_id_fkey(id)";

type VersionQueryRow = Pick<
  TemplateVersionRow,
  | "id"
  | "template_id"
  | "version_no"
  | "status"
  | "notes"
  | "created_at"
  | "created_by"
  | "published_at"
  | "published_by"
> & { sections: { id: string }[]; fields: { id: string }[] };

/** A template version for lists: who made and published it, its size and the months opened with it. */
export type VersionSummary = {
  id: string;
  templateId: string;
  versionNo: number;
  status: TemplateVersionRow["status"];
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  sectionCount: number;
  fieldCount: number;
  /** Reporting months opened with this version ('YYYY-MM-DD', oldest first). */
  months: string[];
};

/** Reporting months by template version, and the latest month opened so far. */
async function loadPeriodMonths(sb: Sb): Promise<{ byVersion: Map<string, string[]>; latest: string | null }> {
  const { data, error } = await sb.from("reporting_periods").select("month, template_version_id").order("month");
  if (error) throw failed("loadPeriodMonths", "load the reporting months", error);
  const rows: { month: string; template_version_id: string }[] = data ?? [];
  const byVersion = new Map<string, string[]>();
  for (const row of rows) {
    const list = byVersion.get(row.template_version_id) ?? [];
    list.push(row.month);
    byVersion.set(row.template_version_id, list);
  }
  return { byVersion, latest: rows.length > 0 ? rows[rows.length - 1].month : null };
}

async function loadVersionSummaries(sb: Sb, templateId?: string): Promise<VersionQueryRow[]> {
  let query = sb.from("template_versions").select(VERSION_SELECT);
  if (templateId) query = query.eq("template_id", templateId);
  const { data, error } = await query.order("version_no", { ascending: false });
  if (error) throw failed("loadVersionSummaries", "load the template versions", error);
  const rows: VersionQueryRow[] = data ?? [];
  return rows;
}

function toSummary(row: VersionQueryRow, months: Map<string, string[]>): VersionSummary {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNo: row.version_no,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    createdBy: row.created_by,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    sectionCount: row.sections?.length ?? 0,
    fieldCount: row.fields?.length ?? 0,
    months: months.get(row.id) ?? [],
  };
}

/** Display names (full name, else email) of ScaleUp staff by id. Unknown ids are left out. */
export async function loadPeopleNames(sb: Sb, ids: Iterable<string | null | undefined>): Promise<Record<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return {};
  const { data, error } = await sb.from("profiles").select("id, full_name, email").in("id", unique);
  if (error) throw failed("loadPeopleNames", "load the names of the people involved", error);
  const rows: { id: string; full_name: string | null; email: string }[] = data ?? [];
  const names: Record<string, string> = {};
  for (const row of rows) {
    const name = row.full_name?.trim() || row.email?.trim();
    if (name) names[row.id] = name;
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// /admin/templates
// ---------------------------------------------------------------------------------------------

export type TemplateOverview = {
  template: TemplateRow;
  /** Newest first. */
  versions: VersionSummary[];
  draft: VersionSummary | null;
  published: VersionSummary | null;
  /** What the draft changes compared with the published version (null without both). */
  draftChanges: TemplateChange[] | null;
};

export type TemplatesOverview = {
  /** The default template first, then by name. */
  templates: TemplateOverview[];
  people: Record<string, string>;
  /** The latest reporting month opened so far ('YYYY-MM-DD'), if any. */
  latestOpenMonth: string | null;
};

export async function loadTemplatesOverview(sb: Sb): Promise<TemplatesOverview> {
  const [templatesRes, versionRows, periods] = await Promise.all([
    sb.from("templates").select("*").order("is_default", { ascending: false }).order("name"),
    loadVersionSummaries(sb),
    loadPeriodMonths(sb),
  ]);
  if (templatesRes.error) throw failed("loadTemplatesOverview", "load the templates", templatesRes.error);
  const templateRows: TemplateRow[] = templatesRes.data ?? [];

  const summaries = versionRows.map((row) => toSummary(row, periods.byVersion));
  const templates = templateRows.map((template): TemplateOverview => {
    const versions = summaries.filter((version) => version.templateId === template.id);
    return {
      template,
      versions,
      draft: versions.find((version) => version.status === "draft") ?? null,
      published: versions.find((version) => version.status === "published") ?? null,
      draftChanges: null,
    };
  });

  const [people] = await Promise.all([
    loadPeopleNames(
      sb,
      summaries.flatMap((version) => [version.createdBy, version.publishedBy]),
    ),
    ...templates.map(async (overview) => {
      if (!overview.draft || !overview.published) return;
      const [draft, published] = await Promise.all([
        getTemplateVersion(sb, overview.draft.id),
        getTemplateVersion(sb, overview.published.id),
      ]);
      overview.draftChanges = diffTemplateVersions(published, draft);
    }),
  ]);

  return { templates, people, latestOpenMonth: periods.latest };
}

// ---------------------------------------------------------------------------------------------
// /admin/templates/[versionId]
// ---------------------------------------------------------------------------------------------

/**
 * The fields of a template's published and archived versions, by key: the latest version that used
 * each key, with its type and label. A draft keeps these keys' types (answers are stored per key).
 */
export async function loadLockedFields(sb: Sb, templateId: string): Promise<Record<string, LockedField>> {
  const { data: versionData, error: versionError } = await sb
    .from("template_versions")
    .select("id, version_no")
    .eq("template_id", templateId)
    .neq("status", "draft");
  if (versionError) throw failed("loadLockedFields", "load the earlier template versions", versionError);
  const versions: { id: string; version_no: number }[] = versionData ?? [];
  if (versions.length === 0) return {};

  const { data, error } = await sb
    .from("template_fields")
    .select("key, label, field_type, template_version_id")
    .in(
      "template_version_id",
      versions.map((version) => version.id),
    );
  if (error) throw failed("loadLockedFields", "load the fields of earlier template versions", error);
  const fields: { key: string; label: string; field_type: LockedField["field_type"]; template_version_id: string }[] =
    data ?? [];

  const versionNo = new Map(versions.map((version) => [version.id, version.version_no]));
  const locked: Record<string, LockedField> = {};
  for (const field of fields) {
    const no = versionNo.get(field.template_version_id) ?? 0;
    const current = locked[field.key];
    if (!current || no > current.version_no) {
      locked[field.key] = { field_type: field.field_type, label: field.label, version_no: no };
    }
  }
  return locked;
}

export type VersionPageData = {
  version: TemplateVersionFull;
  /** Every version of the same template (this one included), newest first. */
  versions: VersionSummary[];
  /**
   * The version this one is compared with: for a draft the published version it will replace; for a
   * published or archived version the one published before it. Null when there is none.
   */
  base: TemplateVersionFull | null;
  lockedFields: Record<string, LockedField>;
  latestOpenMonth: string | null;
  people: Record<string, string>;
};

/** Everything the version page needs. Throws a not-found DataError (isNotFoundError) for unknown ids. */
export async function loadVersionPage(sb: Sb, versionId: string): Promise<VersionPageData> {
  const [version, periods] = await Promise.all([getTemplateVersion(sb, versionId), loadPeriodMonths(sb)]);
  const versionRows = await loadVersionSummaries(sb, version.template_id);
  const versions = versionRows.map((row) => toSummary(row, periods.byVersion));

  const baseSummary =
    version.status === "draft"
      ? (versions.find((item) => item.status === "published") ?? null)
      : (versions.find((item) => item.status !== "draft" && item.versionNo < version.version_no) ?? null);

  const [base, lockedFields, people] = await Promise.all([
    baseSummary ? getTemplateVersion(sb, baseSummary.id) : Promise.resolve(null),
    version.status === "draft" ? loadLockedFields(sb, version.template_id) : Promise.resolve({}),
    loadPeopleNames(sb, versions.flatMap((item) => [item.createdBy, item.publishedBy])),
  ]);

  return { version, versions, base, lockedFields, latestOpenMonth: periods.latest, people };
}
