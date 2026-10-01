// Read-only label/value lists for the company pages (profile facts, internal fields for read-only
// roles). Server-compatible (no hooks).
import * as React from "react";

import { cn } from "@/lib/utils";

export function DetailList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 space-y-1">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="text-sm break-words whitespace-pre-line">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A muted placeholder for an empty value ("—" by default). */
export function EmptyValue({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
