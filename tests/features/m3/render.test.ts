// Server-render smoke tests of the template builder's components (no DOM environment is installed, so
// dialogs, which render into portals, are covered through the forms inside them): the structure editor in
// edit and read-only mode, the section form, the form preview, the status panel and the template card.
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { clone, fieldByKey, sectionByKey, seedVersion } from "./fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/app/admin/templates/actions", () => {
  const stub = async () => ({ ok: true, data: undefined });
  return {
    createDraftAction: stub,
    discardDraftAction: stub,
    publishVersionAction: stub,
    setDefaultTemplateAction: stub,
    addSectionAction: stub,
    updateSectionAction: stub,
    deleteSectionAction: stub,
    moveSectionAction: stub,
    addFieldAction: stub,
    updateFieldAction: stub,
    deleteFieldAction: stub,
    moveFieldAction: stub,
  };
});

const { TooltipProvider } = await import("@/components/ui/tooltip");
const { TemplateEditor } = await import("@/app/admin/templates/[versionId]/_components/template-editor");
const { FormPreview } = await import("@/app/admin/templates/[versionId]/_components/form-preview");
const { VersionStatusPanel } = await import("@/app/admin/templates/[versionId]/_components/version-status-panel");
const { EditorShell } = await import("@/app/admin/templates/[versionId]/_components/editor-shell");
const { PublishButton } = await import("@/app/admin/templates/[versionId]/_components/publish-button");
const { TemplateCard } = await import("@/app/admin/templates/_components/template-card");
const { SectionForm } = await import("@/app/admin/templates/[versionId]/_components/section-dialog");
const { checkPublishReadiness, diffTemplateVersions } = await import("@/app/admin/templates/_lib/rules");

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

/**
 * Keys that repeat among siblings anywhere in an element tree. React reports these only in the browser
 * ("Encountered two children with the same key"), so the tree a component returns is walked instead.
 */
function duplicateSiblingKeys(node: unknown): string[] {
  const duplicates: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const keys = value.flatMap((item) => (isValidElement(item) && item.key !== null ? [item.key] : []));
      duplicates.push(...keys.filter((key, index) => keys.indexOf(key) !== index));
      value.forEach(visit);
    } else if (isValidElement<{ children?: unknown }>(value)) {
      visit(value.props.children);
    }
  };
  visit(node);
  return duplicates;
}

describe("TemplateEditor", () => {
  it("renders the editing controls of a draft", () => {
    const draft = seedVersion(2);
    const html = render(createElement(TemplateEditor, { version: draft, editable: true, lockedFields: {}, base: null }));
    expect(html).toContain("13 sections");
    expect(html).toContain("23 fields");
    // Every section can be edited; only the ten non-system ones deleted.
    expect(count(html, "aria-label=\"Edit the “")).toBe(13);
    expect(count(html, "aria-label=\"Delete the “")).toBe(10);
    // Fields can be added to narrative and pulse sections only (not Financials, Headcount, Company KPIs).
    expect(count(html, "Add field")).toBe(10);
    // Seven locked system fields plus three system sections, each with the tooltip text as its name.
    expect(count(html, 'aria-label="System field - used in calculations"')).toBe(7);
    expect(count(html, 'aria-label="System section - always part of the form"')).toBe(3);
    // System fields have no delete button.
    expect(html).not.toContain("Delete “Total revenue”");
    expect(html).toContain("Delete “Key milestones”");
    // The first section cannot move up (aria-disabled keeps it focusable).
    expect(html).toMatch(/aria-label="Move section “Financials” up" aria-disabled="true"/);
    expect(html).toContain("Add section");
  });

  it("renders a published version read-only with New markers against its base", () => {
    const version = clone(seedVersion(1));
    const html = render(
      createElement(TemplateEditor, {
        version,
        editable: false,
        lockedFields: {},
        base: {
          sections: version.sections.filter((s) => s.key !== "operation").map((s) => ({ key: s.key, title: s.title })),
          fields: ["key_milestones"],
        },
      }),
    );
    expect(html).not.toContain("Add field");
    expect(html).not.toContain("Add section");
    expect(html).not.toContain("aria-label=\"Edit the");
    expect(html).not.toContain("Move section");
    // Operation is new (one marker for the section, none for its fields); other fields not in the base are new.
    expect(html).toContain(">New<");
    expect(count(html, ">New<")).toBe(1 + (23 - 1 - 2));
  });
});

