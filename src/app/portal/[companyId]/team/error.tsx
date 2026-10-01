"use client";

import { RotateCwIcon, UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the Team page cannot load. */
export default function TeamError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader title="Team" />
      <EmptyState
        icon={UsersIcon}
        title="We couldn't load your team"
        description="Something went wrong while loading the team. Please try again in a moment."
        action={
          <Button onClick={() => retry()}>
            <RotateCwIcon data-icon="inline-start" />
            Try again
          </Button>
        }
      />
    </>
  );
}
