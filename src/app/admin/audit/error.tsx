"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the audit log cannot be loaded. */
export default function AuditLogError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="The audit log could not be loaded"
      description="Something went wrong while reading the audit log. Please try again, or clear the filters."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()} variant="outline">
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/audit">Clear filters</Link>
          </Button>
        </div>
      }
    />
  );
}