describe("SectionForm (edit)", () => {
  const editForm = (key: string, publishedTitle: string | null) =>
    render(
      createElement(SectionForm, {
        mode: { type: "edit", section: sectionByKey(seedVersion(2), key), publishedTitle },
        pending: false,
        setPending: () => {},
        onDone: () => {},
      }),
    );
  const titleInput = (html: string) => html.match(/<input[^>]*\bid="section-title"[^>]*>/)?.[0] ?? "";

  it("warns under the title that renaming a published narrative or pulse section starts another C4 row", () => {
    const html = editForm("product_development", "Product Development");
    expect(titleInput(html)).toContain('aria-describedby="section-title-hint"');
    expect(html).toMatch(/<p[^>]*\bid="section-title-hint"[^>]*>The C4 export uses this title as its row name\./);
    expect(html).toContain(
      "The C4 export uses this title as its row name. Months already opened stay in the “Product Development” row, so a new title starts a separate row for months opened after you publish.",
    );
    // The published title is named even after an earlier rename in this draft.
    expect(editForm("founder_pulse", "Pulse")).toContain("stay in the “Pulse” row");
  });

  it("only names the C4 row for a section new in this draft, and says nothing for other kinds", () => {
    const fresh = editForm("product_development", null);
    expect(titleInput(fresh)).toContain('aria-describedby="section-title-hint"');
    expect(fresh).toContain("The C4 export uses this title as its row name.");
    expect(fresh).not.toContain("Months already opened");
    for (const key of ["financials", "headcount", "kpis"]) {
      const html = editForm(key, sectionByKey(seedVersion(1), key).title);
      expect(html).not.toContain("C4 export");
      expect(html).not.toContain("aria-describedby");
    }
  });
});

describe("FormPreview", () => {
  it("shows every section and field with required markers, options and scales", () => {
    const html = render(createElement(FormPreview, { sections: seedVersion().sections }));
    for (const title of ["Financials", "Headcount", "Company KPIs", "Investment", "Founder Pulse"]) expect(html).toContain(title);
    expect(html).toContain("Total revenue");
    expect(html).toContain("Enter 0 if cash-flow positive");
    expect(count(html, "(required)")).toBe(7);
    expect(html).toContain("Options: Not raising · Preparing to raise");
    expect(html).toContain("1 = Very low · 5 = Very high");
    expect(html).toContain("Legal and regulatory");
    expect(html).toContain("own KPIs appear here");
    expect(count(html, ">Optional<")).toBe(10);
    // Nothing in the preview is focusable.
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
  });

  it("flags choice fields without options", () => {
    const version = clone(seedVersion());
    fieldByKey(version, "fundraising_status").options = null;
    expect(render(createElement(FormPreview, { sections: version.sections }))).toContain("No options yet.");
  });
});

