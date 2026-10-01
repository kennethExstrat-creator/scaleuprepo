import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { Fragment } from "react";

import { Money } from "@/components/app/money";
import { FieldCommentButton } from "@/components/comments/comment-threads";
import type { CommentCounts, CommentThread } from "@/components/comments/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SUBMISSION_STATUS_META } from "@/lib/constants";
import type { SubmissionStatus } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import type { ComparisonRow, ComparisonSection, ComparisonValue } from "./comparison";
import { changeDirection, describeChange, formatChange, formatComparisonValue } from "./review-format";

export type ComparisonColumn = {
  /** "Sep 2026". */
  label: string;
  /** Status of that month's update; null when there is no update for it. */
  status: SubmissionStatus | null;
};

export type ComparisonTableProps = {
  sections: ComparisonSection[];
  currency: string;
  columns: { current: ComparisonColumn; previous: ComparisonColumn; lastYear: ComparisonColumn };
  comments: {
    submissionId: string;
    canStartThreads: boolean;
    threadsByTarget: Record<string, CommentThread[]>;
    counts: CommentCounts;
  };
};

const STICKY_CELL = "sticky left-0 z-10 bg-card";

/** Month label, what the column is, and — for the comparison months — their status unless approved. */
function ColumnHead({
  column,
  caption,
  showStatus,
  className,
}: {
  column: ComparisonColumn;
  caption: string;
  showStatus: boolean;
  className?: string;
}) {
  const status = column.status === null ? "No update" : column.status !== "approved" ? SUBMISSION_STATUS_META[column.status].label : null;
  return (
    <TableHead className={cn("h-auto py-2 text-right align-bottom", className)}>
      <span className="block font-semibold tabular-nums">{column.label}</span>
      <span className="block text-xs font-normal text-muted-foreground">{caption}</span>
      {showStatus && status ? <span className="block text-xs font-normal text-warning">{status}</span> : null}
    </TableHead>
  );
}

function ValueCell({
  row,
  value,
  currency,
  cashflowPositive,
  emphasise,
}: {
  row: ComparisonRow;
  value: ComparisonValue;
  currency: string;
  cashflowPositive: boolean;
  emphasise?: boolean;
}) {
  const empty = row.kind !== "runway" && (value === null || value === "");
  return (
    <TableCell
      className={cn(
        "text-right tabular-nums",
        emphasise && "font-medium",
        row.emphasis === "total" && "font-semibold",
        (empty || (row.kind === "runway" && value === null && !cashflowPositive)) && "text-muted-foreground",
        row.kind === "text" && "max-w-48 truncate whitespace-nowrap",
        row.kind === "runway" && "min-w-24 whitespace-normal",
      )}
      title={row.kind === "text" && typeof value === "string" ? value : undefined}
    >
      {row.kind === "money" && typeof value === "number" ? (
        <Money value={value} currency={currency} />
      ) : (
        // The unit is shown once, in the row's label cell.
        formatComparisonValue({ kind: row.kind, unit: null }, value, currency, { cashflowPositive })
      )}
    </TableCell>
  );
}

function ChangeCell({ row, change, against }: { row: ComparisonRow; change: number | null; against: string }) {
  const direction = changeDirection(change);
  const Icon = direction === "up" ? ArrowUpRightIcon : direction === "down" ? ArrowDownRightIcon : null;
  return (
    <TableCell className="text-right text-xs text-muted-foreground tabular-nums" title={describeChange(row.changeKind, change, against)}>
      <span className="inline-flex items-center justify-end gap-0.5">
        {Icon ? <Icon className="size-3" aria-hidden="true" /> : null}
        {row.changeKind === "none" ? "" : formatChange(row.changeKind, change)}
      </span>
    </TableCell>
  );
}

