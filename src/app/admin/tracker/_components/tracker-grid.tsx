import Link from "next/link";

import { ToneBadge } from "@/components/app/status-badge";
import { COMPANY_STATUS_META, NOT_YET_REPORTING_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { initialsOf, type TrackerColumn, type TrackerCompany, type TrackerRow } from "../_lib/tracker-model";
import { TrackerCellView } from "./tracker-cell";

// Opaque row-hover colour for the sticky company column (the month cells scroll underneath it).
const STICKY_HOVER = "group-hover/row:bg-[color-mix(in_oklch,var(--color-muted)_70%,var(--color-card))]";

export function FundCodes({ funds }: { funds: TrackerCompany["funds"] }) {
  if (funds.length === 0) return null;
  return (
    <>
      {funds.map((fund) => (
        <span
          key={fund.id}
          title={fund.name}
          className="rounded-sm bg-muted px-1 text-[10px] leading-4 font-medium text-muted-foreground ring-1 ring-foreground/5"
        >
          {fund.code}
        </span>
      ))}
    </>
  );
}

/** The partner-in-charge as initials (full name on hover and for screen readers). */
export function PartnerInitials({ partner }: { partner: TrackerCompany["partner"] }) {
  if (!partner) {
    return (
      <span className="text-[10px] leading-4 text-muted-foreground" title="No partner-in-charge assigned">
        No partner
      </span>
    );
  }
  return (
    <span
      title={`Partner-in-charge: ${partner.name}`}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
    >
      <span aria-hidden="true">{initialsOf(partner.name)}</span>
      <span className="sr-only">Partner-in-charge: {partner.name}</span>
    </span>
  );
}

function CompanyHeaderCell({ row }: { row: TrackerRow }) {
  const { company } = row;
  const status = COMPANY_STATUS_META[company.status];
  return (
    <th
      scope="row"
      className={cn(
        "sticky left-0 z-10 border-r border-b bg-card px-3 py-1.5 text-left align-middle font-normal",
        STICKY_HOVER,
      )}
    >
      <div className={cn("flex w-36 min-w-0 flex-col gap-1 sm:w-48", row.muted && "opacity-70")}>
        <Link
          href={`/admin/companies/${company.id}`}
          prefetch={false}
          className="truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          title={company.name}
        >
          {company.name}
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <FundCodes funds={company.funds} />
          <PartnerInitials partner={company.partner} />
          {row.muted ? (
            <ToneBadge tone={status.tone} className="h-4 px-1.5 text-[10px]">
              {status.label}
            </ToneBadge>
          ) : null}
          {row.notYetReporting ? (
            <ToneBadge tone={NOT_YET_REPORTING_META.tone} title={NOT_YET_REPORTING_META.description} className="h-4 px-1.5 text-[10px]">
              {NOT_YET_REPORTING_META.label}
            </ToneBadge>
          ) : null}
        </div>
      </div>
    </th>
  );
}

/**
 * The portfolio grid: a sticky company column and one column per open month (oldest to newest), in a
 * scroll area with a sticky header (horizontal scroll on small screens).
 */
export function TrackerGrid({ columns, rows, captionId }: { columns: TrackerColumn[]; rows: TrackerRow[]; captionId: string }) {
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="relative max-h-[75svh] overflow-auto rounded-lg border bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <caption id={captionId} className="sr-only">
          Monthly updates by company. Each cell shows the month&apos;s status, whether a narrative was included and
          the open comment threads; open a cell to review the update.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 border-r border-b bg-card px-3 py-2 text-left align-bottom text-xs font-medium text-muted-foreground"
            >
              <span className="block w-36 sm:w-48">Company</span>
            </th>
            {columns.map((column) => (
              <th
                key={column.month}
                scope="col"
                className={cn(
                  "sticky top-0 z-20 min-w-36 border-b bg-card px-2.5 py-2 text-left align-bottom font-medium",
                  column.isLatest && "bg-[color-mix(in_oklch,var(--color-muted)_60%,var(--color-card))]",
                )}
              >
                <span className="block text-sm whitespace-nowrap">
                  <abbr title={column.longLabel} className="no-underline">
                    {column.label}
                  </abbr>
                </span>
                <span className="block text-xs font-normal whitespace-nowrap text-muted-foreground">
                  Due {formatDate(column.dueDate)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>*]:border-b-0">
          {rows.map((row) => (
            <tr key={row.company.id} className="group/row">
              <CompanyHeaderCell row={row} />
              {row.cells.map((cell) => (
                <td
                  key={cell.month}
                  className="min-w-36 border-b px-1 py-2 align-middle group-hover/row:bg-muted/70"
                >
                  <TrackerCellView cell={cell} dimmed={row.muted} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
