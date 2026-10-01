import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type {
  TemplateFieldRow,
  TemplateRow,
  TemplateSectionRow,
  TemplateVersionFull,
  TemplateVersionRow,
} from "@/lib/types/domain";

import { notFoundError, queryError } from "./errors";
import { isUuid, sortTemplateRows } from "./shared";

// One request per template version: the version, its template (inner join, so the default-template filter
// below can drop rows) and its sections with their fields.
const TEMPLATE_VERSION_SELECT =
  "*, templates!inner(*), sections:template_sections!template_sections_template_version_id_fkey(*, fields:template_fields!template_fields_section_id_fkey(*))";

type TemplateVersionQueryRow = TemplateVersionRow & {
  templates: TemplateRow;
  sections: (TemplateSectionRow & { fields: TemplateFieldRow[] })[];
};

function toTemplateVersionFull(row: TemplateVersionQueryRow): TemplateVersionFull {
  const { templates, sections, ...version } = row;
  return {
    ...version,
    template: templates,
    sections: sortTemplateRows(sections).map(({ fields, ...section }) => ({
      ...section,
      fields: sortTemplateRows(fields ?? []),
    })),
  };
}

/**
 * A template version with its template and its sections (sorted by `sort_order`, then key), each with its
 * fields (sorted the same way). Throws a not-found DataError (isNotFoundError) when the version does not
 * exist or is not visible (templates are readable by every active, MFA-verified user).
 */
export async function getTemplateVersion(
  sb: SupabaseClient<Database>,
  versionId: string,
): Promise<TemplateVersionFull> {
  const op = "getTemplateVersion";
  if (!isUuid(versionId)) throw notFoundError(op, `template version ${JSON.stringify(versionId)}`);
  const { data, error } = await sb
    .from("template_versions")
    .select(TEMPLATE_VERSION_SELECT)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw queryError(op, `load template version ${versionId}`, error);
  if (!data) throw notFoundError(op, `template version ${versionId}`);
  return toTemplateVersionFull(data);
}

/**
 * The current version: the published version of the default template (the one new months open with),
 * or null when the default template has no published version.
 */
export async function getCurrentTemplateVersion(sb: SupabaseClient<Database>): Promise<TemplateVersionFull | null> {
  const { data, error } = await sb
    .from("template_versions")
    .select(TEMPLATE_VERSION_SELECT)
    .eq("status", "published")
    .eq("templates.is_default", true)
    .maybeSingle();
  if (error) throw queryError("getCurrentTemplateVersion", "load the published version of the default template", error);
  return data ? toTemplateVersionFull(data) : null;
}
