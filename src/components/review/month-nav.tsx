import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SUBMISSION_STATUS_META } from "@/lib/constants";
import { monthLabel, monthLabelLong } from "@/lib/periods";
import type { SubmissionStatus } from "@/lib/types/enums";

export type MonthLink = { id: string; month: string; status: SubmissionStatus };

/** Previous / next month of the same company on the review page (disabled at either end). */
export function MonthNav({ previous, next }: { previous: MonthLink | null; next: MonthLink | null }) {
  return (
    <nav aria-label="Other months of this company" className="flex items-center gap-2">
      {previous ? (
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/admin/review/${previous.id}`}
            aria-label={`Previous month: ${monthLabelLong(previous.month)} (${SUBMISSION_STATUS_META[previous.status].label})`}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            {monthLabel(previous.month)}
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label="No earlier month">
          <ChevronLeftIcon data-icon="inline-start" />
          Earlier
        </Button>
      )}
      {next ? (
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/admin/review/${next.id}`}
            aria-label={`Next month: ${monthLabelLong(next.month)} (${SUBMISSION_STATUS_META[next.status].label})`}
          >
            {monthLabel(next.month)}
            <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label="No later month">
          Later
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      )}
    </nav>
  );
}
