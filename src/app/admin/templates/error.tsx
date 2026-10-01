"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the template pages cannot load (e.g. the database is unreachable). */
export default function TemplatesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[templates] page error", error);
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlertIcon}
      title="The templates could not be loaded"
      description="Something went wrong while loading this page. Please try again. If it keeps happening, let your platform administrator know."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/admin/templates">Back to templates</Link>
          </Button>
        </div>
      }
    />
  );
}
