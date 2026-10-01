// The template builder's writes against the real database rules (the migrated + seeded PGlite database
// of tests/db): the rows the actions build (keys, sort orders, options and limits JSON, system-field
// edits) pass RLS and the guard triggers as a Fund Admin, the draft publishes, months opened afterwards
// use it while opened months keep theirs, and the limits set in the builder are enforced (BRD A3, B26).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SEED } from "../../db/fixtures";
import { expectRule, freshDb, type Sql, type TestDb } from "../../db/harness";
import { kiddoKpis, save, systemValues } from "../../db/scenario";
import {
  NEW_FIELD_RULES,
  buildFieldOptions,
  buildFieldValidation,
  checkPublishReadiness,
  diffTemplateVersions,
  placeAfter,
  planSortOrders,
  rulesFromField,
  sortByTemplateOrder,
  suggestFieldKey,
  suggestSectionKey,
  type ComparableField,
  type ComparableSection,
} from "@/app/admin/templates/_lib/rules";
import type { Json } from "@/lib/supabase/database.types";
import type { FieldType, SectionKind } from "@/lib/types/enums";

type SectionRow = { id: string; key: string; title: string; description: string | null; kind: SectionKind; sort_order: number };
type FieldRow = ComparableField & { id: string; section_id: string };
type LoadedVersion = { sections: (ComparableSection & { id: string; fields: FieldRow[] })[] };

let db: TestDb;
let fundAdmin: string;
let owner: string;

beforeEach(async () => {
  db = await freshDb();
  fundAdmin = await db.createUser({ scaleupRole: "fund_admin", fullName: "Fay Fund" });
  owner = await db.createUser({ fullName: "Kim Kiddo" });
  await db.addMember(SEED.companies.kiddocare, owner, "owner");
});

afterEach(async () => {
  await db?.close();
});

/** A version as the builder sees it (RLS applies to the caller). */
async function loadVersion(sql: Sql, versionId: string): Promise<LoadedVersion> {
  const sections = await sql.query<SectionRow>(
    "select id, key, title, description, kind::text as kind, sort_order from public.template_sections where template_version_id = $1",
    [versionId],
  );
  const fields = await sql.query<FieldRow>(
    `select id, section_id, key, label, help_text, field_type::text as field_type, is_required, is_system, options, validation, sort_order
       from public.template_fields where template_version_id = $1`,
    [versionId],
  );
  return {
    sections: sortByTemplateOrder(sections).map((section) => ({
      ...section,
      fields: sortByTemplateOrder(fields.filter((field) => field.section_id === section.id)),
    })),
  };
}

/** addFieldAction's insert. */
async function insertField(
  sql: Sql,
  versionId: string,
  sectionId: string,
  field: { key: string; label: string; type: FieldType; required?: boolean; options: Json | null; validation: Json | null; order: number },
): Promise<void> {
  await sql.query(
    `insert into public.template_fields
       (template_version_id, section_id, key, label, help_text, field_type, is_required, is_system, options, validation, sort_order)
     values ($1, $2, $3, $4, null, $5, $6, false, $7, $8, $9)`,
    [versionId, sectionId, field.key, field.label, field.type, field.required ?? false, field.options, field.validation, field.order],
  );
}

