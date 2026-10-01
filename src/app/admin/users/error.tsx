"use client";

import { RotateCwIcon, UsersIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

/** Friendly fallback when the Users page cannot load (e.g. the database is unreachable). */
export default function UsersError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader title="Users" />
      <EmptyState
        icon={UsersIcon}
        title="We couldn't load the users"
        description="Something went wrong while loading people and their access. Please try again in a moment."
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
