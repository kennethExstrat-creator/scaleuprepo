"use client";

import { Building2Icon, CalendarX2Icon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

import {
  DEFAULT_TRACKER_FILTERS,
  buildTracker,
  hasActiveFilters,
  plural,
  trackerHref,
  type StatusFilter,
  type TrackerAttention,
  type TrackerData,
  type TrackerFilters,
} from "../_lib/tracker-model";
import { NotReportingSection } from "./not-reporting-section";
import { TrackerGrid } from "./tracker-grid";
import { TrackerLegend } from "./tracker-legend";
import { TrackerSummaryCards } from "./tracker-summary";
import { TrackerToolbar } from "./tracker-toolbar";

function FilterLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

/**
 * "Across these 6 months: 2 overdue (1 escalated) · 3 awaiting review · 1 changes requested · 1 amendment
 * requested".
 */
function AttentionLine({
  attention,
  months,
  onFilter,
}: {
  attention: TrackerAttention;
  months: number;
  onFilter: (filter: StatusFilter) => void;
}) {
  const parts: React.ReactNode[] = [];
  if (attention.overdue > 0) {
    parts.push(
      <span key="overdue">
        <FilterLink onClick={() => onFilter("overdue")}>{attention.overdue} overdue</FilterLink>
        {attention.escalated > 0 ? (
          <>
            {" ("}
            <FilterLink onClick={() => onFilter("escalated")}>{attention.escalated} escalated</FilterLink>)
          </>
        ) : null}
      </span>,
    );
  }
  if (attention.awaitingReview > 0) {
    parts.push(
      <FilterLink key="submitted" onClick={() => onFilter("submitted")}>
        {attention.awaitingReview} awaiting review
      </FilterLink>,
    );
  }
  if (attention.changesRequested > 0) {
    parts.push(
      <FilterLink key="changes" onClick={() => onFilter("changes_requested")}>
        {attention.changesRequested} with changes requested
      </FilterLink>,
    );
  }
  if (attention.amendmentRequested > 0) {
    parts.push(
      <FilterLink key="amendments" onClick={() => onFilter("amendment_requested")}>
        {attention.amendmentRequested} {attention.amendmentRequested === 1 ? "amendment" : "amendments"} requested
      </FilterLink>,
    );
  }
  const span = months === 1 ? "this month" : `these ${months} months`;
  if (parts.length === 0) return <span>Nothing overdue or waiting for review in {span}.</span>;
  return (
    <span>
      Across {span}:{" "}
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? " · " : null}
          {part}
        </span>
      ))}
    </span>
  );
}

/**
 * The interactive tracker (BRD A6): filters, summary cards, the company × month grid, the legend and
 * the "Not yet reporting" group. Built on the client from the loaded portfolio, so filtering is instant;
 * the filters are mirrored in the URL with history.replaceState (shareable, restored on reload). The
 * page remounts this component on every server render (key), so a navigation starts from its URL.
 */
export function TrackerWorkspace({
  data,
  initialFilters,
  canSetStartMonth,
}: {
  data: TrackerData;
  initialFilters: TrackerFilters;
  canSetStartMonth: boolean;
}) {
  const [filters, setFilters] = useState<TrackerFilters>(initialFilters);
  const search = useDeferredValue(filters.search);
  const model = useMemo(() => buildTracker(data, { ...filters, search }), [data, filters, search]);
  const href = trackerHref(model.filters);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (`${window.location.pathname}${window.location.search}` === href) return;
      try {
        window.history.replaceState(null, "", href);
      } catch {
        // Browsers rate-limit history updates; the filters still apply, only the URL lags behind.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [href]);

  const update = (patch: Partial<TrackerFilters>) => setFilters((previous) => ({ ...previous, ...patch }));
  const clear = () => setFilters((previous) => ({ ...DEFAULT_TRACKER_FILTERS, months: previous.months }));
  const setStatus = (status: StatusFilter | null) => update({ status });

  const filtersActive = hasActiveFilters({ ...filters, fund: model.filters.fund, partner: model.filters.partner });
  const noMonths = model.columns.length === 0;
  const noReportingCompanies = model.reportingInScope === 0 && !model.filters.fund && !model.filters.partner;

  const countText =
    model.rows.length === model.reportingInScope
      ? plural(model.rows.length, "reporting company", "reporting companies")
      : `${model.rows.length} of ${plural(model.reportingInScope, "reporting company", "reporting companies")}`;

  let grid: React.ReactNode;
  if (noMonths) {
    grid = (
      <EmptyState
        icon={CalendarX2Icon}
        title="No months are open yet"
        description="A month opens on the 1st of the following month for every company with a reporting start month. Months only open once the default reporting template is published."
      />
    );
  } else if (model.rows.length === 0 && noReportingCompanies) {
    grid = (
      <EmptyState
        icon={Building2Icon}
        title="No company is reporting yet"
        description="Companies start monthly reporting once ScaleUp sets their reporting start month."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/companies">Go to companies</Link>
          </Button>
        }
      />
    );
  } else if (model.rows.length === 0) {
    const othersBelow = model.notReporting.length > 0;
    grid = (
      <EmptyState
        icon={SearchXIcon}
        title={othersBelow ? "No reporting companies match these filters" : "No companies match these filters"}
        description={
          othersBelow
            ? "The matching companies are not reporting yet; they are listed below."
            : "Try another fund, partner or status, or clear the filters."
        }
        action={
          <Button variant="outline" size="sm" onClick={clear}>
            Clear filters
          </Button>
        }
      />
    );
  } else {
    grid = <TrackerGrid columns={model.columns} rows={model.rows} captionId="tracker-grid-caption" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <TrackerToolbar
        search={filters.search}
        fund={model.filters.fund}
        partner={model.filters.partner}
        status={model.filters.status}
        months={model.filters.months}
        fundOptions={model.options.funds}
        partnerOptions={model.options.partners}
        canClear={filtersActive}
        onSearch={(value) => update({ search: value })}
        onFund={(fund) => update({ fund })}
        onPartner={(partner) => update({ partner })}
        onStatus={setStatus}
        onMonths={(months) => update({ months })}
        onClear={clear}
      />

      {noMonths ? null : (
        <TrackerSummaryCards
          summary={model.summary}
          escalationDays={model.escalationDays}
          activeFilter={model.filters.status}
          onFilter={setStatus}
        />
      )}

      <section aria-labelledby="tracker-grid-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <h2 id="tracker-grid-heading" className="text-sm font-medium">
            Companies by month
            <span className="font-normal text-muted-foreground"> · {countText}</span>
          </h2>
          <p className="sr-only" aria-live="polite">
            Showing {countText}.
          </p>
          {noMonths ? null : (
            <p className="text-sm text-muted-foreground">
              <AttentionLine attention={model.attention} months={model.columns.length} onFilter={setStatus} />
            </p>
          )}
        </div>
        {grid}
        {noMonths || model.rows.length === 0 ? null : <TrackerLegend escalationDays={model.escalationDays} />}
      </section>

      <NotReportingSection companies={model.notReporting} canSetStartMonth={canSetStartMonth} />
    </div>
  );
}
