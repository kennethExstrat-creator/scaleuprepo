/**
 * Common test scenario: the seeded pilot companies with a full cast of users (who have all accepted
 * the current terms of use) and the reporting months opened as of a given Malaysia date. The rest of
 * the seeded portfolio is not yet reporting, so it gets no months.
 */
import { OUTLET_IDS, SEED } from "./fixtures";
import type { Sql, TestDb } from "./harness";

export type Months = Record<string, string>; // 'YYYY-MM-01' → submission id

export type Portfolio = {
  superAdmin: string;
  fundAdmin: string;
  /** Partner-in-charge of Batik Boutique and Kiddocare. */
  partner: string;
  /** A partner who is not in charge of any company. */
  otherPartner: string;
  viewer: string;
  batikOwner: string;
  batikContributor: string;
  kiddoOwner: string;
  kiddoContributor: string;
  recqaOwner: string;
  subs: { batik: Months; kiddo: Months; recqa: Months };
};

export async function setupPortfolio(db: TestDb, options: { today?: string } = {}): Promise<Portfolio> {
  const superAdmin = await db.createUser({ email: "super@scaleup.test", fullName: "Sue Super", scaleupRole: "super_admin" });
  const fundAdmin = await db.createUser({ email: "fund@scaleup.test", fullName: "Fay Fund", scaleupRole: "fund_admin" });
  const partner = await db.createUser({ email: "partner@scaleup.test", fullName: "Pat Partner", scaleupRole: "partner" });
  const otherPartner = await db.createUser({ email: "other@scaleup.test", fullName: "Oli Other", scaleupRole: "partner" });
  const viewer = await db.createUser({ email: "viewer@scaleup.test", fullName: "Vic Viewer", scaleupRole: "viewer" });
  const batikOwner = await db.createUser({ email: "owner@batik.test", fullName: "Bea Batik" });
  const batikContributor = await db.createUser({ email: "finance@batik.test", fullName: "Ben Batik" });
  const kiddoOwner = await db.createUser({ email: "owner@kiddo.test", fullName: "Kim Kiddo" });
  const kiddoContributor = await db.createUser({ email: "finance@kiddo.test", fullName: "Kai Kiddo" });
  const recqaOwner = await db.createUser({ email: "owner@recqa.test", fullName: "Rae Recqa" });

  // The partner-in-charge is ScaleUp-internal (company_internal, BRD §6.3).
  await db.query("update public.company_internal set partner_in_charge_id = $1 where company_id = any($2::uuid[])", [
    partner,
    [SEED.companies.batikBoutique, SEED.companies.kiddocare],
  ]);
  await db.addMember(SEED.companies.batikBoutique, batikOwner, "owner");
  await db.addMember(SEED.companies.batikBoutique, batikContributor, "contributor");
  await db.addMember(SEED.companies.kiddocare, kiddoOwner, "owner");
  await db.addMember(SEED.companies.kiddocare, kiddoContributor, "contributor");
  await db.addMember(SEED.companies.recqa, recqaOwner, "owner");

  await db.setToday(options.today ?? "2026-10-20");
  await db.rpc("open_due_periods");

  return {
    superAdmin,
    fundAdmin,
    partner,
    otherPartner,
    viewer,
    batikOwner,
    batikContributor,
    kiddoOwner,
    kiddoContributor,
    recqaOwner,
    subs: {
      batik: await submissionsOf(db, SEED.companies.batikBoutique),
      kiddo: await submissionsOf(db, SEED.companies.kiddocare),
      recqa: await submissionsOf(db, SEED.companies.recqa),
    },
  };
}

export async function submissionsOf(db: TestDb, companyId: string): Promise<Months> {
  const rows = await db.query<{ month: string; id: string }>(
    "select month, id from public.submissions where company_id = $1 order by month",
    [companyId],
  );
  return Object.fromEntries(rows.map((row) => [row.month, row.id]));
}

// ---------------------------------------------------------------------------------------------
// Payload builders for save_submission_values
// ---------------------------------------------------------------------------------------------
export type SystemKey =
  | "revenue_total"
  | "gross_profit"
  | "net_profit"
  | "cash_in_bank"
  | "burn_rate"
  | "headcount_ft"
  | "headcount_pt";

