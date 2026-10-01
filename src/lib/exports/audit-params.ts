// Parses the audit log filters from searchParams / URLSearchParams (the /admin/audit page and
// GET /api/exports/audit share it). Kept apart from audit.ts so the filter form's client bundle does not
// carry the zod schema.
import { z } from "zod";

import { isDateKey } from "@/lib/periods";

import type { AuditFilters } from "./audit";

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(source: ParamSource, key: string): string | undefined {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "all" ? undefined : trimmed;
}

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const filterSchema = z.object({
  company: optional(z.guid().transform((value) => value.toLowerCase())),
  actor: optional(z.string().max(200)),
  action: optional(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)),
  entity: optional(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)),
  from: optional(z.string().refine(isDateKey)),
  to: optional(z.string().refine(isDateKey)),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

/**
 * Filters and page from searchParams / URLSearchParams. Lenient: malformed values are ignored, "all" and
 * blanks mean "no filter", and a reversed date range is swapped.
 */
export function parseAuditFilters(source: ParamSource): { filters: AuditFilters; page: number } {
  const parsed = filterSchema.parse({
    company: readParam(source, "company"),
    actor: readParam(source, "actor"),
    action: readParam(source, "action"),
    entity: readParam(source, "entity"),
    from: readParam(source, "from"),
    to: readParam(source, "to"),
    page: readParam(source, "page") ?? 1,
  });
  const filters: AuditFilters = {};
  if (parsed.company) filters.company = parsed.company;
  if (parsed.actor) filters.actor = parsed.actor;
  if (parsed.action) filters.action = parsed.action;
  if (parsed.entity) filters.entity = parsed.entity;
  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    filters.from = parsed.to;
    filters.to = parsed.from;
  } else {
    if (parsed.from) filters.from = parsed.from;
    if (parsed.to) filters.to = parsed.to;
  }
  return { filters, page: parsed.page };
}
