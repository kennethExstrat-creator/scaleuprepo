import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ACTION_META,
  AUDIT_CSV_HEADER,
  AUDIT_ENTITY_GROUPS,
  AUDIT_ENTITY_LABELS,
  AUDIT_EXPORT_INCOMPLETE_MARKER,
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_TIME_BUDGET_MS,
  auditActionMeta,
  auditChanges,
  auditCsvRow,
  auditEntityLabel,
  auditEntryView,
  auditFileName,
  auditIncompleteMessage,
  auditIncompleteRecord,
  auditQueryString,
  auditRoleLabel,
  auditTimeBounds,
  auditTimestamp,
  containsPattern,
  formatAuditValue,
  hasAuditFilters,
  isSystemActor,
} from "@/lib/exports/audit";
import { parseAuditFilters } from "@/lib/exports/audit-params";
import { csvRecord } from "@/lib/exports/csv";
import type { AuditLogRow } from "@/lib/types/domain";

const BATIK = "c0000000-0000-4000-8000-000000000001";

function row(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 42,
    occurred_at: "2026-09-30T06:05:23.123456+00:00",
    created_at: "2026-09-30T06:05:23.123456+00:00",
    actor_id: "11111111-1111-4111-8111-111111111111",
    actor_email: "aisha@scaleup.my",
    actor_role: "fund_admin",
    action: "update",
    entity: "submissions",
    entity_id: "22222222-2222-4222-8222-222222222222",
    company_id: BATIK,
    on_behalf: false,
    summary: "Approved Sep 2026",
    old_data: { status: "submitted", approved_at: null },
    new_data: { status: "approved", approved_at: "2026-09-30T06:05:23+00:00" },
    ...overrides,
  };
}

