import { FileTextIcon } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { dateToMonthKey } from "@/lib/periods";
import type { CompanyRole } from "@/lib/types/enums";

import { FocusCard, ReadOnlyLatestCard, StartsLaterCard, UpToDateCard } from "./focus-card";
import {
  changeRequests,
  draftsBeforeStart,
  latestFigures,
  latestMonth,
  latestSubmittedMonth,
  monthsNeedingAction,
  nextMonthToOpen,
  openThreadMonths,
  overdueMonths,
  summariseCloses,
  upcomingCloses,
  type HomeData,
} from "./home-model";
import { EarlierMonthsNotice, NotReportingNotice, NotReportingState, ReadOnlyNotice } from "./home-notices";
import { LatestFiguresCard } from "./latest-figures-card";
import { PeriodCloseCard } from "./period-close-card";
import { ChangesRequestedCard, CommentsCard, MissingNumbersCard } from "./requests-cards";

/**
 * The company home (BRD C2) for loaded data: the month to work on next, overdue months in red, changes
 * requested by ScaleUp, open comment threads, the latest submitted figures and the next quarter / half
 * close. Exited / written-off companies get a read-only view; companies without a reporting start month
 * the "not reporting yet" state (BRD B16).
 */
export function HomeView({
  companyId,
  companyRole,
  data,
}: {
  companyId: string;
  companyRole: CompanyRole;
  data: HomeData;
}) {
  const { company, submissions, today } = data;
  const active = company.status === "active";
  const reporting = company.reporting_start_month !== null;
  const currency = company.reporting_currency.trim();

  const header = (
    <PageHeader
      title={company.name}
      description={
        <>
          Your monthly reporting to ScaleUp at a glance.
          {currency !== "MYR" ? ` Figures are in ${currency}.` : ""}
        </>
      }
      actions={
        submissions.length > 0 ? (
          <Button asChild variant="outline">
            <Link href={`/portal/${companyId}/updates`}>
              <FileTextIcon data-icon="inline-start" />
              All monthly updates
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (!reporting && submissions.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-6">
          {active ? null : <ReadOnlyNotice companyName={company.name} status={company.status} />}
          <NotReportingState readOnly={!active} />
        </div>
      </>
    );
  }

  // Months to submit (monthsNeedingAction): from the reporting start month on, plus months sent back.
  // Drafts left from before a start month that was moved later, or cleared, are not chased (never overdue).
  const toDo = monthsNeedingAction(submissions, company.reporting_start_month);
  const focus = active ? (toDo[0] ?? null) : null;
  const earlierDrafts = active ? draftsBeforeStart(submissions, company.reporting_start_month) : [];
  const latest = latestMonth(submissions);
  const latestSubmitted = latestSubmittedMonth(submissions);
  const next = nextMonthToOpen({
    status: company.status,
    startMonth: company.reporting_start_month,
    latest: latest ? dateToMonthKey(latest.month) : null,
    today,
    dueDay: data.dueDay,
  });
  const threads = openThreadMonths(submissions);
  const closes = summariseCloses({
    closes: data.closes,
    documents: data.managementAccounts,
    submissions,
    startMonth: company.reporting_start_month,
  });

  let mainCard: React.ReactNode = null;
  if (focus) {
    mainCard = (
      <FocusCard companyId={companyId} focus={focus} later={toDo.slice(1)} companyRole={companyRole} today={today} />
    );
  } else if (!active && latest) {
    mainCard = <ReadOnlyLatestCard companyId={companyId} latest={latest} />;
  } else if (latestSubmitted) {
    mainCard = <UpToDateCard companyId={companyId} latest={latestSubmitted} next={next} />;
  } else if (next) {
    mainCard = <StartsLaterCard next={next} />;
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        {active ? null : <ReadOnlyNotice companyName={company.name} status={company.status} />}
        {active && !reporting ? <NotReportingNotice /> : null}
        {company.reporting_start_month && earlierDrafts.length > 0 ? (
          <EarlierMonthsNotice months={earlierDrafts} startMonth={company.reporting_start_month} />
        ) : null}
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            {mainCard}
            <MissingNumbersCard companyId={companyId} months={active ? overdueMonths(submissions) : []} />
            <ChangesRequestedCard
              companyId={companyId}
              requests={active ? changeRequests(submissions, data.changeEvents, data.staffNames) : []}
            />
            <LatestFiguresCard companyId={companyId} figures={latestFigures(data.series)} />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <CommentsCard companyId={companyId} total={threads.total} months={threads.months} readOnly={!active} />
            <PeriodCloseCard
              companyId={companyId}
              open={active ? closes.open : []}
              upcoming={upcomingCloses({
                status: company.status,
                startMonth: company.reporting_start_month,
                today,
                closes: data.closes,
              })}
              lastConfirmed={closes.lastConfirmed}
              companyRole={companyRole}
            />
          </div>
        </div>
      </div>
    </>
  );
}
