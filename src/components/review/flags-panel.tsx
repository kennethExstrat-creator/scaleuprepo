import { CircleAlertIcon, CircleCheckIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";

import { ToneBadge } from "@/components/app/status-badge";
import { TONE_TEXT_CLASSES } from "@/components/app/tone";
import { targetLabelFor } from "@/components/comments/target-labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CRITICAL_RUNWAY_MONTHS, FLAG_CODE_LABELS, FLAG_SEVERITY_META, VALIDATION_CODE_LABELS } from "@/lib/constants";
import { formatNumberTrimmed } from "@/lib/format";
import type { Flag } from "@/lib/metrics";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";

const MAX_ISSUES_SHOWN = 12;

export type FlagsPanelProps = {
  flags: Flag[];
  /** Server validation (get_submission_validation); null when it could not be loaded. */
  validationIssues: ValidationIssue[] | null;
  thresholds: { revenueSwingPct: number; minRunwayMonths: number };
  targetLabels: Record<string, string>;
  /** Link the thresholds to /admin/settings (Super Admin). */
  canEditThresholds: boolean;
  /** The company has ScaleUp revenue lines, so they are checked against total revenue (BRD B30). */
  checksRevenueLines?: boolean;
  className?: string;
};

/**
 * Auto-flags (BRD A7, B12: revenue swing, low runway, negative cash, blank required values; B30: ScaleUp
 * revenue lines above total revenue) from computeFlags, critical first, plus the month's validation issues.
 */
export function FlagsPanel({
  flags,
  validationIssues,
  thresholds,
  targetLabels,
  canEditThresholds,
  checksRevenueLines = false,
  className,
}: FlagsPanelProps) {
  const critical = flags.filter((flag) => flag.severity === "critical").length;
  const warnings = flags.length - critical;
  const issues = validationIssues ?? [];
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2>Auto-flags</h2>
          <span className="flex flex-wrap gap-1.5">
            {critical > 0 ? <ToneBadge tone={FLAG_SEVERITY_META.critical.tone}>{critical} critical</ToneBadge> : null}
            {warnings > 0 ? (
              <ToneBadge tone={FLAG_SEVERITY_META.warning.tone}>
                {warnings} {warnings === 1 ? "warning" : "warnings"}
              </ToneBadge>
            ) : null}
            {flags.length === 0 ? <ToneBadge tone="success">No flags</ToneBadge> : null}
          </span>
        </CardTitle>
        <CardDescription>
          Revenue swing above {formatNumberTrimmed(thresholds.revenueSwingPct, 2)}% month on month, runway under{" "}
          {formatNumberTrimmed(thresholds.minRunwayMonths, 2)} months (critical under {CRITICAL_RUNWAY_MONTHS}), negative cash
          {checksRevenueLines ? ", blank required values and ScaleUp revenue lines above total revenue." : " and blank required values."}
          {canEditThresholds ? (
            <>
              {" "}
              <Link href="/admin/settings" className="underline underline-offset-3 hover:text-foreground">
                Change thresholds
              </Link>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {flags.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
            Nothing unusual in this month&apos;s numbers.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => {
              const meta = FLAG_SEVERITY_META[flag.severity];
              const Icon = flag.severity === "critical" ? OctagonAlertIcon : TriangleAlertIcon;
              return (
                <li
                  key={flag.code}
                  className={cn(
                    "flex gap-3 rounded-lg border p-3",
                    flag.severity === "critical" ? "border-destructive/25 bg-destructive/5" : "border-warning/25 bg-warning/5",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT_CLASSES[meta.tone])} aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {FLAG_CODE_LABELS[flag.code]}
                      <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
                    </p>
                    <p className="text-sm text-pretty text-muted-foreground">{flag.message}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {validationIssues === null ? (
          <p className="flex items-center gap-2 text-sm text-warning">
            <CircleAlertIcon className="size-4" aria-hidden="true" />
            The validation checks could not be loaded. Reload the page to try again.
          </p>
        ) : issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
            All validation checks pass.
          </p>
        ) : (
          <Collapsible defaultOpen={issues.length <= 5}>
            <CollapsibleTrigger className="flex items-center gap-2 rounded-md text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <CircleAlertIcon className="size-4 text-warning" aria-hidden="true" />
              {issues.length} validation {issues.length === 1 ? "issue" : "issues"}
              <span className="font-normal text-muted-foreground">(show / hide)</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-2 flex flex-col divide-y rounded-lg border text-sm">
                {shown.map((issue, index) => (
                  <li key={`${issue.target}-${issue.code}-${index}`} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="shrink-0 font-medium sm:w-56 sm:truncate">{targetLabelFor(issue.target, targetLabels)}</span>
                    <span className="text-muted-foreground">
                      {issue.message}
                      {VALIDATION_CODE_LABELS[issue.code] ? (
                        <span className="sr-only"> ({VALIDATION_CODE_LABELS[issue.code]})</span>
                      ) : null}
                    </span>
                  </li>
                ))}
                {issues.length > shown.length ? (
                  <li className="px-3 py-2 text-muted-foreground">
                    and {issues.length - shown.length} more
                  </li>
                ) : null}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
