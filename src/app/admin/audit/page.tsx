import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon, SearchXIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireScaleUp } from "@/lib/auth/session";
import {
  AUDIT_EXPORT_INCOMPLETE_MARKER,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_PAGE_SIZE,
  auditEntryView,
  auditQueryString,
  hasAuditFilters,
  type AuditFilters,
} from "@/lib/exports/audit";
import { listAuditPage, loadCompanyNames } from "@/lib/exports/audit-data";
import { parseAuditFilters } from "@/lib/exports/audit-params";
import { formatNumber } from "@/lib/format";
import { todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";

import { DownloadLink } from "../exports/_components/download-link";
import { AuditLogFilters } from "./_components/audit-filters";
import { AuditLogTable } from "./_components/audit-table";

export const metadata: Metadata = { title: "Audit log" };

function pageHref(filters: AuditFilters, page: number): string {
  const query = auditQueryString(filters, page);
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

function Pagination({ filters, page, pageCount }: { filters: AuditFilters; page: number; pageCount: number }) {
  if (pageCount <= 1) return null;
  const previous = page > 1 ? pageHref(filters, Math.min(page - 1, pageCount)) : null;
  const next = page < pageCount ? pageHref(filters, page + 1) : null;
  return (
    <nav aria-label="Audit log pages" className="flex items-center justify-between gap-2">
      {previous ? (
        <Button asChild variant="outline" size="sm">
          <Link href={previous} rel="prev">
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            Newer
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
          Newer
        </Button>
      )}
      <span className="text-sm text-muted-foreground tabular-nums" aria-current="page">
        Page {formatNumber(Math.min(page, pageCount))} of {formatNumber(pageCount)}
      </span>
      {next ? (
        <Button asChild variant="outline" size="sm">
          <Link href={next} rel="next">
            Older
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Older
          <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      )}
    </nav>
  );
}

/**
 * Audit log (BRD A14): every change, submission, approval, export and on-behalf entry, newest first,
 * filtered by company, actor, action, record type and dates; 50 per page; CSV export of the filtered log.
 * Super Admin, Fund Admin and Partner (§1).
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireScaleUp(["super_admin", "fund_admin", "partner"]);
  const { filters, page } = parseAuditFilters(await searchParams);
  const sb = await createClient();
  const [{ rows, total }, companyNames] = await Promise.all([
    listAuditPage(sb, filters, page),
    loadCompanyNames(sb),
  ]);

  const entries = rows.map((row) =>
    auditEntryView(row, row.company_id ? (companyNames.get(row.company_id) ?? null) : null),
  );
  const companies = [...companyNames.entries()].map(([id, name]) => ({ id, name }));
  const pageCount = total === null ? page : Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const filtered = hasAuditFilters(filters);
  const query = auditQueryString(filters);
  const exportHref = `/api/exports/audit${query ? `?${query}` : ""}`;
  const firstShown = (page - 1) * AUDIT_PAGE_SIZE + 1;
  const tooMany = total !== null && total > AUDIT_EXPORT_MAX_ROWS;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-2"
        title="Audit log"
        description="Every change, submission, approval, export and on-behalf entry, with who made it and when. Entries can never be changed or deleted."
        actions={
          <DownloadLink
            href={total === 0 ? null : exportHref}
            fallbackFilename="Audit log.csv"
            successMessage="Audit log exported"
            incomplete={{
              marker: AUDIT_EXPORT_INCOMPLETE_MARKER,
              title: "The audit log export is incomplete",
              description:
                "It reached the limit of one export, so it holds only the newest entries. Its last row says where it stops: narrow the filters, for example the dates, and export again for the rest.",
            }}
            variant="outline"
            inlineError={false}
          >
            Export CSV
          </DownloadLink>
        }
      />

      <AuditLogFilters key={query} companies={companies} filters={filters} today={todayMYT()} />

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span className="tabular-nums">
          {total === null
            ? "Entries"
            : total === 0
              ? "No entries"
              : `${formatNumber(total)} ${total === 1 ? "entry" : "entries"}${filtered ? " match these filters" : ""}${
                  entries.length > 0
                    ? ` · showing ${formatNumber(firstShown)}–${formatNumber(firstShown + entries.length - 1)}`
                    : ""
                }`}
        </span>
        {tooMany ? (
          <span>
            Exports hold up to {formatNumber(AUDIT_EXPORT_MAX_ROWS)} entries: narrow the filters to export these.
          </span>
        ) : (
          <span>Times are Malaysia time.</span>
        )}
      </div>

      {entries.length > 0 ? (
        <AuditLogTable entries={entries} />
      ) : total !== null && total > 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="This page is past the last entry"
          description="There are fewer entries than this page number."
          action={
            <Button asChild variant="outline">
              <Link href={pageHref(filters, 1)}>Go to the first page</Link>
            </Button>
          }
        />
      ) : filtered ? (
        <EmptyState
          icon={SearchXIcon}
          title="No entries match these filters"
          description="Try a wider date range, another company or fewer filters."
          action={
            <Button asChild variant="outline">
              <Link href="/admin/audit">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={ScrollTextIcon}
          title="No audit entries yet"
          description="Changes, submissions, approvals and exports will appear here as they happen."
        />
      )}

      <Pagination filters={filters} page={page} pageCount={pageCount} />
    </div>
  );
}
