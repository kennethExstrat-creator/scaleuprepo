import { CalendarCheck2Icon, CircleCheckIcon, CircleIcon, FolderOpenIcon } from "lucide-react";
import Link from "next/link";

import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_TYPE_LABELS, PERIOD_CLOSE_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { addMonths, monthKeyToDate, monthLabelLong, type ClosePeriod } from "@/lib/periods";
import { cn } from "@/lib/utils";

import type { CloseSummary } from "./home-model";

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
  const Icon = done ? CircleCheckIcon : CircleIcon;
  return (
    <li className="flex items-start gap-2">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", done ? "text-success" : "text-muted-foreground/60")} />
      <span className={cn("text-pretty", !done && "text-muted-foreground")}>
        <span className="sr-only">{done ? "Done: " : "To do: "}</span>
        {children}
      </span>
    </li>
  );
}

function OpenClose({ close, companyRole }: { close: CloseSummary; companyRole: "owner" | "contributor" }) {
  const allSubmitted = close.months.length > 0 && close.monthsSubmitted === close.months.length;
  const accounts = close.managementAccounts;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {close.label} <span className="font-normal text-muted-foreground">· {close.rangeLabel}</span>
        </p>
        <ToneBadge tone={PERIOD_CLOSE_STATUS_META[close.status].tone}>{PERIOD_CLOSE_STATUS_META[close.status].label}</ToneBadge>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        <Step done={allSubmitted}>
          Monthly updates submitted ({close.monthsSubmitted} of {close.months.length})
        </Step>
        <Step done={accounts !== null}>
          {accounts
            ? `${DOCUMENT_TYPE_LABELS.management_accounts} uploaded (version ${accounts.version}, ${formatDate(accounts.uploadedAt)})`
            : `${DOCUMENT_TYPE_LABELS.management_accounts} not uploaded yet`}
        </Step>
        <Step done={false}>
          Totals confirmed {companyRole === "owner" ? "by you" : "by your company owner"}
        </Step>
      </ul>
    </div>
  );
}

/**
 * Quarter and half-year close (BRD §6.1, C4): what the open closes still need (every month submitted,
 * management accounts uploaded, totals confirmed), or when the next one is due. Links to Documents.
 */
export function PeriodCloseCard({
  companyId,
  open,
  upcoming,
  lastConfirmed,
  companyRole,
}: {
  companyId: string;
  open: CloseSummary[];
  upcoming: ClosePeriod[];
  lastConfirmed: CloseSummary | null;
  companyRole: "owner" | "contributor";
}) {
  if (open.length === 0 && upcoming.length === 0 && !lastConfirmed) return null;
  const next = upcoming[0];
  // With one open close, the documents page opens straight on it (?close=, module M8).
  const documentsHref =
    open.length === 1 ? `/portal/${companyId}/documents?close=${open[0].id}` : `/portal/${companyId}/documents`;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <CalendarCheck2Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2>Quarter and half-year close</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {open.map((close) => (
          <OpenClose key={close.id} close={close} companyRole={companyRole} />
        ))}
        {open.length === 0 && next ? (
          <p className="text-pretty text-muted-foreground">
            Next close:{" "}
            {upcoming.map((period, index) => (
              <span key={period.label}>
                {index > 0 ? " and " : null}
                <span className="font-medium text-foreground">{period.label}</span> ({period.rangeLabel})
              </span>
            ))}
            . Once {monthLabelLong(next.endMonth)} opens on {formatDate(monthKeyToDate(addMonths(next.endMonth, 1)))},
            you confirm the totals and upload the management accounts.
          </p>
        ) : null}
        {lastConfirmed ? (
          <p className="text-xs text-muted-foreground">
            {lastConfirmed.label} was confirmed
            {lastConfirmed.confirmedAt ? ` on ${formatDate(lastConfirmed.confirmedAt)}` : ""}.
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={documentsHref}>
            <FolderOpenIcon data-icon="inline-start" />
            Go to documents
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
