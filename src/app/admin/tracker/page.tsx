import { TriangleAlertIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { canManagePlatform } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { TrackerWorkspace } from "./_components/tracker-workspace";
import { loadTracker } from "./_lib/load-tracker";
import { parseTrackerFilters } from "./_lib/tracker-model";

export const metadata: Metadata = { title: "Tracker" };

/**
 * Submission tracker (BRD A6, O7): every portfolio company by month, for every ScaleUp role. Opens the
 * months that are due first (open_due_periods), then loads the last 12 open months; the workspace
 * filters them on the client. Filters live in the URL: ?fund=SV1&partner=<profile id>|none
 * &status=needs_attention|overdue|escalated|not_submitted|submitted|changes_requested|approved
 * &months=6|12&search=<text>.
 */
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireScaleUp();
  const filters = parseTrackerFilters(await searchParams);
  const sb = await createClient();
  const { data, openError, loadId } = await loadTracker(sb, ctx.userId);

  return (
    <>
      <PageHeader
        title="Submission tracker"
        description="Monthly updates across the portfolio, company by month. Open a month to review it."
      />
      {openError ? (
        <Alert className="mb-6 border-warning/30 bg-warning/5">
          <TriangleAlertIcon aria-hidden="true" className="text-warning" />
          <AlertTitle>New months could not be opened</AlertTitle>
          <AlertDescription>{openError} The tracker shows the months that are already open.</AlertDescription>
        </Alert>
      ) : null}
      <TrackerWorkspace
        key={loadId}
        data={data}
        initialFilters={filters}
        canSetStartMonth={canManagePlatform(ctx)}
      />
    </>
  );
}
