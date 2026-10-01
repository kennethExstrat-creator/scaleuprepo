import { LockIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { COMPANY_TABS, companyTabHref, type CompanyTab } from "./tabs";

/** The company page's sections as links (?tab=…), scrollable on small screens. */
export function CompanyTabsNav({ companyId, active }: { companyId: string; active: CompanyTab }) {
  return (
    <nav aria-label="Company sections" className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
      <ul className="flex min-w-max gap-1">
        {COMPANY_TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={companyTabHref(companyId, tab.key)}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center gap-1.5 rounded-t-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  current &&
                    "text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
                )}
              >
                {tab.key === "internal" ? <LockIcon className="size-3.5" aria-hidden="true" /> : null}
                {tab.label}
                {tab.key === "internal" ? <span className="sr-only"> (ScaleUp only)</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
