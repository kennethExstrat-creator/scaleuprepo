"use client";

import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Friendly fallback for errors on the company's pages without a boundary of their own (e.g. the home page).
 * It renders inside the company layout, so the sidebar stays usable. Server errors reach the browser
 * without details in production; they are logged on the server.
 */
export default function CompanyPortalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ companyId?: string }>();
  useEffect(() => {
    console.error("[portal]", error);
  }, [error]);

  return (
    <EmptyState
      className="mt-6"
      icon={TriangleAlertIcon}
      title="This page could not be loaded"
      description="Something went wrong while loading it. Please try again in a moment."
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => retry()}>
            <RotateCcwIcon data-icon="inline-start" />
            Try again
          </Button>
          {params.companyId ? (
            <Button asChild variant="ghost">
              <Link href={`/portal/${params.companyId}/updates`}>Go to monthly updates</Link>
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
