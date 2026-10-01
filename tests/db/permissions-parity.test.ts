/**
 * src/lib/auth/permissions.ts (UI helpers) agrees with what the database lets each user do.
 *
 * For every seeded user × company, each helper is compared with a probe against the real policies and
 * RPCs, run inside a transaction that is always rolled back. RPC probes are made in a state where the
 * business rule fails, so the error tells the two cases apart: an expected P0001 rule message means the
 * caller was allowed; 42501, or the "no longer an active portfolio company" P0001 of exited companies,
 * means the caller was not. Any other outcome fails the test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canApprove,
  canAssignPartner,
  canComment,
  canConfirmPeriodClose,
  canEditInternal,
  canEnterData,
  canExtendDueDate,
  canInviteUsers,
  canManageCompanySegments,
  canManageCycles,
  canManagePlatform,
  canManageTemplates,
  canReopen,
  canReopenPeriodClose,
  canReplyToComments,
  canRequestChanges,
  canResolveComments,
  canSubmit,
  canViewAudit,
  type PartnerAssignment,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import type { CompanyRole, CompanyStatus, ScaleupRole } from "@/lib/types/enums";
import { SEED } from "./fixtures";
import { freshDb, type PgError, type Sql, type TestDb } from "./harness";
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

type Company = {
  id: string;
  status: CompanyStatus;
  /** The company's company_internal row (ScaleUp-only), as the app passes it to the helpers. */
  internal: PartnerAssignment;
  draft: string;
  close: string;
  root: string;
  newUser: string;
  newPartner: string;
};

type Outcome = { ok: true; rows: number } | { ok: false; code: string | undefined; message: string };
type Verdict = "allowed" | "denied" | "unexpected";

const READ_ONLY = /is no longer an active portfolio company/;
const ROLLBACK = new Error("rollback");

/** Runs fn as the user and always rolls back. */
async function attempt(userId: string, fn: (sql: Sql) => Promise<unknown[] | unknown>): Promise<Outcome> {
  let rows = 0;
  try {
    await db.asUser(userId, async (sql) => {
      const result = await fn(sql);
      rows = Array.isArray(result) ? result.length : 1;
      throw ROLLBACK;
    });
  } catch (error) {
    if (error === ROLLBACK) return { ok: true, rows };
    const pg = error as PgError;
    return { ok: false, code: pg.code, message: pg.message };
  }
  return { ok: true, rows };
}

/** Allowed when the call succeeds (with at least `minRows` rows); denied on 42501 or read-only. */
function bySuccess(minRows = 0) {
  return (o: Outcome): Verdict => {
    if (o.ok) return o.rows >= minRows ? "allowed" : "denied";
    if (o.code === "42501" || (o.code === "P0001" && READ_ONLY.test(o.message))) return "denied";
    return "unexpected";
  };
}

/** Allowed when the RPC gets past its permission checks and fails on the business rule `rule`. */
function byRule(rule: RegExp) {
  return (o: Outcome): Verdict => {
    if (o.ok) return "allowed";
    if (o.code === "P0001" && rule.test(o.message)) return "allowed";
    if (o.code === "42501" || (o.code === "P0001" && READ_ONLY.test(o.message))) return "denied";
    return "unexpected";
  };
}

type Probe = {
  name: string;
  helper: (subject: PermissionSubject, company: Company) => boolean;
  run: (sql: Sql, company: Company) => Promise<unknown>;
  verdict: (outcome: Outcome) => Verdict;
};