describe("VersionStatusPanel", () => {
  it("summarises readiness and changes of a draft", () => {
    const draft = clone(seedVersion(2));
    fieldByKey(draft, "fundraising_status").options = { options: [] };
    fieldByKey(draft, "burn_rate").label = "Monthly burn";
    const html = render(
      createElement(VersionStatusPanel, {
        mode: "draft",
        issues: checkPublishReadiness(draft),
        changes: diffTemplateVersions(seedVersion(1), draft),
        baseVersionNo: 1,
        versionNo: 2,
      }),
    );
    expect(html).toContain("Fix 1 issue before publishing");
    expect(html).toContain("“Fundraising status” needs at least one option.");
    expect(html).toContain("2 changes compared with version 1.");
    expect(html).toContain("Renamed field “Burn rate (per month)” to “Monthly burn”");
  });

  it("flags a renamed C4 section against the published version without blocking publishing", () => {
    const draft = clone(seedVersion(2));
    sectionByKey(draft, "operation").title = "Operations";
    const html = render(
      createElement(VersionStatusPanel, {
        mode: "draft",
        issues: checkPublishReadiness(draft, seedVersion(1)),
        changes: diffTemplateVersions(seedVersion(1), draft),
        baseVersionNo: 1,
        versionNo: 2,
      }),
    );
    expect(html).toContain("Ready to publish");
    expect(html).toContain(
      "Renamed “Operation” to “Operations”: the C4 export will show earlier months and months opened with this version in separate rows.",
    );
    expect(html).toContain("Renamed section “Operation” to “Operations”");
  });

  it("lists identical messages separately, under keys that never repeat", () => {
    // Only keys must be unique: two empty sections titled "Other" give the same warning, and two picklists
    // labelled "Stage" without options the same error.
    const draft = clone(seedVersion(2));
    const empty = sectionByKey(draft, "other_mentionables");
    draft.sections.push(
      { ...empty, id: "other-1", key: "other", title: "Other", sort_order: 21, fields: [] },
      { ...empty, id: "other-2", key: "other_2", title: "Other", sort_order: 22, fields: [] },
    );
    for (const key of ["fundraising_status", "help_tags"]) {
      const field = fieldByKey(draft, key);
      field.field_type = "picklist";
      field.label = "Stage";
      field.options = null;
    }
    const issues = checkPublishReadiness(draft);
    const messages = issues.map((issue) => issue.message);
    expect(messages.filter((message) => message === "“Stage” needs at least one option.")).toHaveLength(2);
    expect(messages.filter((message) => message === "“Other” has no fields yet.")).toHaveLength(2);

    const props = { mode: "draft" as const, issues, changes: [], baseVersionNo: 1, versionNo: 2 };
    const html = render(createElement(VersionStatusPanel, props));
    expect(html).toContain("Fix 2 issues before publishing");
    expect(count(html, "“Stage” needs at least one option.")).toBe(2);
    expect(count(html, "“Other” has no fields yet.")).toBe(2);
    expect(duplicateSiblingKeys(VersionStatusPanel(props))).toEqual([]);
  });

  it("shows the release notes of a published version", () => {
    const html = render(
      createElement(VersionStatusPanel, {
        mode: "history",
        issues: [],
        changes: [],
        baseVersionNo: null,
        versionNo: 1,
        notes: "Initial version",
      }),
    );
    expect(html).toContain("What changed in version 1");
    expect(html).toContain("The first version of the template.");
    expect(html).toContain("Initial version");
  });
});

describe("page pieces", () => {
  it("renders the editor shell with both panes and the publish button", () => {
    const html = render(
      createElement(EditorShell, {
        structure: createElement("p", null, "structure pane"),
        preview: createElement("p", null, "preview pane"),
      }),
    );
    expect(html).toContain("structure pane");
    expect(html).toContain("preview pane");
    expect(html).toContain("Structure");
    const publish = render(
      createElement(PublishButton, {
        versionId: "v2",
        versionNo: 2,
        templateName: "Portfolio Update",
        isDefault: true,
        blockingCount: 2,
        changeCount: 3,
        previousVersionNo: 1,
        latestOpenMonth: "2026-09-01",
      }),
    );
    expect(publish).toMatch(/<button[^>]*disabled=""[^>]*>.*Publish/);
    expect(publish).toContain("Fix the 2 issues listed on this page before publishing.");
  });

  it("renders a template card with its versions", () => {
    const published = {
      id: "v1",
      templateId: "t1",
      versionNo: 1,
      status: "published" as const,
      notes: "Initial version",
      createdAt: "2026-09-30T00:00:00Z",
      createdBy: null,
      publishedAt: "2026-09-30T02:00:00Z",
      publishedBy: "u1",
      sectionCount: 13,
      fieldCount: 23,
      months: ["2026-07-01", "2026-08-01", "2026-09-01"],
    };
    const draft = { ...published, id: "v2", versionNo: 2, status: "draft" as const, notes: null, publishedAt: null, publishedBy: null, months: [], createdBy: "u1" };
    const html = render(
      createElement(TemplateCard, {
        overview: {
          template: { id: "t1", name: "Portfolio Update", description: "Monthly update", is_default: true, created_at: "2026-09-30T00:00:00Z" },
          versions: [draft, published],
          draft,
          published,
          draftChanges: [{ type: "added", text: "Added section “Unit economics”" }],
        },
        people: { u1: "Aisha Rahman" },
        canManage: true,
        showMakeDefault: false,
      }),
    );
    expect(html).toContain("Portfolio Update");
    expect(html).toContain(">Default<");
    expect(html).toContain("Continue draft");
    expect(html).toContain("Published 30 Sep 2026 by Aisha Rahman");
    expect(html).toContain("Jul–Sep 2026");
    expect(html).toContain("1 change not yet published");
    expect(html).toContain("30 Sep 2026, 10:00");
    expect(html).toContain("Version 2");
    expect(html).toContain('href="/admin/templates/v2"');
    expect(html).not.toContain("Make default");
  });
});
