"use client";

import { UpdatesRouteError } from "@/components/submission-form/route-states";

export default function CompanyMonthlyUpdateError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <UpdatesRouteError error={error} retry={retry} />;
}