const PROBES: Probe[] = [
  {
    name: "canManagePlatform (insert a fund)",
    helper: (s) => canManagePlatform(s),
    run: (sql) => sql.query("insert into public.funds (code, name) values ('ZZ9', 'Probe fund') returning id"),
    verdict: bySuccess(1),
  },
  {
    name: "canManageTemplates (add a revenue segment)",
    helper: (s) => canManageTemplates(s),
    run: (sql, c) => sql.query("insert into public.revenue_segments (company_id, name) values ($1, 'Probe') returning id", [c.id]),
    verdict: bySuccess(1),
  },
  {
    // BRD B30: the company's own revenue segments — its owner (active company), or a Super Admin / Fund
    // Admin on the owner's behalf (active companies only).
    name: "canManageCompanySegments (set_company_revenue_segments)",
    helper: (s, c) => canManageCompanySegments(s, c.id, c.status),
    run: (sql, c) => sql.rpc("set_company_revenue_segments", { p_company_id: c.id, p_segments: { not: "a list" } }),
    verdict: byRule(/^Send the revenue segments as a list\.$/),
  },
  {
    // Company segments change only through set_company_revenue_segments (never direct writes).
    name: "nobody writes company revenue segments directly",
    helper: () => false,
    run: (sql, c) =>
      sql.query("insert into public.revenue_segments (company_id, kind, name) values ($1, 'company', 'Probe') returning id", [c.id]),
    verdict: bySuccess(1),
  },
  {
    name: "canManageCycles (open_period)",
    helper: (s) => canManageCycles(s),
    run: (sql) => sql.rpc("open_period", { p_month: "2026-10-01" }),
    verdict: bySuccess(),
  },
  {
    name: "canExtendDueDate (extend_due_date)",
    helper: (s, c) => canExtendDueDate(s, c.status),
    run: (sql, c) => sql.rpc("extend_due_date", { p_submission_id: c.draft, p_new_due_date: "2020-01-01", p_reason: null }),
    verdict: byRule(/^The new due date must be after the current due date/),
  },
  {
    name: "canRequestChanges (request_changes)",
    helper: (s, c) => canRequestChanges(s, c.status),
    run: (sql, c) => sql.rpc("request_changes", { p_submission_id: c.draft, p_message: "Probe" }),
    verdict: byRule(/^Only submitted updates can be sent back for changes\.$/),
  },
  {
    name: "canReopenPeriodClose (reopen_period_close)",
    helper: (s, c) => canReopenPeriodClose(s, c.status),
    run: (sql, c) => sql.rpc("reopen_period_close", { p_close_id: c.close, p_reason: "Probe" }),
    verdict: byRule(/is not confirmed\.$/),
  },
  {
    name: "canEnterData (save_submission_values)",
    helper: (s, c) => canEnterData(s, c.id, c.status),
    run: (sql, c) => sql.rpc("save_submission_values", { p_submission_id: c.draft, p_values: [], p_segments: [], p_kpis: [] }),
    verdict: bySuccess(),
  },
  {
    name: "canSubmit (submit_submission)",
    helper: (s, c) => canSubmit(s, c.id),
    run: (sql, c) => sql.rpc("submit_submission", { p_submission_id: c.draft, p_declaration_accepted: false }),
    verdict: byRule(/^Please confirm the declaration before submitting\.$/),
  },
  {
    name: "canSubmit also covers request_amendment",
    helper: (s, c) => canSubmit(s, c.id),
    run: (sql, c) => sql.rpc("request_amendment", { p_submission_id: c.draft, p_reason: "Probe" }),
    verdict: byRule(/^Amendments can only be requested for approved months\.$/),
  },
  {
    name: "canConfirmPeriodClose (confirm_period_close)",
    helper: (s, c) => canConfirmPeriodClose(s, c.id, c.status),
    run: (sql, c) => sql.rpc("confirm_period_close", { p_close_id: c.close }),
    verdict: byRule(/^Submit every month of Q3 2026 before confirming it\./),
  },
  {
    name: "canComment (start a thread)",
    helper: (s) => canComment(s),
    run: (sql, c) =>
      sql.query("insert into public.comments (submission_id, target, visibility, body) values ($1, 'general', 'shared', 'Probe') returning id", [
        c.draft,
      ]),
    verdict: bySuccess(1),
  },
  {
    name: "canReplyToComments (reply to a shared thread)",
    helper: (s, c) => canReplyToComments(s, c.id),
    run: (sql, c) =>
      sql.query("insert into public.comments (submission_id, parent_id, body) values ($1, $2, 'Probe reply') returning id", [c.draft, c.root]),
    verdict: bySuccess(1),
  },
  {
    name: "canResolveComments (resolve_comment on a shared thread)",
    helper: (s, c) => canResolveComments(s, c.id),
    run: (sql, c) => sql.rpc("resolve_comment", { p_comment_id: c.root, p_resolved: true }),
    verdict: bySuccess(),
  },
  {
    name: "canApprove (approve_submission)",
    helper: (s, c) => canApprove(s, c.internal),
    run: (sql, c) => sql.rpc("approve_submission", { p_submission_id: c.draft }),
    verdict: byRule(/^Only submitted updates can be approved\.$/),
  },
  {
    name: "canReopen (reopen_submission)",
    helper: (s, c) => canReopen(s, c.internal, c.status),
    run: (sql, c) => sql.rpc("reopen_submission", { p_submission_id: c.draft, p_reason: "Probe" }),
    verdict: byRule(/^Only approved months can be reopened\.$/),
  },
  {
    name: "canEditInternal (update company_internal)",
    helper: (s, c) => canEditInternal(s, c.internal),
    run: (sql, c) => sql.query("update public.company_internal set notes = 'Probe' where company_id = $1 returning company_id", [c.id]),
    verdict: bySuccess(1),
  },
  {
    name: "canAssignPartner (set company_internal.partner_in_charge_id)",
    helper: (s) => canAssignPartner(s),
    run: (sql, c) =>
      sql.query("update public.company_internal set partner_in_charge_id = $2 where company_id = $1 returning company_id", [
        c.id,
        c.newPartner,
      ]),
    verdict: bySuccess(1),
  },
  {
    name: "canViewAudit (read audit_log)",
    helper: (s) => canViewAudit(s),
    run: (sql) => sql.query("select id from public.audit_log limit 1"),
    verdict: bySuccess(1),
  },
  {
    name: "canInviteUsers (add a contributor)",
    helper: (s, c) => canInviteUsers(s, c.id),
    run: (sql, c) =>
      sql.query("insert into public.company_members (company_id, user_id, role) values ($1, $2, 'contributor') returning user_id", [
        c.id,
        c.newUser,
      ]),
    verdict: bySuccess(1),
  },
];