describe("parseAuditFilters", () => {
  it("reads the filters and the page", () => {
    const { filters, page } = parseAuditFilters({
      company: BATIK.toUpperCase(),
      actor: " aisha ",
      action: "approve",
      entity: "submissions",
      from: "2026-09-01",
      to: "2026-09-30",
      page: "3",
    });
    expect(filters).toEqual({
      company: BATIK,
      actor: "aisha",
      action: "approve",
      entity: "submissions",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(page).toBe(3);
  });

  it("ignores malformed values, blanks and 'all', and swaps a reversed range", () => {
    const params = new URLSearchParams(
      "company=not-a-uuid&actor=&action=all&entity=Robert');DROP&from=2026-09-30&to=2026-09-01&page=-4",
    );
    expect(parseAuditFilters(params)).toEqual({ filters: { from: "2026-09-01", to: "2026-09-30" }, page: 1 });
    expect(parseAuditFilters({ from: "2026-02-30", page: ["2", "5"] })).toEqual({ filters: {}, page: 2 });
    expect(parseAuditFilters({ actor: "x".repeat(201) })).toEqual({ filters: {}, page: 1 });
  });

  it("round-trips through the query string", () => {
    const filters = { company: BATIK, action: "export", from: "2026-09-01" };
    const query = auditQueryString(filters, 2);
    expect(query).toBe(`company=${BATIK}&action=export&from=2026-09-01&page=2`);
    expect(parseAuditFilters(new URLSearchParams(query))).toEqual({ filters, page: 2 });
    expect(auditQueryString({})).toBe("");
    expect(hasAuditFilters({})).toBe(false);
    expect(hasAuditFilters({ actor: "a" })).toBe(true);
  });
});

describe("query helpers", () => {
  it("turns Malaysia dates into occurred_at bounds", () => {
    expect(auditTimeBounds({ from: "2026-09-01", to: "2026-09-30" })).toEqual({
      gte: "2026-08-31T16:00:00.000Z",
      lt: "2026-09-30T16:00:00.000Z",
    });
    expect(auditTimeBounds({})).toEqual({});
  });

  it("escapes LIKE wildcards in the actor search", () => {
    expect(containsPattern("aisha")).toBe("%aisha%");
    expect(containsPattern("a_b%c\\d")).toBe("%a\\_b\\%c\\\\d%");
  });
});

describe("auditChanges", () => {
  it("shows the changed fields of an update (old → new)", () => {
    expect(auditChanges(row())).toEqual({
      kind: "update",
      changes: [
        { field: "approved_at", before: null, after: "2026-09-30T06:05:23+00:00" },
        { field: "status", before: "submitted", after: "approved" },
      ],
    });
  });

  it("shows the new row of an insert and the old row of a delete, without updated_at", () => {
    const insert = auditChanges(
      row({ action: "insert", old_data: null, new_data: { name: "Online", sort_order: 2, updated_at: "x", meta: { a: 1 } } }),
    );
    expect(insert.kind).toBe("insert");
    expect(insert.changes).toEqual([
      { field: "meta", before: null, after: '{"a":1}' },
      { field: "name", before: null, after: "Online" },
      { field: "sort_order", before: null, after: "2" },
    ]);
    const removed = auditChanges(row({ action: "delete", old_data: { name: "Online" }, new_data: null }));
    expect(removed).toEqual({ kind: "delete", changes: [{ field: "name", before: "Online", after: null }] });
  });

  it("shows the details of app events and nothing for empty entries", () => {
    const exported = auditChanges(row({ action: "export", old_data: null, new_data: { format: "csv", rows: 12 } }));
    expect(exported.kind).toBe("event");
    expect(exported.changes.map((c) => [c.field, c.after])).toEqual([
      ["format", "csv"],
      ["rows", "12"],
    ]);
    expect(auditChanges(row({ old_data: null, new_data: null }))).toEqual({ kind: "none", changes: [] });
    expect(auditChanges(row({ old_data: null, new_data: ["a", "b"] }))).toEqual({
      kind: "event",
      changes: [{ field: "details", before: null, after: '["a","b"]' }],
    });
  });

  it("shortens long values for display", () => {
    expect(formatAuditValue("x".repeat(10), 4)).toBe("xxxx… (shortened)");
    expect(formatAuditValue(true)).toBe("true");
    expect(formatAuditValue(null)).toBeNull();
  });
});

describe("labels", () => {
  it("labels every action and entity in the filter groups", () => {
    for (const group of AUDIT_ACTION_GROUPS) {
      for (const action of group.actions) expect(AUDIT_ACTION_META[action], action).toBeDefined();
    }
    const grouped = AUDIT_ENTITY_GROUPS.flatMap((g) => g.entities);
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const entity of grouped) expect(AUDIT_ENTITY_LABELS[entity], entity).toBeDefined();
    expect(auditActionMeta("request_changes")).toEqual({ label: "Changes requested", tone: "warning" });
    expect(auditActionMeta("something_new")).toEqual({ label: "Something new", tone: "neutral" });
    expect(auditEntityLabel("fx_rates")).toBe("FX rates");
    expect(auditEntityLabel("access_links")).toBe("Access links");
  });

  it("labels roles and recognises the system", () => {
    expect(auditRoleLabel("super_admin")).toBe("Super Admin");
    expect(auditRoleLabel("company_owner")).toBe("Company Owner");
    expect(auditRoleLabel("company_contributor")).toBe("Contributor");
    expect(auditRoleLabel("system")).toBe("System");
    expect(auditRoleLabel(null)).toBeNull();
    expect(isSystemActor({ actor_id: null, actor_email: null })).toBe(true);
    expect(isSystemActor({ actor_id: null, actor_email: "script@scaleup.my" })).toBe(false);
    expect(isSystemActor(row())).toBe(false);
  });
});

describe("CSV", () => {
  it("writes one record per entry with Malaysia time and the company name", () => {
    expect(auditTimestamp("2026-09-30T16:05:23Z")).toBe("2026-10-01 00:05:23");
    const record = csvRecord(auditCsvRow(row({ on_behalf: true }), "Batik Boutique"));
    expect(AUDIT_CSV_HEADER).toHaveLength(14);
    expect(record).toBe(
      `42,2026-09-30 14:05:23,aisha@scaleup.my,Fund Admin,11111111-1111-4111-8111-111111111111,Yes,update,submissions,22222222-2222-4222-8222-222222222222,Batik Boutique,${BATIK},Approved Sep 2026,"{""status"":""submitted"",""approved_at"":null}","{""status"":""approved"",""approved_at"":""2026-09-30T06:05:23+00:00""}"`,
    );
  });

  it("names system entries and deleted companies", () => {
    const values = auditCsvRow(
      row({ actor_id: null, actor_email: null, actor_role: "system", old_data: null, new_data: null }),
      null,
    );
    expect(values.slice(2, 4)).toEqual(["System", "System"]);
    expect(values[9]).toBe("(deleted company)");
    expect(values.slice(12)).toEqual([null, null]);
  });

  it("names the file after the date range", () => {
    expect(auditFileName({}, "2026-09-30")).toBe("Audit log 2026-09-30.csv");
    expect(auditFileName({ from: "2026-09-01" }, "2026-09-30")).toBe("Audit log 2026-09-01 to 2026-09-30.csv");
  });

  it("ends a file cut short with a record saying where, why and what to do", () => {
    const lastEntry = { id: 37_656, occurred_at: "2026-09-30T06:05:23Z" };
    const size = auditIncompleteMessage("size", { written: 12_345, total: 50_000, lastEntry });
    expect(size).toBe(
      "Export incomplete: this file holds the newest 12,345 of the 50,000 matching entries because the file reached the size limit of one export (50 MB). Entries numbered below 37,656 (logged up to 2026-09-30 14:05:23, Malaysia time) are not included. Narrow the filters, for example to an earlier date range, and export again for the rest.",
    );
    expect(size.startsWith(AUDIT_EXPORT_INCOMPLETE_MARKER)).toBe(true);
    expect(auditIncompleteMessage("time", { written: 1, lastEntry: null })).toBe(
      "Export incomplete: this file holds the newest 1 matching entry because the export reached its time limit. Narrow the filters, for example to an earlier date range, and export again for the rest.",
    );
    expect(auditIncompleteMessage("rows", { written: 50_000, total: 50_001 })).toContain(
      "because one export can hold at most 50,000 entries.",
    );
    const record = auditIncompleteRecord(size);
    expect(record).toHaveLength(AUDIT_CSV_HEADER.length);
    expect(record.slice(1).every((value) => value === null)).toBe(true);
    expect(csvRecord(record).startsWith(`"${AUDIT_EXPORT_INCOMPLETE_MARKER}`)).toBe(true);
    // The limits keep a file within what the route can send before its time limit.
    expect(AUDIT_EXPORT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(AUDIT_EXPORT_TIME_BUDGET_MS).toBeLessThan(60_000);
  });
});

describe("auditEntryView", () => {
  it("prepares an entry for the table", () => {
    const view = auditEntryView(row({ on_behalf: true }), "Batik Boutique");
    expect(view).toMatchObject({
      id: 42,
      time: "30 Sep 2026, 14:05",
      timestamp: "2026-09-30 14:05:23",
      system: false,
      actorEmail: "aisha@scaleup.my",
      actorRole: "Fund Admin",
      onBehalf: true,
      actionLabel: "Updated",
      actionTone: "neutral",
      entityLabel: "Monthly updates",
      companyName: "Batik Boutique",
      changeKind: "update",
    });
    expect(view.changes).toHaveLength(2);
  });

  it("shows the system, deleted companies and shortened values", () => {
    const view = auditEntryView(
      row({
        actor_id: null,
        actor_email: null,
        actor_role: "system",
        company_id: "c0000000-0000-4000-8000-000000000099",
        old_data: null,
        new_data: { body: "x".repeat(50) },
        action: "insert",
      }),
      null,
      10,
    );
    expect(view.system).toBe(true);
    expect(view.actorRole).toBe("System");
    expect(view.actorEmail).toBeNull();
    expect(view.companyName).toBeNull();
    expect(view.companyId).toBe("c0000000-0000-4000-8000-000000000099");
    expect(view.changes).toEqual([{ field: "body", before: null, after: "xxxxxxxxxx… (shortened)" }]);
  });
});
