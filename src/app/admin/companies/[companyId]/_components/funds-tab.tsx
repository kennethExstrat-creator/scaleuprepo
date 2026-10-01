import { canManagePlatform } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";

import { loadCompanyInvestments, loadFundOptions } from "../../_components/queries";
import type { FundOption } from "../../_components/types";
import { FundInvestmentsEditor } from "./fund-investments-editor";

/** Funds & investment: the company's fund mappings (every ScaleUp role reads; Super Admins manage). */
export async function FundsTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const canManage = canManagePlatform(ctx);
  const [investments, funds] = await Promise.all([
    loadCompanyInvestments(sb, company.id),
    canManage ? loadFundOptions(sb) : Promise.resolve<FundOption[]>([]),
  ]);
  return (
    <FundInvestmentsEditor
      companyId={company.id}
      companyName={company.name}
      investments={investments}
      funds={funds}
      canManage={canManage}
    />
  );
}