/**
 * This month against the prior month and the same month last year (BRD A7), with the change and the
 * year-on-year change. Sections carry an optional one-line description (e.g. that the company's revenue
 * segments add up to total revenue and ScaleUp's revenue lines need not, BRD B30). Every row that has a
 * target (derived rows have none) gets a comment button in its sticky label cell, so it stays in reach while
 * the table scrolls sideways on small screens.
 */
export function ComparisonTable({ sections, currency, columns, comments }: ComparisonTableProps) {
  const columnCount = 6;
  return (
    <Table>
      <caption className="sr-only">
        {columns.current.label} compared with {columns.previous.label} and {columns.lastYear.label}
      </caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(STICKY_CELL, "h-auto py-2 align-bottom")}>Metric</TableHead>
          <ColumnHead column={columns.current} caption="This month" showStatus={false} />
          <ColumnHead column={columns.previous} caption="Prior month" showStatus />
          <TableHead className="h-auto py-2 text-right align-bottom">
            <span className="block">Change</span>
            <span className="block text-xs font-normal text-muted-foreground">vs prior</span>
          </TableHead>
          <ColumnHead column={columns.lastYear} caption="Same month last year" showStatus />
          <TableHead className="h-auto py-2 text-right align-bottom">
            <span className="block">YoY</span>
            <span className="block text-xs font-normal text-muted-foreground">vs last year</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((section) => (
          <Fragment key={section.key}>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead colSpan={columnCount} scope="colgroup" className="h-auto py-1.5 whitespace-normal">
                <div className="sticky left-2 flex w-fit max-w-[calc(100vw-4rem)] flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:max-w-xl">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</span>
                  {section.description ? (
                    <span className="text-xs font-normal text-muted-foreground">{section.description}</span>
                  ) : null}
                </div>
              </TableHead>
            </TableRow>
            {section.rows.map((row, index) => {
              const startsGroup = row.group !== null && row.group !== section.rows[index - 1]?.group;
              const threads = row.target ? (comments.threadsByTarget[row.target] ?? []) : [];
              const counts = row.target ? comments.counts[row.target] : undefined;
              return (
                <Fragment key={row.key}>
                  {startsGroup ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columnCount} className="pt-3 pb-1 text-sm font-medium">
                        <span className="sticky left-2 inline-block">{row.group}</span>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <TableRow className={cn("hover:bg-transparent", row.emphasis === "total" && "border-t-2")}>
                    <TableHead
                      scope="row"
                      className={cn(
                        STICKY_CELL,
                        "h-auto w-44 max-w-56 min-w-40 py-1.5 font-normal whitespace-normal sm:w-56 sm:max-w-64",
                        row.group && "pl-6",
                        row.emphasis === "total" && "font-semibold",
                        row.emphasis === "derived" && "text-muted-foreground",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="leading-snug">
                          {row.label}
                          {row.unit && !row.label.toLowerCase().includes(row.unit.toLowerCase()) ? (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">({row.unit})</span>
                          ) : null}
                          {row.note ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">({row.note})</span> : null}
                        </span>
                        {row.target ? (
                          <FieldCommentButton
                            submissionId={comments.submissionId}
                            target={row.target}
                            mode="scaleup"
                            canStartThreads={comments.canStartThreads}
                            count={counts?.total ?? 0}
                            unresolved={counts?.unresolved ?? 0}
                            targetLabel={row.commentLabel}
                            threads={threads}
                          />
                        ) : null}
                      </div>
                    </TableHead>
                    <ValueCell
                      row={row}
                      value={row.current}
                      currency={currency}
                      cashflowPositive={row.cashflowPositive?.current ?? false}
                      emphasise
                    />
                    <ValueCell row={row} value={row.previous} currency={currency} cashflowPositive={row.cashflowPositive?.previous ?? false} />
                    <ChangeCell row={row} change={row.change} against={columns.previous.label} />
                    <ValueCell row={row} value={row.lastYear} currency={currency} cashflowPositive={row.cashflowPositive?.lastYear ?? false} />
                    <ChangeCell row={row} change={row.yoy} against={columns.lastYear.label} />
                  </TableRow>
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
