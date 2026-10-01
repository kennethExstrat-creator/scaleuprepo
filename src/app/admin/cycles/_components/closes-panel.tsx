import { ArrowUpRightIcon, CalendarCheckIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLOSE_PERIOD_TYPE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { monthLabelLong } from "@/lib/periods";
import { cn } from "@/lib/utils";

import { plural, type CloseGroup, type UpcomingClose } from "../_lib/cycles-model";

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-b-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function documentsHref(key: string): string {
  return `/admin/documents?period=${encodeURIComponent(key)}`;
}

/**
 * Quarter and half closes (BRD §6.1 "Period close", B6, B13): the next ones by the calendar, and the ones
 * already open with how many companies have confirmed them. Each links to the Documents page, where the
 * closes, management accounts and confirmations are handled.
 */
export function ClosesPanel({ upcoming, closes }: { upcoming: UpcomingClose[]; closes: CloseGroup[] }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-sm text-pretty text-muted-foreground">
        Quarters and halves follow the calendar year (Q1 = January to March, H1 = January to June). A close opens
        for each reporting company when the period&apos;s last month opens. The company then confirms the period
        totals and uploads its management accounts, once every month of the period is submitted.
      </p>

      <section aria-labelledby="upcoming-closes-heading" className="flex flex-col gap-3">
        <h2 id="upcoming-closes-heading" className="text-sm font-medium">
          Coming up
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {upcoming.map((close) => (
            <Card key={close.key} size="sm">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {close.period.label}
                  <ToneBadge tone="neutral">{CLOSE_PERIOD_TYPE_LABELS[close.period.type]}</ToneBadge>
                </CardTitle>
                <CardDescription>{close.period.rangeLabel}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="text-sm">
                  <Detail term="Closes with">{monthLabelLong(close.lastMonth)}</Detail>
                  <Detail term="Opens to companies">{formatDate(close.opensOn)}</Detail>
                  <Detail term="Last month due">{formatDate(close.dueDate)}</Detail>
                  <Detail term="Companies reporting by then">{close.companies}</Detail>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="open-closes-heading" className="flex flex-col gap-3">
        <h2 id="open-closes-heading" className="text-sm font-medium">
          Opened closes
        </h2>
        {closes.length === 0 ? (
          <EmptyState
            icon={CalendarCheckIcon}
            title="No closes yet"
            description="The first quarter close opens with the first March, June, September or December a company reports."
          />
        ) : (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="min-w-36">Period</TableHead>
                    <TableHead className="hidden sm:table-cell">Ends</TableHead>
                    <TableHead className="text-right">Companies</TableHead>
                    <TableHead className="text-right">Confirmed</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead>
                      <span className="sr-only">Documents</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closes.map((close) => (
                    <TableRow key={close.key}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{close.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {CLOSE_PERIOD_TYPE_LABELS[close.type]} · {close.rangeLabel}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap tabular-nums sm:table-cell">
                        {formatDate(close.endDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{close.companies}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          close.confirmed === close.companies && close.companies > 0 && "font-medium text-success",
                        )}
                      >
                        {close.confirmed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{close.open}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={documentsHref(close.key)}
                            aria-label={`Open the ${close.label} closes in Documents (${plural(close.companies, "company", "companies")})`}
                          >
                            Documents
                            <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
