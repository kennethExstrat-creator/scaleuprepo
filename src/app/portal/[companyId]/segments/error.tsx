"use client";

import { ChartPieIcon, RotateCwIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the revenue segments page cannot load. */
export default function RevenueSegmentsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader title="Revenue segments" />
      <EmptyState
        icon={ChartPieIcon}
        title="We couldn't load your revenue segments"
        description={
          <>
            Something went wrong on our side or the connection dropped. Your saved segments are safe.
            {error.digest ? <span className="mt-1 block text-xs">Reference: {error.digest}</span> : null}
          </>
        }
        action={
          <Button onClick={() => retry()}>
            <RotateCwIcon data-icon="inline-start" />
            Try again
          </Button>
        }
      />
    </div>
  );
}
