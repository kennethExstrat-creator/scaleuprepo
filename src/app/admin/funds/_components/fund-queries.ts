import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { CompanyStatus } from "@/lib/types/enums";

import type { FundListRow } from "./fund-types";

type FundDbRow = {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  description: string | null;
  is_active: boolean;
};
type HoldingDbRow = { fund_id: string; company: { status: CompanyStatus } | null };

/** Every fund (by code) with how many companies it holds, and how many of them are active. */
export async function loadFundsWithCounts(sb: SupabaseClient<Database>): Promise<FundListRow[]> {
  const [fundsRes, holdingsRes] = await Promise.all([
    sb.from("funds").select("id, code, name, legal_name, description, is_active"),
    sb.from("fund_investments").select("fund_id, company:companies!fund_investments_company_id_fkey(status)"),
  ]);
  if (fundsRes.error) throw new Error(`Could not load the funds: ${fundsRes.error.message}`);
  if (holdingsRes.error) throw new Error(`Could not load the fund holdings: ${holdingsRes.error.message}`);
  const funds: FundDbRow[] = fundsRes.data;
  const holdings: HoldingDbRow[] = holdingsRes.data;

  const counts = new Map<string, { companies: number; active: number }>();
  for (const holding of holdings) {
    const count = counts.get(holding.fund_id) ?? { companies: 0, active: 0 };
    count.companies += 1;
    if (holding.company?.status === "active") count.active += 1;
    counts.set(holding.fund_id, count);
  }

  return funds
    .map((fund) => ({
      id: fund.id,
      code: fund.code,
      name: fund.name,
      legalName: fund.legal_name,
      description: fund.description,
      isActive: fund.is_active,
      companies: counts.get(fund.id)?.companies ?? 0,
      activeCompanies: counts.get(fund.id)?.active ?? 0,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "en-GB", { numeric: true }));
}
