// Server-renders the monthly form with the two revenue breakdowns of BRD B30: the company's own segments
// (calculated total, "Manage segments" for owners) and ScaleUp's revenue lines (not part of the total), in
// open and locked months. Interactions are covered by the draft model tests below.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.useFakeTimers();
vi.setSystemTime(new Date("2026-09-30T07:00:00Z"));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  useParams: () => ({}),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
  };
});
vi.mock("@/lib/actions/submission", () => ({
  saveSubmissionValues: async () => ({ ok: true, data: { savedAt: null } }),
  getSubmissionValidationAction: async () => ({ ok: false, error: "not used" }),
  submitSubmission: async () => ({ ok: false, error: "not used" }),
  requestAmendment: async () => ({ ok: false, error: "not used" }),
}));
vi.mock("@/components/comments/comment-threads", async () => {
  const React = await import("react");
  return {
    CommentThreadsPanel: () => React.createElement("div", { "data-panel": "comments" }),
    FieldCommentButton: (props: { target: string }) =>
      React.createElement("button", { "data-comment-target": props.target }),
  };
});

import {
  emptyDraft,
  numberDraft,
  reconcileRevenueTotal,
  reconcileWithCompanySegments,
  toDraftValues,
  withSegmentAmount,
  withSegmentValue,
} from "@/components/submission-form/draft";
import { DraftStore, type SaveFunction } from "@/components/submission-form/draft-store";
import { SCALEUP_LINES_NOTE } from "@/components/submission-form/revenue";
import { SubmissionForm, type SubmissionFormProps } from "@/components/submission-form/submission-form";
import { segmentsForMonth, toValidationInput } from "@/lib/types/domain";
import { validateSubmissionDraft } from "@/lib/validation";

import {
  AONEPAY,
  IDS,
  LEGACY_LINE,
  ONLINE,
  RETAIL,
  RETIRED_AT,
  makeBundle,
  values,
  WHOLESALE,
} from "./fixtures";

