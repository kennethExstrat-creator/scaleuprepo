// Tabs of the company page (/admin/companies/[companyId]?tab=…). Pure; unit-tested in
// tests/features/m1/tabs.test.ts.

export const COMPANY_TABS = [
  { key: "overview", label: "Overview" },
  { key: "funds", label: "Funds & investment" },
  // ScaleUp revenue lines (managed here; they need not add up to total revenue) and, read-only below them,
  // the company's own revenue segments (BRD B30). Named as the B30 brief names it.
  { key: "revenue", label: "ScaleUp revenue lines" },
  { key: "kpis", label: "KPIs" },
  { key: "team", label: "Team" },
  { key: "internal", label: "Internal" },
  { key: "updates", label: "Monthly updates" },
] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number]["key"];

export const DEFAULT_COMPANY_TAB: CompanyTab = "overview";

/** The tab named by `?tab=` (the Overview for anything else). */
export function parseCompanyTab(value: unknown): CompanyTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return DEFAULT_COMPANY_TAB;
  const key = raw.trim().toLowerCase();
  return COMPANY_TABS.find((tab) => tab.key === key)?.key ?? DEFAULT_COMPANY_TAB;
}

/** The URL of a tab of the company page (the Overview has no `?tab=`). */
export function companyTabHref(companyId: string, tab: CompanyTab): string {
  const base = `/admin/companies/${companyId}`;
  return tab === DEFAULT_COMPANY_TAB ? base : `${base}?tab=${tab}`;
}

export function companyTabLabel(tab: CompanyTab): string {
  return COMPANY_TABS.find((entry) => entry.key === tab)?.label ?? "Overview";
}
