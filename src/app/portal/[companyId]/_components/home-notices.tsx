import { CalendarClockIcon, HistoryIcon, InfoIcon, LockIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { COMPANY_STATUS_LABELS } from "@/lib/constants";
import { monthLabelLong } from "@/lib/periods";
import type { CompanyStatus } from "@/lib/types/enums";

import { monthListText } from "./home-model";

/** Exited / written-off companies are read-only for their members (BRD B15, B21). */
export function ReadOnlyNotice({ companyName, status }: { companyName: string; status: CompanyStatus }) {
  return (
    <Alert className="border-foreground/15 bg-muted/60">
      <LockIcon aria-hidden="true" />
      <AlertTitle>Read-only: {COMPANY_STATUS_LABELS[status]}</AlertTitle>
      <AlertDescription>
        {companyName} is no longer an active portfolio company, so its records are read-only and no new months
        are opened. You can still view past monthly updates, documents and history.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Nothing on the platform yet: no reporting start month (BRD B16). A company that is no longer active
 * (`readOnly`, BRD B15) will not start reporting, so it only says there is nothing to show.
 */
export function NotReportingState({ readOnly = false }: { readOnly?: boolean }) {
  if (readOnly) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="No monthly updates on the platform"
        description="No monthly updates were reported on the platform before the company's records became read-only."
        className="py-12"
      />
    );
  }
  return (
    <EmptyState
      icon={CalendarClockIcon}
      title="Monthly reporting hasn't started yet"
      description="ScaleUp will let you know when monthly reporting starts. There is nothing to submit until then."
      className="py-12"
    />
  );
}

/**
 * Drafts left from before the reporting start month (ScaleUp moved the start month later): they are not
 * required, never overdue, and do not hold up later months (draftsBeforeStart).
 */
export function EarlierMonthsNotice({ months, startMonth }: { months: readonly { month: string }[]; startMonth: string }) {
  if (months.length === 0) return null;
  const one = months.length === 1;
  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>{one ? "An earlier month isn't required" : "Earlier months aren't required"}</AlertTitle>
      <AlertDescription>
        {monthListText(months)} {one ? "is" : "are"} before your reporting start month ({monthLabelLong(startMonth)}),
        so you don&apos;t need to submit {one ? "it" : "them"}. You can still find {one ? "it" : "them"} under All
        monthly updates.
      </AlertDescription>
    </Alert>
  );
}

/** Not reporting any more (no start month), but months from before are still here. */
export function NotReportingNotice() {
  return (
    <Alert>
      <InfoIcon aria-hidden="true" />
      <AlertTitle>No new months are being requested</AlertTitle>
      <AlertDescription>
        ScaleUp will let you know when monthly reporting starts again. Your earlier months are still available.
      </AlertDescription>
    </Alert>
  );
}

/** Friendly error when the home page's data could not be loaded. */
export function HomeLoadError({ companyId }: { companyId: string }) {
  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="We couldn't load your home page"
      description="Something went wrong on our side. Please try again in a moment."
      className="py-12"
      action={
        <Button asChild variant="outline">
          <Link href={`/portal/${companyId}`} prefetch={false}>
            <RotateCcwIcon data-icon="inline-start" />
            Try again
          </Link>
        </Button>
      }
    />
  );
}
