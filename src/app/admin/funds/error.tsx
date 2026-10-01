"use client";

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when /admin/funds fails to render (details are in the server log). */
export default function FundsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="The funds page couldn't be loaded"
      description="Something went wrong on our side. Please try again; if it keeps happening, reload the page."
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCwIcon data-icon="inline-start" />
          Try again
        </Button>
      }
    />
  );
}
