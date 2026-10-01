// A month sent back (or reopened) after the owner changed the company's revenue segments (BRD B30): the
// figures it still holds for segments no longer in use are shown for reference instead of disappearing
// unseen, and opening or viewing the month saves nothing by itself — corrections the form makes (total
// revenue recalculated from the segments) wait for the person's first edit, or for the submit.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  figuresOnRetiredCompanySegments,
  numberDraft,
  reconcileWithCompanySegments,
  toDraftValues,
  withFieldValue,
} from "@/components/submission-form/draft";
import { DraftStore, type SaveFunction } from "@/components/submission-form/draft-store";
import { runReviewCheck } from "@/components/submission-form/review-dialog";
import { SubmissionForm, type SubmissionFormProps } from "@/components/submission-form/submission-form";

import { AONEPAY, IDS, LEGACY_LINE, ONLINE, RETAIL, RETIRED_AT, makeBundle, values, WHOLESALE } from "./fixtures";

/** The owner renamed Online after Aug and Sep were submitted: Online is retired, Web shop replaces it. */
const WEB_SHOP = { ...ONLINE, id: "f1000000-0000-4000-8000-000000000009", name: "Web shop", sort_order: 2 };
const ONLINE_RETIRED = { ...ONLINE, is_active: false, retired_at: RETIRED_AT };
const SEGMENTS = [RETAIL, WEB_SHOP, ONLINE_RETIRED, WHOLESALE, AONEPAY, LEGACY_LINE];

/** September, sent back after the change: it still holds Retail 600 and Online 400 (total 1,000). */
function sentBack(status: "changes_requested" | "approved" = "changes_requested") {
  return makeBundle(status, {
    segments: SEGMENTS,
    current: values(1000, { [IDS.retail]: 600, [IDS.online]: 400, [IDS.aonePay]: 50 }),
  });
}

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

describe("figures left on segments no longer in use", () => {
  it("lists the company's own retired segments that still have a figure, in segment order", () => {
    const bundle = sentBack();
    expect(figuresOnRetiredCompanySegments(bundle.config, bundle.current.segments)).toEqual([
      { segment: ONLINE_RETIRED, amount: 400 },
    ]);
    // ScaleUp revenue lines and segments in use never count; nor do empty figures.
    expect(
      figuresOnRetiredCompanySegments(bundle.config, {
        [IDS.retail]: 1,
        [IDS.legacyLine]: 2,
        [IDS.wholesale]: 3,
        [IDS.online]: null,
      }),
    ).toEqual([{ segment: WHOLESALE, amount: 3 }]);
  });

  it("shows them in a month open for changes, editing or viewing, but not once it is locked", () => {
    const editing = text(render({ bundle: sentBack() }));
    expect(editing).toContain("Reported earlier under segments no longer in use");
    expect(editing).toContain("Online: RM 400");
    expect(editing).toContain("Enter its revenue under the current segments below");
    const viewing = text(render({ bundle: sentBack(), mode: "readonly" }));
    expect(viewing).toContain("Online: RM 400");
    expect(viewing).toContain("not part of total revenue while the month is open");
    expect(text(render({ bundle: sentBack("approved"), mode: "readonly" }))).not.toContain("Reported earlier");
  });
});

describe("autosave holds corrections until the person edits", () => {
  function store(save: SaveFunction) {
    const bundle = sentBack();
    const saved = toDraftValues(bundle.current);
    return new DraftStore({
      // Total revenue follows the segments in use: Retail 600 (Web shop is still empty).
      initial: reconcileWithCompanySegments(saved, bundle.config),
      saved,
      lastSavedAt: bundle.submission.last_saved_at,
      types: { fieldTypes: { revenue_total: "currency", gross_profit: "currency" }, kpiTypes: {} },
      save,
      enabled: true,
      holdUntilEdit: true,
      debounceMs: 10,
    });
  }

  it("saves nothing when the month is only opened, viewed or left", async () => {
    const save = vi.fn<SaveFunction>(async () => ({ ok: true, savedAt: "2026-09-30T06:10:00+00:00" }));
    const draft = store(save);
    expect(draft.getSnapshot().draft.values.revenue_total).toEqual(numberDraft(600));
    expect(draft.isHolding()).toBe(true);
    draft.start();
    draft.adjust((current) => withFieldValue(current, "revenue_total", numberDraft(600)));
    await vi.advanceTimersByTimeAsync(50);
    await expect(draft.flush()).resolves.toBe(true); // leaving the page
    expect(save).not.toHaveBeenCalled();
    expect(draft.hasUnsavedWork()).toBe(false);
    // Nothing of the person's is waiting: the header keeps "Saved …" (the month was saved before).
    expect(draft.getSnapshot()).toMatchObject({ unsaved: 0, status: "saved" });
  });

  it("sends the held correction with the first edit", async () => {
    const save = vi.fn<SaveFunction>(async () => ({ ok: true, savedAt: "2026-09-30T06:10:00+00:00" }));
    const draft = store(save);
    draft.update((current) => withFieldValue(current, "gross_profit", numberDraft(250)));
    await vi.advanceTimersByTimeAsync(20);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      values: [
        { key: "gross_profit", value_number: 250 },
        { key: "revenue_total", value_number: 600 },
      ],
      segments: [],
      kpis: [],
    });
    expect(draft.isHolding()).toBe(false);
  });

  it("sends it before the submit check, so the server checks what the form shows", async () => {
    const save = vi.fn<SaveFunction>(async () => ({ ok: true, savedAt: "2026-09-30T06:10:00+00:00" }));
    const draft = store(save);
    const steps: string[] = [];
    await runReviewCheck(draft, IDS.submission, (step) => steps.push(step.kind));
    expect(save).toHaveBeenCalledWith({ values: [{ key: "revenue_total", value_number: 600 }], segments: [], kpis: [] });
    expect(steps[0]).toBe("checking");
  });
});