function render(props: Partial<SubmissionFormProps> & Pick<SubmissionFormProps, "bundle">): string {
  return renderToStaticMarkup(
    createElement(SubmissionForm, { mode: "company", canSubmit: true, commentMode: "company", ...props }),
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** The markup of the block (section) whose heading has this id ('' when there is none). */
function block(html: string, headingId: string): string {
  const heading = html.indexOf(`id="${headingId}"`);
  if (heading < 0) return "";
  const start = html.lastIndexOf("<section", heading);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", heading));
}

const SEGMENTS_BLOCK = "sf-field-revenue_total-segments";
const LINES_BLOCK = "sf-scaleup-revenue-lines";
const SEGMENTS_HREF = `/portal/${IDS.company}/segments`;

afterAll(() => {
  vi.useRealTimers();
});

describe("monthly form: owner editing an open month with both breakdowns", () => {
  const html = render({ bundle: makeBundle("draft") });
  const visible = text(html);
  const segments = block(html, SEGMENTS_BLOCK);
  const lines = block(html, LINES_BLOCK);

  it("asks for each segment in use and calculates total revenue from them", () => {
    expect(segments).toContain(`id="sf-segment-${IDS.retail}"`);
    expect(segments).toContain(`id="sf-segment-${IDS.online}"`);
    expect(segments).not.toContain(IDS.wholesale); // retired: not asked for any more
    expect(segments).not.toContain(IDS.aonePay); // ScaleUp lines are not part of the total
    expect(segments).toMatch(/<output[^>]*id="sf-field-revenue_total"/);
    expect(text(segments)).toContain("Total revenue (calculated)");
    expect(text(segments)).toContain("RM 1,000");
    expect(html).not.toMatch(/<input[^>]*id="sf-field-revenue_total"/);
  });

  it("links owners to the segments page", () => {
    expect(segments).toContain(`href="${SEGMENTS_HREF}"`);
    expect(text(segments)).toContain("Manage segments");
  });

  it("asks for ScaleUp's revenue lines separately, with the note that they need not add up", () => {
    expect(text(lines)).toContain("ScaleUp revenue lines");
    expect(text(lines)).toContain(SCALEUP_LINES_NOTE);
    expect(lines).toContain(`id="sf-segment-${IDS.aonePay}"`);
    expect(lines).not.toContain(IDS.legacyLine); // inactive
    expect(text(lines)).toContain("Aug 2026: RM 120"); // last month's figure
  });

  it("shows no inline error before a field is visited, while the check lists what is missing", () => {
    expect(html).not.toContain('aria-invalid="true"');
    expect(visible).toContain("Revenue for AOnePay is required.");
  });
});

describe("monthly form: other viewers and months", () => {
  it("offers no segments link to contributors or to Fund Admins entering data on behalf", () => {
    const contributor = render({ bundle: makeBundle("draft"), canSubmit: false });
    expect(contributor).not.toContain(SEGMENTS_HREF);
    expect(contributor).toContain(`id="sf-segment-${IDS.retail}"`);
    const onBehalf = render({ bundle: makeBundle("draft"), mode: "on_behalf", canSubmit: false, commentMode: "scaleup" });
    expect(onBehalf).not.toContain(SEGMENTS_HREF);
    expect(onBehalf).toMatch(/<output[^>]*id="sf-field-revenue_total"/);
  });

  it("asks for total revenue directly without segments of the company's own, with a set-up hint for owners", () => {
    const bundle = makeBundle("draft", {
      segments: [AONEPAY, LEGACY_LINE],
      current: values(1000, { [IDS.aonePay]: 400 }),
    });
    const owner = render({ bundle });
    expect(owner).toMatch(/<input[^>]*id="sf-field-revenue_total"/);
    expect(owner).not.toContain(`id="${SEGMENTS_BLOCK}"`);
    expect(owner).toContain(`href="${SEGMENTS_HREF}"`);
    expect(text(owner)).toContain("Set up revenue segments");
    expect(text(block(owner, LINES_BLOCK))).toContain("AOnePay");

    const contributor = render({ bundle, canSubmit: false });
    expect(contributor).toMatch(/<input[^>]*id="sf-field-revenue_total"/);
    expect(contributor).not.toContain(SEGMENTS_HREF);
  });

  it("explains a total entered before the segments were filled in", () => {
    const html = render({ bundle: makeBundle("draft", { current: values(1000, {}) }) });
    const segments = text(block(html, SEGMENTS_BLOCK));
    expect(segments).toContain("Entered earlier as RM 1,000.");
    expect(segments).not.toContain("RM 1,000 Entered"); // the calculated total is empty, not the old figure
  });

  it("corrects a stale total to the sum of the segments", () => {
    const html = render({ bundle: makeBundle("draft", { current: values(999, { [IDS.retail]: 600, [IDS.online]: 400 }) }) });
    expect(text(block(html, SEGMENTS_BLOCK))).toContain("RM 1,000");
  });

  it("shows the sum of the segments in a month still open for changes seen read-only (stale stored total)", () => {
    // E.g. a partner viewing a draft after the owner changed the segments: the stored 999 is out of date
    // until the month is next saved, so the sum is shown, as the exports and the review page show it.
    const html = render({
      bundle: makeBundle("draft", { current: values(999, { [IDS.retail]: 600, [IDS.online]: 400 }) }),
      mode: "readonly",
    });
    const segments = text(block(html, SEGMENTS_BLOCK));
    expect(segments).toContain("RM 1,000");
    expect(segments).not.toContain("RM 999");
    // Nothing filled in yet: the stored total stays.
    const empty = render({ bundle: makeBundle("draft", { current: values(1000, {}) }), mode: "readonly" });
    expect(text(block(empty, SEGMENTS_BLOCK))).toContain("RM 1,000");
  });

  it("shows a locked month exactly as it was submitted, retired segments and lines included", () => {
    const bundle = makeBundle("approved", {
      current: values(900, { [IDS.retail]: 500, [IDS.wholesale]: 400, [IDS.legacyLine]: 50 }),
    });
    const html = render({ bundle, mode: "readonly" });
    const segments = text(block(html, SEGMENTS_BLOCK));
    expect(segments).toContain("Retail");
    expect(segments).toContain("Wholesale (no longer used)");
    expect(segments).not.toContain("Online"); // no figure that month
    expect(segments).toContain("RM 900"); // the submitted total
    expect(segments).not.toContain("Manage segments");
    const lines = text(block(html, LINES_BLOCK));
    expect(lines).toContain("Legacy line (no longer used)");
    expect(lines).toContain("RM 50");
    expect(lines).not.toContain("AOnePay");
    expect(html).not.toContain('inputMode="decimal"');
  });
});

describe("draft model: the two breakdowns", () => {
  const own = [RETAIL, ONLINE];

  it("keeps total revenue equal to the company's own segments", () => {
    let draft = withSegmentAmount(emptyDraft(), own, IDS.retail, 700);
    draft = withSegmentAmount(draft, own, IDS.online, 300.5);
    expect(draft.values.revenue_total).toEqual(numberDraft(1000.5));
  });

  it("never lets a ScaleUp revenue line change total revenue", () => {
    const start = { ...emptyDraft(), values: { revenue_total: numberDraft(1000) } };
    const line = withSegmentValue(start, IDS.aonePay, 5000);
    expect(line.segments).toEqual({ [IDS.aonePay]: 5000 });
    expect(line.values.revenue_total).toEqual(numberDraft(1000));
    // Even through withSegmentAmount: an id that is not one of the company's own segments.
    const guarded = withSegmentAmount(start, own, IDS.aonePay, 5000);
    expect(guarded.values.revenue_total).toEqual(numberDraft(1000));
    expect(withSegmentValue(line, IDS.aonePay, null).segments).toEqual({});
  });

  it("reconciles a stale total with the company's own segments only", () => {
    const bundle = makeBundle("draft");
    const ownNow = segmentsForMonth(bundle.config, bundle.current, true).company;
    expect(ownNow.map((segment) => segment.id)).toEqual([IDS.retail, IDS.online]);
    const draft = {
      ...emptyDraft(),
      values: { revenue_total: numberDraft(10) },
      segments: { [IDS.retail]: 600, [IDS.aonePay]: 9000, [WHOLESALE.id]: 50 },
    };
    expect(reconcileRevenueTotal(draft, ownNow).values.revenue_total).toEqual(numberDraft(600));
    expect(reconcileWithCompanySegments(draft, bundle.config).values.revenue_total).toEqual(numberDraft(600));
  });
});

describe("monthly form: the segments change while the form is open", () => {
  it("recalculates and autosaves total revenue when a newer bundle no longer has a segment", async () => {
    // The form opened with Retail 600 + Online 400 = 1,000.
    const opened = makeBundle("draft", { current: values(1000, { [IDS.retail]: 600, [IDS.online]: 400 }) });
    const saved = toDraftValues(opened.current);
    const save = vi.fn<SaveFunction>(async () => ({ ok: true, savedAt: "2026-09-30T06:10:00+00:00" }));
    const store = new DraftStore({
      initial: reconcileWithCompanySegments(saved, opened.config),
      saved,
      lastSavedAt: opened.submission.last_saved_at,
      types: { fieldTypes: { revenue_total: "currency" }, kpiTypes: {} },
      save,
      enabled: true,
      debounceMs: 10,
    });
    expect(store.getSnapshot().draft.values.revenue_total).toEqual(numberDraft(1000));

    // Meanwhile the owner removed Online on the segments page: the database retired it and cleared its
    // figure in this open month, but the stored total is still 1,000. An autosave refreshed the page.
    const refreshed = makeBundle("draft", {
      segments: [RETAIL, { ...ONLINE, is_active: false, retired_at: RETIRED_AT }, WHOLESALE, AONEPAY, LEGACY_LINE],
      current: values(1000, { [IDS.retail]: 600 }),
    });
    // What SubmissionForm does with a newer bundle.
    store.syncFromServer(toDraftValues(refreshed.current), refreshed.submission.last_saved_at);
    const mismatch = (draft = store.getSnapshot().draft) =>
      validateSubmissionDraft(toValidationInput(refreshed, draft)).some((issue) => issue.code === "sum_mismatch");
    expect(mismatch()).toBe(true); // what the owner could not fix before
    store.update((draft) => reconcileWithCompanySegments(draft, refreshed.config));

    expect(store.getSnapshot().draft.values.revenue_total).toEqual(numberDraft(600));
    expect(store.getSnapshot().draft.segments).toEqual({ [IDS.retail]: 600 });
    expect(mismatch()).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      values: [{ key: "revenue_total", value_number: 600 }],
      segments: [],
      kpis: [],
    });

    // Already right: the next refresh changes nothing and sends nothing.
    const before = store.getSnapshot().draft;
    store.update((draft) => reconcileWithCompanySegments(draft, refreshed.config));
    expect(store.getSnapshot().draft).toBe(before);
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("leaves total revenue alone for companies without segments of their own", () => {
    const bundle = makeBundle("draft", { segments: [AONEPAY], current: values(1000, { [IDS.aonePay]: 5000 }) });
    const draft = toDraftValues(bundle.current);
    expect(reconcileWithCompanySegments(draft, bundle.config)).toBe(draft);
  });
});