export const DEFAULT_NUMBERS: Record<SystemKey, number> = {
  revenue_total: 100000,
  gross_profit: 40000,
  net_profit: -5000,
  cash_in_bank: 500000,
  burn_rate: 20000,
  headcount_ft: 10,
  headcount_pt: 2,
};

export type ValueEntry = { key: string; value_number?: number | null; value_text?: string | null; value_json?: unknown };
export type SegmentEntry = { segment_id: string; amount: number | null };
export type KpiEntry = {
  kpi_id: string;
  dimension_member_id: string | null;
  value_number?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
};

export function systemValues(overrides: Partial<Record<SystemKey, number | null>> = {}): ValueEntry[] {
  const numbers = { ...DEFAULT_NUMBERS, ...overrides };
  return Object.entries(numbers).map(([key, value]) => ({ key, value_number: value }));
}

export function batikKpis(): KpiEntry[] {
  return OUTLET_IDS.flatMap((memberId, i) => [
    { kpi_id: SEED.kpis.revenuePerOutlet, dimension_member_id: memberId, value_number: 20000 + i },
    { kpi_id: SEED.kpis.monthlyBreakEven, dimension_member_id: memberId, value_number: 15000 },
    { kpi_id: SEED.kpis.profitable, dimension_member_id: memberId, value_bool: i % 2 === 0 },
  ]);
}

export function kiddoKpis(): KpiEntry[] {
  return [
    { kpi_id: SEED.kpis.appDownloads, dimension_member_id: null, value_number: 1200 },
    { kpi_id: SEED.kpis.bookings, dimension_member_id: null, value_number: 340 },
    { kpi_id: SEED.kpis.activeCarers, dimension_member_id: null, value_number: 85 },
    { kpi_id: SEED.kpis.payoutsToCarers, dimension_member_id: null, value_number: 45000.5 },
  ];
}

export type SavePayload = { values?: ValueEntry[]; segments?: SegmentEntry[]; kpis?: KpiEntry[] };

export function save(sql: Sql, submissionId: string, payload: SavePayload): Promise<string> {
  return sql.rpc<string>("save_submission_values", {
    p_submission_id: submissionId,
    p_values: payload.values ?? [],
    p_segments: payload.segments ?? [],
    p_kpis: payload.kpis ?? [],
  });
}

export type CompanyKey = "batik" | "kiddo" | "recqa";

/** A complete, valid set of numbers and KPIs for a seeded pilot company. */
export function validPayload(company: CompanyKey, overrides: Partial<Record<SystemKey, number | null>> = {}): SavePayload {
  return {
    values: systemValues(overrides),
    kpis: company === "batik" ? batikKpis() : company === "kiddo" ? kiddoKpis() : [],
  };
}

/** Saves valid data as `userId` and (optionally) submits as `ownerId`. */
export async function fillValid(
  db: TestDb,
  userId: string,
  submissionId: string,
  company: CompanyKey,
  overrides: Partial<Record<SystemKey, number | null>> = {},
): Promise<void> {
  await db.asUser(userId, (sql) => save(sql, submissionId, validPayload(company, overrides)));
}

export async function submit(db: TestDb, ownerId: string, submissionId: string): Promise<void> {
  await db.asUser(ownerId, (sql) =>
    sql.rpc("submit_submission", { p_submission_id: submissionId, p_declaration_accepted: true }),
  );
}

/** Fills and submits every listed month in order. */
export async function fillAndSubmit(
  db: TestDb,
  ownerId: string,
  company: CompanyKey,
  submissionIds: string[],
  overrides: Partial<Record<SystemKey, number | null>> = {},
): Promise<void> {
  for (const id of submissionIds) {
    await fillValid(db, ownerId, id, company, overrides);
    await submit(db, ownerId, id);
  }
}

export async function status(db: TestDb, submissionId: string): Promise<string> {
  return db.value<string>("select status::text from public.submissions where id = $1", [submissionId]);
}
