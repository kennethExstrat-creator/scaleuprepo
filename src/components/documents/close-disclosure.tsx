"use client";

import { ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * A period close card that opens and closes: the summary and actions always show, the details
 * (months, totals, documents) fold away. Summary, actions and details are rendered on the server.
 */
export function CloseDisclosure({
  id,
  label,
  defaultOpen,
  summary,
  actions,
  children,
}: {
  /** DOM id of the card (anchor for links such as `#close-<id>`). */
  id: string;
  /** Close label for the toggle's accessible name, e.g. "Q3 2026". */
  label: string;
  defaultOpen: boolean;
  summary: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <Collapsible
      id={id}
      open={open}
      onOpenChange={setOpen}
      className="scroll-mt-20 rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">{summary}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={open ? `Hide the details of ${label}` : `Show the details of ${label}`}>
              <span aria-hidden="true">{open ? "Hide details" : "Details"}</span>
              <ChevronDownIcon
                data-icon="inline-end"
                aria-hidden="true"
                className={cn("transition-transform duration-150", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <div className="border-t px-4 py-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
