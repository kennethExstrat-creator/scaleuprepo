/**
 * Direct table writes through the API (RLS + grants): every writable table works for the roles the
 * contract allows and is refused for the others.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED } from "./fixtures";
import { expectDenied, expectPgError, expectRule, freshDb, type TestDb } from "./harness";
import { setupPortfolio, type Portfolio } from "./scenario";

let db: TestDb;
let p: Portfolio;

beforeEach(async () => {
  db = await freshDb();
  p = await setupPortfolio(db, { today: "2026-10-20" });
});

afterEach(async () => {
  await db?.close();
});

const RLS = /row-level security/;

describe("platform settings", () => {
  it("only Super Admins update the settings (updated_by is recorded)", async () => {
    const updated = await db.asUser(p.superAdmin, (sql) =>
      sql.query("update public.platform_settings set due_day = 20, revenue_swing_pct = 25 returning due_day, updated_by"),
    );
    expect(updated).toEqual([{ due_day: 20, updated_by: p.superAdmin }]);
    for (const user of [p.fundAdmin, p.partner, p.batikOwner]) {
      expect(await db.asUser(user, (sql) => sql.query("update public.platform_settings set due_day = 1 returning id"))).toEqual([]);
    }
    await expectPgError(
      db.asUser(p.superAdmin, (sql) => sql.query("update public.platform_settings set due_day = 31")),
      { code: "23514" },
    );
    await expectDenied(db.asUser(p.superAdmin, (sql) => sql.query("insert into public.platform_settings (id) values (2)")));
    await expectDenied(db.asUser(p.superAdmin, (sql) => sql.query("delete from public.platform_settings")));
  });
});

describe("funds, companies and fund investments", () => {
  it("Super Admins manage funds, companies and investments", async () => {
    const fund = await db.asUser(p.superAdmin, (sql) =>
      sql.value<string>("insert into public.funds (code, name) values ('SV2', 'ScaleUp Ventures 2') returning id"),
    );
    const company = await db.asUser(p.superAdmin, (sql) =>
      sql.value<string>(
        `insert into public.companies (name, reporting_start_month, sector)
         values ('Newco', '2026-08-17', 'Sports tech') returning id`,
      ),
    );
    // The start month is normalised to the first of the month; the internal row is created, and the
    // partner-in-charge is assigned there.
    expect(await db.value("select reporting_start_month from public.companies where id = $1", [company])).toBe("2026-08-01");
    expect(await db.count("select 1 from public.company_internal where company_id = $1", [company])).toBe(1);
    expect(
      await db.asUser(p.superAdmin, (sql) =>
        sql.query("update public.company_internal set partner_in_charge_id = $2 where company_id = $1 returning partner_in_charge_id", [company, p.partner]),
      ),
    ).toEqual([{ partner_in_charge_id: p.partner }]);
    await db.asUser(p.superAdmin, async (sql) => {
      await sql.query("update public.companies set website = 'https://newco.example' where id = $1", [company]);
      await sql.query("insert into public.fund_investments (fund_id, company_id, ownership_pct, instrument) values ($1, $2, 10.5, 'SAFE')", [
        fund,
        company,
      ]);
      await sql.query("update public.fund_investments set ownership_pct = 11 where company_id = $1", [company]);
      await sql.query("delete from public.fund_investments where company_id = $1", [company]);
      await sql.query("update public.funds set description = 'Second fund' where id = $1", [fund]);
      await sql.query("delete from public.funds where id = $1", [fund]);
    });
    await expectPgError(
      db.asUser(p.superAdmin, (sql) => sql.query("insert into public.companies (name, reporting_start_month, reporting_currency) values ('Bad', '2026-07-01', 'usd')")),
      { code: "23514" },
    );
  });

  it("other roles cannot manage funds, companies or investments", async () => {
    for (const user of [p.fundAdmin, p.partner, p.viewer, p.batikOwner]) {
      await expectDenied(db.asUser(user, (sql) => sql.query("insert into public.funds (code, name) values ('X', 'X')")), RLS);
      await expectDenied(
        db.asUser(user, (sql) => sql.query("insert into public.companies (name, reporting_start_month) values ('X', '2026-07-01')")),
        RLS,
      );
      await expectDenied(
        db.asUser(user, (sql) =>
          sql.query("insert into public.fund_investments (fund_id, company_id) values ($1, $2)", [SEED.funds.SV1, SEED.companies.recqa]),
        ),
        RLS,
      );
      expect(
        await db.asUser(user, (sql) => sql.query("update public.companies set name = name || '!' returning id")),
      ).toEqual([]);
    }
    // Companies are never deleted directly, not even by a Super Admin (delete_company() logs the reason).
    await expectDenied(db.asUser(p.superAdmin, (sql) => sql.query("delete from public.companies where id = $1", [SEED.companies.recqa])));
  });
});

describe("company configuration (segments, dimensions, KPIs)", () => {
  it("Super Admins and Fund Admins manage revenue segments, dimensions and KPIs", async () => {
    for (const admin of [p.fundAdmin, p.superAdmin]) {
      await db.asUser(admin, async (sql) => {
        const seg = await sql.value<string>(
          "insert into public.revenue_segments (company_id, name) values ($1, $2) returning id",
          [SEED.companies.recqa, `Segment ${admin.slice(0, 4)}`],
        );
        await sql.query("update public.revenue_segments set is_active = false where id = $1", [seg]);
        const dim = await sql.value<string>("insert into public.kpi_dimensions (company_id, name) values ($1, $2) returning id", [
          SEED.companies.recqa,
          `Product ${admin.slice(0, 4)}`,
        ]);
        const member = await sql.value<string>(
          "insert into public.kpi_dimension_members (dimension_id, name) values ($1, 'Inspection drones') returning id",
          [dim],
        );
        const kpi = await sql.value<string>(
          `insert into public.company_kpis (company_id, name, unit, value_type, frequency, dimension_id)
           values ($1, $2, 'units', 'integer', 'half_yearly', $3) returning id`,
          [SEED.companies.recqa, `Units sold ${admin.slice(0, 4)}`, dim],
        );
        await sql.query("update public.company_kpis set is_required = false where id = $1", [kpi]);
        await sql.query("delete from public.company_kpis where id = $1", [kpi]);
        await sql.query("delete from public.kpi_dimension_members where id = $1", [member]);
        await sql.query("delete from public.kpi_dimensions where id = $1", [dim]);
        await sql.query("delete from public.revenue_segments where id = $1", [seg]);
      });
    }
  });

  it("keeps configuration inside its company", async () => {
    await expectRule(
      db.asUser(p.fundAdmin, (sql) =>
        sql.query("insert into public.company_kpis (company_id, name, dimension_id) values ($1, 'Cross', $2)", [
          SEED.companies.kiddocare,
          SEED.dimensions.batikOutlet,
        ]),
      ),
      "The KPI dimension must belong to the same company as the KPI.",
    );
    await expectRule(
      db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.company_kpis set company_id = $1 where id = $2", [SEED.companies.kiddocare, SEED.kpis.profitable]),
      ),
      "Company settings cannot be moved to another company.",
    );
    const dim = await db.value<string>("insert into public.kpi_dimensions (company_id, name) values ($1, 'City') returning id", [
      SEED.companies.kiddocare,
    ]);
    await expectRule(
      db.asUser(p.fundAdmin, (sql) =>
        sql.query("update public.kpi_dimension_members set dimension_id = $1 where id = $2", [dim, SEED.outlets.theRow]),
      ),
      "A dimension member cannot be moved to another dimension.",
    );
    // A dimension in use by a KPI cannot be deleted (ON DELETE RESTRICT): SQLSTATE 23001 on
    // Postgres 18 (PGlite), 23503 on Postgres 17 (Supabase). Its members are kept.
    const restricted = await expectPgError(
      db.asUser(p.fundAdmin, (sql) => sql.query("delete from public.kpi_dimensions where id = $1", [SEED.dimensions.batikOutlet])),
    );
    expect(["23001", "23503"]).toContain(restricted.code);
    expect(await db.count("select 1 from public.kpi_dimension_members where dimension_id = $1", [SEED.dimensions.batikOutlet])).toBe(5);
  });

  it("partners, viewers and company users cannot change configuration", async () => {
    for (const user of [p.partner, p.viewer, p.batikOwner]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.query("insert into public.revenue_segments (company_id, name) values ($1, 'X')", [SEED.companies.batikBoutique])),
        RLS,
      );
      await expectDenied(
        db.asUser(user, (sql) => sql.query("insert into public.company_kpis (company_id, name) values ($1, 'X')", [SEED.companies.batikBoutique])),
        RLS,
      );
      expect(await db.asUser(user, (sql) => sql.query("update public.company_kpis set name = 'X' returning id"))).toEqual([]);
      expect(await db.asUser(user, (sql) => sql.query("delete from public.kpi_dimension_members returning id"))).toEqual([]);
    }
  });
});

describe("row timestamps", () => {
  it("are set by the database for API users (created_at never changes); the database owner keeps control", async () => {
    const recent = (table: string, id: string) =>
      db.value<boolean>(`select created_at > now() - interval '1 hour' from public.${table} where id = $1`, [id]);
    const segment = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.revenue_segments (company_id, name, created_at) values ($1, 'Retail', '2020-01-01') returning id", [
        SEED.companies.recqa,
      ]),
    );
    expect(await recent("revenue_segments", segment)).toBe(true);
    await db.asUser(p.fundAdmin, (sql) =>
      sql.query("update public.revenue_segments set created_at = '2020-01-01', name = 'Retail stores' where id = $1", [segment]),
    );
    expect(await recent("revenue_segments", segment)).toBe(true);
    expect(await db.value("select name from public.revenue_segments where id = $1", [segment])).toBe("Retail stores");

    const company = await db.asUser(p.superAdmin, (sql) =>
      sql.value<string>(
        "insert into public.companies (name, reporting_start_month, created_at, updated_at) values ('Newco', '2026-07-01', '2020-01-01', '2030-01-01') returning id",
      ),
    );
    expect(
      await db.one("select created_at > now() - interval '1 hour' as created, updated_at < now() + interval '1 hour' as updated from public.companies where id = $1", [company]),
    ).toEqual({ created: true, updated: true });
    const template = await db.asUser(p.fundAdmin, (sql) =>
      sql.value<string>("insert into public.templates (name, created_at) values ('Board pack', '2020-01-01') returning id"),
    );
    expect(await recent("templates", template)).toBe(true);

    // Data migrations (database owner / service role) may set historical timestamps.
    await db.query("update public.revenue_segments set created_at = '2020-01-01' where id = $1", [segment]);
    expect(await db.value("select created_at::date from public.revenue_segments where id = $1", [segment])).toBe("2020-01-01");
  });
});

describe("FX rates", () => {
  it("Super Admins and Fund Admins maintain FX rates; nobody else", async () => {
    await db.asUser(p.fundAdmin, (sql) => sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('USD', '2026-07-01', 4.21)"));
    expect(await db.one("select rate_to_myr, updated_by from public.fx_rates")).toEqual({ rate_to_myr: 4.21, updated_by: p.fundAdmin });
    await db.asUser(p.superAdmin, (sql) => sql.query("update public.fx_rates set rate_to_myr = 4.2 where currency = 'USD'"));
    expect(await db.value("select updated_by from public.fx_rates")).toBe(p.superAdmin);
    await expectPgError(
      db.asUser(p.fundAdmin, (sql) => sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('SGD', '2026-07-01', 0)")),
      { code: "23514" },
    );
    for (const user of [p.partner, p.viewer, p.batikOwner]) {
      await expectDenied(
        db.asUser(user, (sql) => sql.query("insert into public.fx_rates (currency, month, rate_to_myr) values ('SGD', '2026-07-01', 3.3)")),
        RLS,
      );
    }
    await db.asUser(p.fundAdmin, (sql) => sql.query("delete from public.fx_rates"));
  });
});
