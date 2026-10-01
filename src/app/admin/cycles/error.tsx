"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly error for /admin/cycles (e.g. the database could not be reached). */
export default function CyclesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[cycles]", error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="The reporting cycles could not be loaded"
      description="Something went wrong while loading the months, deadlines and FX rates. Please try again in a moment."
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      }
    />
  );
}
