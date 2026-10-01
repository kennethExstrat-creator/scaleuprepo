import {
  ArrowUpDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  HistoryIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { plural } from "../../_lib/display";
import type { ReadinessIssue, TemplateChange } from "../../_lib/rules";
import { cn } from "@/lib/utils";

const CHANGE_ICONS: Record<TemplateChange["type"], { icon: typeof PlusIcon; className: string }> = {
  added: { icon: PlusIcon, className: "text-success" },
  removed: { icon: MinusIcon, className: "text-destructive" },
  changed: { icon: PencilIcon, className: "text-muted-foreground" },
  reordered: { icon: ArrowUpDownIcon, className: "text-muted-foreground" },
};

/**
 * Above the structure. For a draft: whether it can be published (blocking issues and warnings) and
 * what it changes compared with the published version. For a published or archived version: what
 * changed compared with the version before it.
 */
export function VersionStatusPanel({
  mode,
  issues,
  changes,
  baseVersionNo,
  versionNo,
  notes,
}: {
  mode: "draft" | "history";
  issues: ReadinessIssue[];
  changes: TemplateChange[];
  /** The version compared with; null when there is none (the template's first version). */
  baseVersionNo: number | null;
  versionNo: number;
  /** Release notes of a published or archived version. */
  notes?: string | null;
}) {
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  let icon: React.ReactNode;
  let heading: string;
  if (mode === "draft") {
    icon =
      errors.length > 0 ? (
        <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      );
    heading = errors.length > 0 ? `Fix ${plural(errors.length, "issue")} before publishing` : "Ready to publish";
  } else {
    icon = <HistoryIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    heading = `What changed in version ${versionNo}`;
  }

  let summary: string;
  if (baseVersionNo === null) {
    summary = mode === "draft" ? "This will be the first published version of the template." : "The first version of the template.";
  } else if (changes.length === 0) {
    summary =
      mode === "draft"
        ? `No changes compared with version ${baseVersionNo} yet.`
        : `No changes compared with version ${baseVersionNo}.`;
  } else {
    summary = `${plural(changes.length, "change")} compared with version ${baseVersionNo}.`;
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-start gap-3 p-4">
        {icon}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="font-medium">{heading}</h2>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
          {mode === "history" && notes ? (
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <p className="text-xs font-medium text-muted-foreground">Release notes</p>
              <p className="whitespace-pre-line">{notes}</p>
            </div>
          ) : null}
          {errors.length > 0 || warnings.length > 0 ? (
            // Keyed by position: messages can repeat (two sections may share a title, two fields a label).
            <ul className="space-y-1 text-sm">
              {errors.map((issue, index) => (
                <li key={`error-${index}`} className="flex items-start gap-2 text-destructive">
                  <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only">Must fix: </span>
                    {issue.message}
                  </span>
                </li>
              ))}
              {warnings.map((issue, index) => (
                <li key={`warning-${index}`} className="flex items-start gap-2 text-warning">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="sr-only">Check: </span>
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {changes.length > 0 ? (
        <details className="group border-t" open={mode === "history" && changes.length <= 8}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium outline-none select-none hover:bg-muted/50 focus-visible:bg-muted/50 [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
            {mode === "draft" ? "Changes in this draft" : "Changes"} ({changes.length})
          </summary>
          <ul className="space-y-1.5 px-4 pb-4 text-sm">
            {changes.map((change, index) => {
              const meta = CHANGE_ICONS[change.type];
              const Icon = meta.icon;
              return (
                <li key={`${index}-${change.text}`} className="flex items-start gap-2">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} aria-hidden="true" />
                  <span>{change.text}</span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
