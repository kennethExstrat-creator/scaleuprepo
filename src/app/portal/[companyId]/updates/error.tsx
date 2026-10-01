"use client";

import { UpdatesRouteError } from "@/components/submission-form/route-states";

export default function MonthlyUpdatesError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <UpdatesRouteError error={error} retry={retry} title="We couldn't load your monthly updates" />;
}
