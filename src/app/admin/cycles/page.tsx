import type { Metadata } from "next";

import {
  canExtendDueDate,
  canManageCycles,
  canManagePlatform,
  canManageTemplates,
  canViewAudit,
} from "@/lib/auth/permissions";
import { firstParam } from "@/lib/auth/redirects";
import { isUuid, requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import { CyclesWorkspace } from "./_components/cycles-workspace";
import { parseCycleTab } from "./_lib/cycles-model";
import { loadCycles } from "./_lib/load-cycles";

export const metadata: Metadata = { title: "Cycles" };

/**
 * Reporting cycles (module M4, BRD A5): Super Admins and Fund Admins. Opens the months that are due first
 * (open_due_periods), then shows the reporting months with their progress, deadline extensions, quarter
 * and half closes and FX rates. ?tab=months|deadlines|closes|fx picks the tab; ?extend=<submission id>
 * opens "Extend a deadline" on that month.
 */
export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireScaleUp(["super_admin", "fund_admin"]);
  const query = await searchParams;
  const sb = await createClient();
  const { data, openError } = await loadCycles(sb);
  const extendParam = firstParam(query.extend);

  return (
    <CyclesWorkspace
      data={data}
      openError={openError}
      initialTab={parseCycleTab(query.tab)}
      initialExtendId={isUuid(extendParam) ? extendParam.toLowerCase() : null}
      canOpenMonths={canManageCycles(ctx)}
      canExtend={canExtendDueDate(ctx)}
      canManageFx={canManageTemplates(ctx)}
      canEditSettings={canManagePlatform(ctx)}
      canViewAudit={canViewAudit(ctx)}
    />
  );
}