describe("template builder writes against the database", () => {
  it("builds, publishes and enforces a new version end to end", async () => {
    await db.setToday("2026-09-30");
    await db.rpc("open_due_periods"); // Jul and Aug 2026 open with version 1

    const draftId = await db.asUser(fundAdmin, (sql) =>
      sql.rpc<string>("create_template_draft", { p_template_id: SEED.template.id }),
    );

    await db.asUser(fundAdmin, async (sql) => {
      const before = await loadVersion(sql, draftId);

      // addSectionAction: key from the title, appended, then placed after "Other Mentionables".
      const key = suggestSectionKey("Unit economics", before.sections.map((section) => section.key));
      const lastOrder = Math.max(...before.sections.map((section) => section.sort_order));
      const unitId = await sql.value<string>(
        `insert into public.template_sections (template_version_id, key, title, description, kind, sort_order)
         values ($1, $2, 'Unit economics', null, 'custom_numbers', $3) returning id`,
        [draftId, key, lastOrder + 1],
      );
      const other = before.sections.find((section) => section.key === "other_mentionables");
      const desired = placeAfter([...before.sections.map((section) => section.id), unitId], unitId, other?.id ?? null);
      const updates = planSortOrders([...before.sections, { id: unitId, sort_order: lastOrder + 1 }], desired);
      expect(updates).toHaveLength(2);
      for (const update of updates) {
        const rows = await sql.query(
          "update public.template_sections set sort_order = $2 where id = $1 and template_version_id = $3 returning id",
          [update.id, update.sort_order, draftId],
        );
        expect(rows).toHaveLength(1);
      }

      // addFieldAction: a limited currency field, a 0–10 rating and a picklist.
      const versionKeys = before.sections.flatMap((section) => section.fields.map((field) => field.key));
      const cacKey = suggestFieldKey("Customer acquisition cost", { versionKeys, lockedFields: {}, fieldType: "currency" });
      expect(cacKey).toBe("customer_acquisition_cost");
      await insertField(sql, draftId, unitId, {
        key: cacKey,
        label: "Customer acquisition cost",
        type: "currency",
        required: true,
        options: buildFieldOptions("currency", { choices: [], rating: null }),
        validation: buildFieldValidation(cacKey, "currency", { ...NEW_FIELD_RULES, min: 0, max: 50000 }),
        order: 1,
      });
      const pulse = before.sections.find((section) => section.key === "founder_pulse");
      await insertField(sql, draftId, String(pulse?.id), {
        key: "confidence",
        label: "Confidence in the plan",
        type: "rating",
        options: buildFieldOptions("rating", { choices: [], rating: { min: 0, max: 10, labels: { "0": "None", "10": "Full" } } }),
        validation: buildFieldValidation("confidence", "rating", NEW_FIELD_RULES),
        order: 5,
      });
      const investment = before.sections.find((section) => section.key === "investment");
      await insertField(sql, draftId, String(investment?.id), {
        key: "stage",
        label: "Funding stage",
        type: "picklist",
        options: buildFieldOptions("picklist", { choices: ["Pre-seed", "Seed", "Series A"], rating: null }),
        validation: null,
        order: 3,
      });

      // updateFieldAction on system fields (BRD B26): relabel net profit and refuse negatives; cap revenue.
      const netProfit = before.sections.flatMap((section) => section.fields).find((field) => field.key === "net_profit");
      if (!netProfit) throw new Error("net_profit missing");
      const edited = await sql.query(
        `update public.template_fields set label = $2, help_text = $3, validation = $4
          where template_version_id = $1 and key = 'net_profit' returning id`,
        [
          draftId,
          "Net profit after tax",
          "After tax",
          buildFieldValidation("net_profit", "currency", { ...rulesFromField(netProfit), allow_negative: false }),
        ],
      );
      expect(edited).toHaveLength(1);
      await sql.query("update public.template_fields set validation = $2 where template_version_id = $1 and key = 'revenue_total'", [
        draftId,
        buildFieldValidation("revenue_total", "currency", { ...NEW_FIELD_RULES, allow_negative: true, min: 0, max: 1e12 }),
      ]);

      // deleteSectionAction on a narrative section removes its fields with it.
      await sql.query("delete from public.template_sections where template_version_id = $1 and key = 'other_mentionables'", [draftId]);
    });

    // Readiness and changes, computed from what the database holds.
    const [published, draft] = await db.asUser(fundAdmin, (sql) =>
      Promise.all([loadVersion(sql, SEED.template.v1), loadVersion(sql, draftId)]),
    );
    expect(checkPublishReadiness(draft)).toEqual([]);
    expect(diffTemplateVersions(published, draft).map((change) => change.text)).toEqual([
      "Added section “Unit economics” (1 field)",
      "Removed section “Other Mentionables” (1 field)",
      "Changed “Total revenue”: limits",
      "Renamed field “Net profit” to “Net profit after tax”",
      "Changed “Net profit after tax”: help text, limits",
      "Added field “Funding stage” to “Investment”",
      "Added field “Confidence in the plan” to “Founder Pulse”",
    ]);

    // publishVersionAction: notes, then publish_template_version.
    await db.asUser(fundAdmin, async (sql) => {
      const noted = await sql.query(
        "update public.template_versions set notes = $2 where id = $1 and status = 'draft' returning id",
        [draftId, "Adds unit economics and a funding stage."],
      );
      expect(noted).toHaveLength(1);
      await sql.rpc("publish_template_version", { p_version_id: draftId });
    });
    expect(await db.query("select version_no, status::text as status, notes from public.template_versions order by version_no")).toEqual([
      { version_no: 1, status: "archived", notes: "Initial version" },
      { version_no: 2, status: "published", notes: "Adds unit economics and a funding stage." },
    ]);

    // Months opened from now on use version 2; months already opened keep version 1.
    await db.setToday("2026-10-02");
    await db.rpc("open_due_periods");
    const versionOf = (month: string) =>
      db.value<string>("select template_version_id from public.submissions where company_id = $1 and month = $2", [
        SEED.companies.kiddocare,
        month,
      ]);
    expect(await versionOf("2026-07-01")).toBe(SEED.template.v1);
    expect(await versionOf("2026-08-01")).toBe(SEED.template.v1);
    expect(await versionOf("2026-09-01")).toBe(draftId);

    // The limits set in the builder are enforced on the new month.
    const september = await db.value<string>(
      "select id from public.submissions where company_id = $1 and month = '2026-09-01'",
      [SEED.companies.kiddocare],
    );
    await db.asUser(owner, (sql) =>
      save(sql, september, {
        values: [
          ...systemValues({ net_profit: -5000 }),
          { key: "customer_acquisition_cost", value_number: 60000 },
          { key: "confidence", value_number: 7 },
          { key: "stage", value_text: "Seed" },
        ],
        kpis: kiddoKpis(),
      }),
    );
    const validation = await db.asUser(owner, (sql) =>
      sql.rpc<{ ok: boolean; errors: { target: string; code: string; message: string }[] }>("get_submission_validation", {
        p_submission_id: september,
      }),
    );
    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        { target: "field:net_profit", code: "negative", message: "Net profit after tax cannot be negative." },
        {
          target: "field:customer_acquisition_cost",
          code: "out_of_range",
          message: "Customer acquisition cost must be between 0 and 50,000.",
        },
      ]),
    );
    // A rating outside the scale and a picklist answer outside the options are refused when saving.
    await expectRule(db.asUser(owner, (sql) => save(sql, september, { values: [{ key: "confidence", value_number: 11 }] })));
    await expectRule(db.asUser(owner, (sql) => save(sql, september, { values: [{ key: "stage", value_text: "Series Z" }] })));
    // The removed section's field is no longer part of the new month's form.
    await expectRule(db.asUser(owner, (sql) => save(sql, september, { values: [{ key: "other_updates", value_text: "Hello" }] })));
  });

  it("writes to a published version change nothing, which the actions report as stale", async () => {
    await db.asUser(fundAdmin, async (sql) => {
      expect(
        await sql.query(
          "update public.template_sections set title = 'X' where id = $1 and template_version_id = $2 returning id",
          [SEED.sections.operation, SEED.template.v1],
        ),
      ).toEqual([]);
      expect(
        await sql.query("update public.template_versions set notes = 'x' where id = $1 and status = 'draft' returning id", [
          SEED.template.v1,
        ]),
      ).toEqual([]);
      expect(
        await sql.query("delete from public.template_versions where id = $1 and status = 'draft' returning id", [SEED.template.v1]),
      ).toEqual([]);
    });
  });

  it("accepts label, help text and limits on every system field, and refuses type or key changes", async () => {
    const draftId = await db.asUser(fundAdmin, (sql) =>
      sql.rpc<string>("create_template_draft", { p_template_id: SEED.template.id }),
    );
    await db.asUser(fundAdmin, async (sql) => {
      const draft = await loadVersion(sql, draftId);
      for (const field of draft.sections.flatMap((section) => section.fields).filter((item) => item.is_system)) {
        const rules = { ...rulesFromField(field), max: 1e9 };
        const rows = await sql.query(
          "update public.template_fields set label = $2, help_text = $3, validation = $4 where id = $1 returning id",
          [field.id, `${field.label} (edited)`, "Help", buildFieldValidation(field.key, field.field_type, rules)],
        );
        expect(rows).toHaveLength(1);
      }
    });
    await expectRule(
      db.asUser(fundAdmin, (sql) =>
        sql.query("update public.template_fields set field_type = 'number' where template_version_id = $1 and key = 'burn_rate'", [
          draftId,
        ]),
      ),
      "System fields keep their key and type. You can change the label, help text and order.",
    );
  });
});
