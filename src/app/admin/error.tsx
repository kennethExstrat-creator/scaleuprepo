"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Friendly fallback for errors on ScaleUp pages without a boundary of their own (e.g. the companies list or
 * a company page's header). It renders inside the admin layout, so the sidebar stays usable. Server errors
 * reach the browser without details in production; they are logged on the server.
 */
export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="This page could not be loaded"
      description="Something went wrong while loading it. Please try again in a moment. If it keeps happening, go back to the tracker."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => retry()}>
            <RotateCcwIcon data-icon="inline-start" />
            Try again
          </Button>
          <Button asChild variant="ghost">
            <Link href="/admin/tracker">Go to the tracker</Link>
          </Button>
        </div>
      }
    />
  );
}
