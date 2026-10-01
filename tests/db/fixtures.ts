/**
 * Fixed UUIDs of the rows created by supabase/seed.sql (keep both files in sync).
 * Pattern: <prefix>0000000-0000-4000-8000-0000000000NN.
 */
export const SEED = {
  funds: {
    SV1: "a0000000-0000-4000-8000-000000000001",
    SFF: "a0000000-0000-4000-8000-000000000002",
  },
  template: {
    id: "b0000000-0000-4000-8000-000000000001",
    v1: "b1000000-0000-4000-8000-000000000001",
  },
  sections: {
    financials: "b2000000-0000-4000-8000-000000000001",
    headcount: "b2000000-0000-4000-8000-000000000002",
    kpis: "b2000000-0000-4000-8000-000000000003",
    company_summary: "b2000000-0000-4000-8000-000000000004",
    revenue_financial: "b2000000-0000-4000-8000-000000000005",
    partnerships_market: "b2000000-0000-4000-8000-000000000006",
    operation: "b2000000-0000-4000-8000-000000000007",
    product_development: "b2000000-0000-4000-8000-000000000008",
    customer_acquisition: "b2000000-0000-4000-8000-000000000009",
    investment: "b2000000-0000-4000-8000-000000000010",
    compliance_regulation: "b2000000-0000-4000-8000-000000000011",
    other_mentionables: "b2000000-0000-4000-8000-000000000012",
    founder_pulse: "b2000000-0000-4000-8000-000000000013",
  },
  fields: {
    revenue_total: "b3000000-0000-4000-8000-000000000001",
    gross_profit: "b3000000-0000-4000-8000-000000000002",
    net_profit: "b3000000-0000-4000-8000-000000000003",
    cash_in_bank: "b3000000-0000-4000-8000-000000000004",
    burn_rate: "b3000000-0000-4000-8000-000000000005",
    headcount_ft: "b3000000-0000-4000-8000-000000000006",
    headcount_pt: "b3000000-0000-4000-8000-000000000007",
    key_milestones: "b3000000-0000-4000-8000-000000000008",
    financial_commentary: "b3000000-0000-4000-8000-000000000009",
    partnerships: "b3000000-0000-4000-8000-000000000010",
    operations_highlights: "b3000000-0000-4000-8000-000000000011",
    team_highlights: "b3000000-0000-4000-8000-000000000012",
    product_highlights: "b3000000-0000-4000-8000-000000000013",
    sales_highlights: "b3000000-0000-4000-8000-000000000014",
    marketing_highlights: "b3000000-0000-4000-8000-000000000015",
    fundraising_status: "b3000000-0000-4000-8000-000000000016",
    fundraising_commentary: "b3000000-0000-4000-8000-000000000017",
    compliance_updates: "b3000000-0000-4000-8000-000000000018",
    other_updates: "b3000000-0000-4000-8000-000000000019",
    team_morale: "b3000000-0000-4000-8000-000000000020",
    next_month_goals: "b3000000-0000-4000-8000-000000000021",
    help_needed: "b3000000-0000-4000-8000-000000000022",
    help_tags: "b3000000-0000-4000-8000-000000000023",
  },
  companies: {
    // Pilot (reporting from July 2026)
    batikBoutique: "c0000000-0000-4000-8000-000000000001",
    recqa: "c0000000-0000-4000-8000-000000000002",
    kiddocare: "c0000000-0000-4000-8000-000000000003",
    // Rest of the launch portfolio (BRD Appendix A): not yet reporting
    aone: "c0000000-0000-4000-8000-000000000004",
    agiliux: "c0000000-0000-4000-8000-000000000005",
    biib: "c0000000-0000-4000-8000-000000000006",
    iimmpact: "c0000000-0000-4000-8000-000000000007",
    tixcarte: "c0000000-0000-4000-8000-000000000008",
    buzz: "c0000000-0000-4000-8000-000000000009",
    docspe: "c0000000-0000-4000-8000-000000000010",
    huddle: "c0000000-0000-4000-8000-000000000011",
    kabel: "c0000000-0000-4000-8000-000000000012",
    stayHere: "c0000000-0000-4000-8000-000000000013",
    petotum: "c0000000-0000-4000-8000-000000000014",
    sonicBoom: "c0000000-0000-4000-8000-000000000015",
    iMotorbike: "c0000000-0000-4000-8000-000000000016",
    fefifo: "c0000000-0000-4000-8000-000000000017",
    erth: "c0000000-0000-4000-8000-000000000018",
  },
  dimensions: {
    batikOutlet: "d0000000-0000-4000-8000-000000000001",
  },
  outlets: {
    montKiara: "d1000000-0000-4000-8000-000000000001",
    theRow: "d1000000-0000-4000-8000-000000000002",
    ioiCityMall: "d1000000-0000-4000-8000-000000000003",
    westinDesaru: "d1000000-0000-4000-8000-000000000004",
    merdeka118: "d1000000-0000-4000-8000-000000000005",
  },
  kpis: {
    revenuePerOutlet: "e0000000-0000-4000-8000-000000000001",
    monthlyBreakEven: "e0000000-0000-4000-8000-000000000002",
    profitable: "e0000000-0000-4000-8000-000000000003",
    appDownloads: "e0000000-0000-4000-8000-000000000004",
    bookings: "e0000000-0000-4000-8000-000000000005",
    activeCarers: "e0000000-0000-4000-8000-000000000006",
    payoutsToCarers: "e0000000-0000-4000-8000-000000000007",
    camerasDeployed: "e0000000-0000-4000-8000-000000000008",
    gamesRecorded: "e0000000-0000-4000-8000-000000000009",
    gamesPerCamera: "e0000000-0000-4000-8000-000000000010",
    gamesBrokenDown: "e0000000-0000-4000-8000-000000000011",
  },
} as const;

