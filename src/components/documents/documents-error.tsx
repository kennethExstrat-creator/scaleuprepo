"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Error boundary content of the documents pages: a friendly message and "Try again". */
export function DocumentsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[documents] page error", error.digest ?? error.message);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="We couldn't load the documents"
      description={
        <>
          Something went wrong while loading this page. Please try again in a moment.
          {error.digest ? <span className="mt-2 block text-xs">Reference: {error.digest}</span> : null}
        </>
      }
      action={<Button onClick={() => retry()}>Try again</Button>}
    />
  );
}
