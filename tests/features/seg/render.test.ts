// Server-render smoke tests of the revenue segments UI (BRD B30): the portal page's editor (owners) and
// read-only views, and the Revenue tab of the ScaleUp company page (ScaleUp revenue lines + the company's
// own segments, read-only). Logic is unit-tested in segments-model.test.ts.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const result = { data: state.tables[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order", "range", "limit"]) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    },
  }),
}));
vi.mock("@/app/portal/[companyId]/segments/actions", () => ({ saveRevenueSegmentsAction: vi.fn() }));
vi.mock("@/app/admin/companies/actions", () =>
  Object.fromEntries(
    [
      "addRevenueLineAction",
      "renameRevenueLineAction",
      "moveRevenueLineAction",
      "setRevenueLineActiveAction",
      "deleteRevenueLineAction",
    ].map((name) => [name, vi.fn(async () => ({ ok: true, data: undefined }))]),
  ),
);

import { RevenueTab } from "@/app/admin/companies/[companyId]/_components/revenue-tab";
import { companyTabLabel } from "@/app/admin/companies/[companyId]/_components/tabs";
import {
  RetiredSegments,
  ScaleUpLinesCard,
  SegmentsReadOnly,
} from "@/app/portal/[companyId]/segments/_components/segment-lists";
import {
  ChangeSummary,
  SegmentsEditor,
  type SegmentsEditorProps,
} from "@/app/portal/[companyId]/segments/_components/segments-editor";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { REVENUE_SEGMENT_CHANGE_WARNING } from "@/lib/constants";
import { diffCompanySegments } from "@/lib/types/domain";
import type { ScaleupRole } from "@/lib/types/enums";

import {
  AONEPAY,
  ALL_SEGMENTS,
  companyRow,
  IDS,
  LEGACY_LINE,
  ONLINE,
  RETAIL,
  segmentRow,
  WHOLESALE,
} from "./fixtures";

function html(element: ReactNode): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const USAGE: SegmentsEditorProps["usage"] = {
  [IDS.retail]: { months: ["2026-07", "2026-08", "2026-09"], lockedMonths: ["2026-07", "2026-08"], openMonths: ["2026-09"] },
  [IDS.wholesale]: { months: ["2026-07", "2026-08"], lockedMonths: ["2026-07", "2026-08"], openMonths: [] },
};

function editor(props: Partial<SegmentsEditorProps> = {}): string {
  return html(
    createElement(SegmentsEditor, {
      companyId: IDS.company,
      companyName: "Demo Company",
      current: [RETAIL, ONLINE],
      hasRetired: true,
      usage: USAGE,
      openMonths: ["2026-09"],
      ...props,
    }),
  );
}

describe("revenue segments page: the owner's editor", () => {
  it("lists the segments in use as editable rows, in order, with their figures", () => {
    const markup = editor();
    const visible = text(markup);
    expect(visible).toContain("Your revenue segments");
    expect(markup.indexOf('value="Retail"')).toBeGreaterThan(-1);
    expect(markup.indexOf('value="Retail"')).toBeLessThan(markup.indexOf('value="Online"'));
    expect(visible).toContain("Figures in 3 months (Jul–Sep 2026).");
    expect(visible).toContain("No figures yet.");
    expect(markup).toContain('aria-label="Move Retail up"');
    expect(markup).toContain('aria-label="Remove Online"');
    expect(visible).toContain("Add a segment");
    expect(visible).toContain("All changes saved.");
    expect(visible).toContain("Save changes");
    expect(markup).not.toContain('aria-invalid="true"');
    // Nothing to save yet.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Save changes/);
  });

  it("explains the first set-up: segments add up to total revenue and are reused every month", () => {
    const visible = text(editor({ current: [], hasRetired: false, usage: {}, openMonths: ["2026-08", "2026-09"] }));
    expect(visible).toContain("Set up your revenue segments");
    expect(visible).toContain("Your segments must add up to total revenue");
    expect(visible).toContain("They are reused every month");
    expect(visible).toContain(
      "Once saved, the months you haven't submitted yet (Aug 2026, Sep 2026) ask for revenue per segment.",
    );
    expect(visible).toContain("No segments yet. Add your first segment below.");
    expect(visible).toContain("Save segments");
  });

  it("tells an owner whose segments were all removed that total revenue is entered directly", () => {
    const visible = text(editor({ current: [], hasRetired: true, usage: {} }));
    expect(visible).toContain("No segments are in use, so monthly updates ask for total revenue directly.");
    expect(visible).not.toContain("Set up your revenue segments");
  });
});

describe("revenue segments page: the confirmation of changes", () => {
  const UNUSED = segmentRow("f1000000-0000-4000-8000-000000000009", "Unused", "company", 3);

  function summary(changes: ReturnType<typeof diffCompanySegments>, remaining: number): string {
    return html(createElement(ChangeSummary, { changes, usage: USAGE, remaining, openMonths: ["2026-09"] }));
  }

  it("states the comparability warning, the open months and each change", () => {
    const markup = summary(diffCompanySegments([RETAIL, ONLINE], [{ id: IDS.retail, name: "Shops" }]), 1);
    const visible = text(markup);
    expect(visible).toContain(REVENUE_SEGMENT_CHANGE_WARNING);
    expect(visible).toContain("Months not yet submitted: Sep 2026.");
    expect(visible).toContain(
      'Rename "Retail" to "Shops" It continues as a new series: Jul–Aug 2026 (already submitted) keep "Retail". ' +
        'Its figures in Sep 2026 (not submitted yet) move to "Shops".',
    );
    expect(visible).toContain('Remove "Online"');
    expect(visible).toContain("What changes Rename"); // short lists are not counted
  });

  it("keeps a long list of changes in a box that scrolls, so the dialog's buttons stay on a phone screen", () => {
    const changes = diffCompanySegments(
      [RETAIL, ONLINE, UNUSED],
      [
        { id: IDS.online, name: "Web" },
        { id: IDS.retail, name: "Shops" },
        { name: "Kiosks" },
      ],
    );
    const markup = summary(changes, 3);
    expect(markup).toMatch(
      /data-slot="segment-changes" class="[^"]*max-h-\[clamp\(5rem,100svh_-_29rem,40svh\)\][^"]*overflow-y-auto/,
    );
    expect(text(markup)).toContain("What changes (2 renamed, 1 removed, 1 added and a new order)");
    // Only inline elements: the summary sits inside the dialog's description paragraph.
    expect(markup).not.toMatch(/<(div|p|ul|li)[\s>]/);
  });
});

