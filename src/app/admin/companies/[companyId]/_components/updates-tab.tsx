import { CalendarOffIcon, MessageSquareIcon, PencilLineIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { TONE_DOT_CLASSES } from "@/components/app/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canEnterData, canManagePlatform } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { NOT_YET_REPORTING_META, OVERDUE_META } from "@/lib/constants";
import { listCompanySubmissions } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { dateToMonthKey, monthLabel } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow, SubmissionOverviewRow } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

import { companyTabHref } from "./tabs";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function summary(rows: SubmissionOverviewRow[]): string {
  const parts = [plural(rows.length, "month")];
  const overdue = rows.filter((row) => row.is_overdue).length;
  const submitted = rows.filter((row) => row.status === "submitted").length;
  const changes = rows.filter((row) => row.status === "changes_requested").length;
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (submitted > 0) parts.push(`${submitted} awaiting review`);
  if (changes > 0) parts.push(`${plural(changes, "month")} with changes requested`);
  return parts.join(" · ");
}

/**
 * Monthly updates of the company (v_submission_overview, newest first) with links to the review page and,
 * for Fund Admins, to entering data on the company's behalf (open months of an active company).
 */
export async function UpdatesTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const rows = await listCompanySubmissions(sb, company.id);
  const onBehalf = canEnterData(ctx, company.id, company.status);

  if (rows.length === 0) {
    const notReporting = company.reporting_start_month === null;
    return (
      <EmptyState
        icon={CalendarOffIcon}
        title={notReporting ? NOT_YET_REPORTING_META.label : "No months opened yet"}
        description={
          notReporting
            ? "Monthly updates are requested once a reporting start month is set on the Overview tab."
            : `Reporting starts ${monthLabel(company.reporting_start_month ?? "")}. Each month opens on the 1st of the following month.`
        }
        action={
          notReporting && canManagePlatform(ctx) ? (
            <Button asChild variant="outline">
              <Link href={companyTabHref(company.id, "overview")} scroll={false}>
                Set the start month
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Monthly updates</h2>
        </CardTitle>
        <CardDescription>{summary(rows)}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-3">Month</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Narrative</TableHead>
                <TableHead className="text-right">Open threads</TableHead>
                <TableHead className="pr-3 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const monthKey = dateToMonthKey(row.month);
                const editable = row.status === "draft" || row.status === "changes_requested";
                const narrativeTone = row.has_narrative ? "success" : "neutral";
                return (
                  <TableRow key={row.id}>
                    <TableCell className="pl-3 font-medium tabular-nums">{monthLabel(row.month)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={row.status} />
                        {row.is_overdue ? (
                          <ToneBadge tone={OVERDUE_META.tone} title={OVERDUE_META.description}>
                            {row.days_overdue > 0 ? `Overdue ${plural(row.days_overdue, "day")}` : OVERDUE_META.label}
                          </ToneBadge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDate(row.due_date)}
                      {row.original_due_date && row.original_due_date !== row.due_date ? (
                        <div className="text-xs text-muted-foreground">Originally {formatDate(row.original_due_date)}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.submitted_at ? formatDateTime(row.submitted_at) : <span className="text-muted-foreground">—</span>}
                      {row.revision > 1 ? (
                        <div className="text-xs text-muted-foreground">Revision {row.revision}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.approved_at ? formatDate(row.approved_at) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("size-2 rounded-full", TONE_DOT_CLASSES[narrativeTone])} aria-hidden="true" />
                        {row.has_narrative ? "Filled" : row.status === "draft" ? "Not yet" : "Skipped"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.open_threads > 0 ? (
                        <span className="inline-flex items-center gap-1" title={plural(row.open_threads, "unresolved thread")}>
                          <MessageSquareIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {row.open_threads}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-3">
                      <div className="flex justify-end gap-1">
                        {onBehalf && editable ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/companies/${company.id}/updates/${monthKey}`}>
                              <PencilLineIcon data-icon="inline-start" />
                              Edit on behalf<span className="sr-only"> for {monthLabel(row.month)}</span>
                            </Link>
                          </Button>
                        ) : null}
                        <Button asChild variant={row.status === "submitted" ? "default" : "outline"} size="sm">
                          <Link href={`/admin/review/${row.id}`}>
                            {row.status === "submitted" ? "Review" : "Open"}
                            <span className="sr-only"> {monthLabel(row.month)}</span>
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
