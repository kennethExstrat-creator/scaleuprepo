import { canManageTemplates } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { getCompanyConfig } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";

import { loadKpiUsage } from "../../_components/queries";
import { DimensionsEditor, type DimensionItem } from "./dimensions-editor";
import { KpisEditor, type DimensionChoice, type KpiItem } from "./kpis-editor";

/** KPIs and dimensions (BRD §6.2, A4): every ScaleUp role reads; Super Admins and Fund Admins manage. */
export async function KpisTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const config = await getCompanyConfig(sb, company.id);
  const usage = await loadKpiUsage(
    sb,
    config.kpis.map((kpi) => kpi.id),
  );
  const canManage = canManageTemplates(ctx);

  const kpis: KpiItem[] = config.kpis.map((kpi) => ({
    id: kpi.id,
    name: kpi.name,
    description: kpi.description,
    unit: kpi.unit,
    valueType: kpi.value_type,
    frequency: kpi.frequency,
    dimensionId: kpi.dimension_id,
    dimensionName: kpi.dimension?.name ?? null,
    isRequired: kpi.is_required,
    is_active: kpi.is_active,
    sort_order: kpi.sort_order,
    usedIn: usage.byKpi[kpi.id] ?? 0,
  }));

  const dimensions: DimensionItem[] = config.dimensions.map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    kpiNames: config.kpis.filter((kpi) => kpi.dimension_id === dimension.id).map((kpi) => kpi.name),
    members: dimension.members.map((member) => ({
      id: member.id,
      name: member.name,
      sort_order: member.sort_order,
      is_active: member.is_active,
      usedIn: usage.byMember[member.id] ?? 0,
    })),
  }));

  const choices: DimensionChoice[] = dimensions.map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    activeMembers: dimension.members.filter((member) => member.is_active).length,
  }));

  return (
    <div className="flex flex-col gap-6">
      <KpisEditor
        companyId={company.id}
        companyName={company.name}
        kpis={kpis}
        dimensions={choices}
        canManage={canManage}
      />
      <DimensionsEditor companyId={company.id} dimensions={dimensions} canManage={canManage} />
    </div>
  );
}