describe("revenue segments page: read-only parts", () => {
  it("shows contributors the segments without inputs", () => {
    const markup = html(
      createElement(SegmentsReadOnly, { companyName: "Demo Company", segments: [RETAIL, ONLINE], usage: USAGE, active: true }),
    );
    expect(text(markup)).toContain("Your revenue segments");
    expect(text(markup)).toContain("Retail");
    expect(text(markup)).toContain("Figures in 3 months (Jul–Sep 2026)");
    expect(markup).not.toContain("<input");
  });

  it("says when there are no segments, for contributors and for companies no longer active", () => {
    const contributor = text(
      html(createElement(SegmentsReadOnly, { companyName: "Demo Company", segments: [], usage: {}, active: true })),
    );
    expect(contributor).toContain("Your company owner hasn't set up revenue segments");
    const exited = text(
      html(createElement(SegmentsReadOnly, { companyName: "Demo Company", segments: [], usage: {}, active: false })),
    );
    expect(exited).toContain("Demo Company reported total revenue directly.");
  });

  it("collapses the segments no longer used", () => {
    const visible = text(html(createElement(RetiredSegments, { segments: [WHOLESALE], usage: USAGE })));
    expect(visible).toContain("No longer used (1)");
    expect(visible).toContain("the segments no longer used"); // the toggle's name for screen readers
    expect(visible).not.toContain("Wholesale"); // collapsed
    expect(html(createElement(RetiredSegments, { segments: [], usage: USAGE }))).toBe("");
  });

  it("lists ScaleUp's revenue lines separately: they need not add up", () => {
    const visible = text(html(createElement(ScaleUpLinesCard, { lines: [AONEPAY] })));
    expect(visible).toContain("ScaleUp revenue lines");
    expect(visible).toContain("don't need to add up to total revenue");
    expect(visible).toContain("AOnePay");
    expect(html(createElement(ScaleUpLinesCard, { lines: [] }))).toBe("");
  });
});

describe("ScaleUp company page: ScaleUp revenue lines tab", () => {
  function ctx(role: ScaleupRole): ScaleUpAccessContext {
    return {
      userId: "a1000000-0000-4000-8000-000000000009",
      email: "staff@example.com",
      fullName: "Staff",
      scaleupRole: role,
      isActive: true,
      memberships: [],
      aal: "aal2",
      mfaRequired: true,
      termsAccepted: true,
    };
  }

  beforeEach(() => {
    state.tables = {
      revenue_segments: ALL_SEGMENTS,
      submission_segment_values: [
        { submission_id: "90000000-0000-4000-8000-000000000007", segment_id: IDS.retail },
        { submission_id: "90000000-0000-4000-8000-000000000008", segment_id: IDS.retail },
        { submission_id: "90000000-0000-4000-8000-000000000007", segment_id: IDS.wholesale },
        { submission_id: "90000000-0000-4000-8000-000000000008", segment_id: IDS.aonePay },
      ],
    };
  });

  async function renderTab(role: ScaleupRole): Promise<string> {
    return html(await RevenueTab({ ctx: ctx(role), company: companyRow() }));
  }

  it("is called ScaleUp revenue lines, as the B30 brief names it", () => {
    expect(companyTabLabel("revenue")).toBe("ScaleUp revenue lines");
  });

  it("manages ScaleUp revenue lines only, explaining that they need not add up", async () => {
    const markup = await renderTab("fund_admin");
    const [lines] = markup.split("Company revenue segments");
    const visible = text(lines);
    expect(visible).toContain("ScaleUp revenue lines");
    expect(visible).toContain("They need not add up to total revenue");
    expect(visible).toContain("AOnePay");
    expect(visible).toContain("Figures in 1 month");
    expect(visible).toContain(LEGACY_LINE.name);
    expect(visible).toContain("Inactive");
    expect(visible).toContain("Add line");
    expect(visible).not.toContain("Retail");
    expect(visible).not.toContain("Wholesale");
    expect(await renderTab("partner")).not.toContain("Add line");
  });

  it("shows the company's own segments read-only, in use and retired, with dates", async () => {
    const markup = await renderTab("viewer");
    const panel = text(markup.slice(markup.indexOf("Company revenue segments")));
    expect(panel).toContain("Read-only");
    expect(panel.indexOf("Retail")).toBeLessThan(panel.indexOf("Online"));
    expect(panel).toContain("Figures in 2 months");
    expect(panel).toContain("Added 1 Jul 2026");
    expect(panel).toContain("No longer used");
    expect(panel).toContain("Wholesale");
    expect(panel).toContain("Retired 20 Sep 2026");
    expect(panel).not.toContain("AOnePay");
  });

  it("says so when the company has no segments of its own", async () => {
    state.tables.revenue_segments = [AONEPAY];
    const panel = text((await renderTab("super_admin")).split("Company revenue segments")[1] ?? "");
    expect(panel).toContain("hasn't set up revenue segments of its own, so it enters total revenue directly.");
  });
});
