"use client";

import { CalendarX2Icon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/** Error boundary content of the monthly update pages (error.tsx): a friendly message and "Try again". */
export function UpdatesRouteError({
  error,
  retry,
  title = "We couldn't load this monthly update",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      className="mx-auto mt-6 w-full max-w-2xl"
      icon={TriangleAlertIcon}
      title={title}
      description={
        <>
          Something went wrong on our side or the connection dropped. Your saved figures are safe.
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
  );
}

/** not-found.tsx content of a [month] page: the month does not exist (not opened yet) or is not visible. */
export function MonthNotFound({ audience }: { audience: "company" | "scaleup" }) {
  const params = useParams<{ companyId?: string }>();
  const companyId = typeof params?.companyId === "string" ? params.companyId : null;
  const href =
    audience === "company"
      ? companyId
        ? `/portal/${companyId}/updates`
        : "/portal"
      : companyId
        ? `/admin/companies/${companyId}`
        : "/admin/companies";
  return (
    <EmptyState
      className="mx-auto mt-6 w-full max-w-2xl"
      icon={CalendarX2Icon}
      title="This month isn't available"
      description="There is no monthly update for this month. It may not have opened yet: a month opens on the 1st of the following month."
      action={
        <Button asChild variant="outline">
          <Link href={href}>{audience === "company" ? "Back to monthly updates" : "Back to the company"}</Link>
        </Button>
      }
    />
  );
}
