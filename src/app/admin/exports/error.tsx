"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the exports page cannot load its lists. */
export default function ExportsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="The exports page could not be loaded"
      description="Something went wrong while loading the companies and funds. Please try again in a moment."
      action={
        <Button onClick={() => retry()} variant="outline">
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          Try again
        </Button>
      }
    />
  );
}
