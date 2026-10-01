"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the review page fails to load (the details are in the server log). */
export default function ReviewError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[review] the page could not be loaded", error);
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="This monthly update could not be loaded"
      description={
        <>
          Something went wrong while loading the review. Please try again; if it keeps happening, let the platform
          administrator know{error.digest ? ` (reference ${error.digest})` : ""}.
        </>
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => retry()}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/tracker">Back to the tracker</Link>
          </Button>
        </div>
      }
      className="py-16"
    />
  );
}
