"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly error for the history page. */
export default function HistoryError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[portal history]", error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="We couldn't load your history"
      description="Something went wrong on our side. Please try again in a moment."
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      }
    />
  );
}
