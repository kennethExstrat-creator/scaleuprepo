"use client";

import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ToneBadge } from "@/components/app/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { COMPANY_STATUS_META, NOT_YET_REPORTING_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

import type { TrackerCompany } from "../_lib/tracker-model";
import { FundCodes } from "./tracker-grid";

/**
 * "Not yet reporting (15)": companies without a reporting start month (BRD B16), collapsed at the
 * bottom of the tracker. Super Admins get a shortcut to the company page, where the start month is set.
 */
export function NotReportingSection({
  companies,
  canSetStartMonth,
}: {
  companies: TrackerCompany[];
  canSetStartMonth: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (companies.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl bg-card ring-1 ring-foreground/10">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {NOT_YET_REPORTING_META.label} ({companies.length})
            </span>
            <span className="block text-xs text-muted-foreground">
              No reporting start month yet, so no monthly updates are requested.
            </span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t">
          {companies.map((company) => (
            <li key={company.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link
                  href={`/admin/companies/${company.id}`}
                  prefetch={false}
                  className="w-fit max-w-full truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {company.name}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <FundCodes funds={company.funds} />
                  <span>{company.partner ? company.partner.name : "No partner-in-charge"}</span>
                </div>
              </div>
              {company.status !== "active" ? (
                <ToneBadge tone={COMPANY_STATUS_META[company.status].tone}>
                  {COMPANY_STATUS_META[company.status].label}
                </ToneBadge>
              ) : (
                <ToneBadge tone={NOT_YET_REPORTING_META.tone} title={NOT_YET_REPORTING_META.description}>
                  {NOT_YET_REPORTING_META.label}
                </ToneBadge>
              )}
              {canSetStartMonth && company.status === "active" ? (
                <Link
                  href={`/admin/companies/${company.id}`}
                  prefetch={false}
                  className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  Set start month
                  <ArrowRightIcon aria-hidden="true" className="size-3" />
                  <span className="sr-only"> for {company.name}</span>
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