/** The PermissionSubject the app builds for a user (session.ts: role + active memberships). */
async function subjectOf(userId: string): Promise<PermissionSubject> {
  const role = await db.value<ScaleupRole | null>("select scaleup_role::text from public.profiles where id = $1", [userId]);
  const rows = await db.query<{ company_id: string; name: string; status: CompanyStatus; role: CompanyRole }>(
    `select m.company_id, c.name, c.status::text as status, m.role::text as role
       from public.company_members m join public.companies c on c.id = m.company_id
      where m.user_id = $1 and m.is_active`,
    [userId],
  );
  return {
    userId,
    scaleupRole: role ?? null,
    memberships: rows.map((row) => ({ companyId: row.company_id, companyName: row.name, companyStatus: row.status, role: row.role })),
  };
}

async function companyOf(id: string): Promise<Company> {
  const { status } = await db.one<{ status: CompanyStatus }>("select status::text as status from public.companies where id = $1", [id]);
  const internal = await db.one<PartnerAssignment>(
    "select partner_in_charge_id from public.company_internal where company_id = $1",
    [id],
  );
  const draft = await db.value<string>("select id from public.submissions where company_id = $1 and month = '2026-07-01'", [id]);
  const close = await db.value<string>("select id from public.period_closes where company_id = $1 and label = 'Q3 2026'", [id]);
  const root = await db.asUser(p.superAdmin, (sql) =>
    sql.value<string>(
      "insert into public.comments (submission_id, target, visibility, body) values ($1, 'general', 'shared', 'Root thread') returning id",
      [draft],
    ),
  );
  const newUser = await db.createUser({ fullName: "New Contributor" });
  const newPartner = await db.createUser({ fullName: "New Partner", scaleupRole: "partner" });
  return { id, status, internal, draft, close, root, newUser, newPartner };
}

const USERS = [
  "superAdmin",
  "fundAdmin",
  "partner",
  "otherPartner",
  "viewer",
  "batikOwner",
  "batikContributor",
  "kiddoOwner",
  "kiddoContributor",
  "recqaOwner",
] as const;

async function compareAll(companyIds: string[]): Promise<void> {
  const mismatches: string[] = [];
  const companies = await Promise.all(companyIds.map(companyOf));
  for (const name of USERS) {
    const userId = p[name];
    const subject = await subjectOf(userId);
    for (const company of companies) {
      for (const probe of PROBES) {
        const outcome = await attempt(userId, (sql) => probe.run(sql, company));
        const verdict = probe.verdict(outcome);
        const expected = probe.helper(subject, company) ? "allowed" : "denied";
        if (verdict !== expected) {
          mismatches.push(
            `${probe.name} for ${name} on ${company.id} (${company.status}): helper says ${expected}, database ${verdict}` +
              (outcome.ok ? "" : ` (${outcome.code}: ${outcome.message})`),
          );
        }
      }
    }
  }
  expect(mismatches).toEqual([]);
}

describe("permission helpers agree with RLS and RPC checks", () => {
  it("for every role on the active pilot companies", async () => {
    await compareAll([SEED.companies.batikBoutique, SEED.companies.kiddocare, SEED.companies.recqa]);
  });

  it("for exited and written-off companies (read-only for their members, BRD B15)", async () => {
    await db.query("update public.companies set status = 'exited' where id = $1", [SEED.companies.kiddocare]);
    await db.query("update public.companies set status = 'written_off' where id = $1", [SEED.companies.recqa]);
    await compareAll([SEED.companies.kiddocare, SEED.companies.recqa]);
  });
});
