"use client";

import { UpdatesRouteError } from "@/components/submission-form/route-states";

export default function MonthlyUpdateError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <UpdatesRouteError error={error} retry={retry} />;
}
