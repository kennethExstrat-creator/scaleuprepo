// The review page's auto-flags (BRD A7, B12, B30): computeFlags exactly as docs/ARCHITECTURE.md §6 "Review"
// describes, plus the ScaleUp revenue lines check (`scaleupLinesTotal`). Pure and client-safe.
import { computeFlags, type Flag } from "@/lib/metrics";
import type { SubmissionBundle } from "@/lib/types/domain";
import type { ValidationIssue } from "@/lib/validation";

import { scaleupLinesTotal, shownFinancials } from "./comparison";

export type ReviewFlagsInput = Pick<
  SubmissionBundle,
  "submission" | "company" | "config" | "current" | "previous" | "lastYear" | "financials" | "settings"
>;

/**
 * Flags for the month under review, critical first: missing required values (from the server validation),
 * negative cash, low runway, a revenue swing against the prior month (thresholds from the platform settings,
 * which ScaleUp staff always get) and ScaleUp revenue lines adding up to more than total revenue.
 */
export function reviewFlags(bundle: ReviewFlagsInput, validationErrors: ReadonlyArray<ValidationIssue>): Flag[] {
  // Months still open for changes count total revenue from the company's own segments, as the comparison
  // table shows it (shownFinancials, BRD B30).
  const snapshot = (month: NonNullable<ReviewFlagsInput["previous"]> | null) =>
    month
      ? shownFinancials(month.financials, { status: month.submission.status, values: month.values }, bundle.config)
      : null;
  return computeFlags({
    current: shownFinancials(bundle.financials, { status: bundle.submission.status, values: bundle.current }, bundle.config),
    previous: snapshot(bundle.previous),
    sameMonthLastYear: snapshot(bundle.lastYear),
    settings: bundle.settings ?? undefined,
    validationErrors,
    scaleupLinesTotal: scaleupLinesTotal(bundle),
    currency: bundle.company.reporting_currency.trim(),
  });
}