/** The pilot companies (reporting from July 2026); every other seeded company is not yet reporting. */
export const PILOT_COMPANY_IDS = [SEED.companies.batikBoutique, SEED.companies.recqa, SEED.companies.kiddocare] as const;

/**
 * The launch portfolio (BRD Appendix A) as seeded: fund, name and fixed id. Fund investments have the
 * fixed id f0000000-0000-4000-8000-0000000000NN, NN = the company's NN.
 */
export const PORTFOLIO: readonly { fund: "SV1" | "SFF"; name: string; id: string }[] = [
  { fund: "SV1", name: "Batik Boutique", id: SEED.companies.batikBoutique },
  { fund: "SV1", name: "RECQA", id: SEED.companies.recqa },
  { fund: "SFF", name: "Kiddocare", id: SEED.companies.kiddocare },
  { fund: "SV1", name: "AOne", id: SEED.companies.aone },
  { fund: "SV1", name: "Agiliux", id: SEED.companies.agiliux },
  { fund: "SV1", name: "BiiB", id: SEED.companies.biib },
  { fund: "SV1", name: "IIMMPACT", id: SEED.companies.iimmpact },
  { fund: "SV1", name: "TixCarte", id: SEED.companies.tixcarte },
  { fund: "SFF", name: "Buzz", id: SEED.companies.buzz },
  { fund: "SFF", name: "Docspe / Plexis.ai", id: SEED.companies.docspe },
  { fund: "SFF", name: "Huddle", id: SEED.companies.huddle },
  { fund: "SFF", name: "Kabel", id: SEED.companies.kabel },
  { fund: "SFF", name: "StayHere", id: SEED.companies.stayHere },
  { fund: "SFF", name: "Petotum", id: SEED.companies.petotum },
  { fund: "SFF", name: "SonicBoom", id: SEED.companies.sonicBoom },
  { fund: "SFF", name: "i-Motorbike", id: SEED.companies.iMotorbike },
  { fund: "SFF", name: "Fefifo", id: SEED.companies.fefifo },
  { fund: "SFF", name: "E.R.T.H", id: SEED.companies.erth },
];

/** The fixed id of a seeded fund investment (by the company's fixed id). */
export function fundInvestmentId(companyId: string): string {
  return `f0000000-0000-4000-8000-${companyId.slice(-12)}`;
}

/** The seven system fields (template §3) in template order. */
export const SYSTEM_FIELD_KEYS = [
  "revenue_total",
  "gross_profit",
  "net_profit",
  "cash_in_bank",
  "burn_rate",
  "headcount_ft",
  "headcount_pt",
] as const;

export const OUTLET_IDS = Object.values(SEED.outlets);
