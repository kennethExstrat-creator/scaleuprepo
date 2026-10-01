// Server-renders the whole monthly form in each mode (no browser needed) to check that every part renders
// and that the right texts and controls appear for each audience. Interactions are covered by the
// DraftStore and draft model tests.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

// Pinned before anything renders: the describe bodies below render while vitest collects them, before any
// beforeAll hook runs.
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-09-30T07:00:00Z")); // 15:00 in Kuala Lumpur

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
    FieldCommentButton: (props: {
      target: string;
      count?: number;
      canStartThreads: boolean;
      mode: string;
      targetLabel?: string;
    }) =>
      React.createElement("button", {
        "data-comment-target": props.target,
        "data-count": props.count ?? 0,
        "data-mode": props.mode,
        "data-label": props.targetLabel,
      }),
  };
});

import { SubmissionForm, type SubmissionFormProps } from "@/components/submission-form/submission-form";

import { IDS, event, makeBundle } from "./fixtures";

function render(props: Partial<SubmissionFormProps> & Pick<SubmissionFormProps, "bundle">): string {
  return renderToStaticMarkup(
    createElement(SubmissionForm, {
      mode: "company",
      canSubmit: true,
      commentMode: "company",
      ...props,
    }),
  );
}

/** Visible text, roughly (tags removed, entities decoded). */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** The markup of the input group (number box and its buttons) of the input with this id. */
function inputGroupOf(html: string, id: string): string {
  return html.split('data-slot="input-group"').find((chunk) => chunk.includes(`id="${id}"`)) ?? "";
}

afterAll(() => {
  vi.useRealTimers();
});

describe("SubmissionForm: company owner editing a draft", () => {
  const html = render({ bundle: makeBundle("draft"), earlierDrafts: ["2026-08"] });
  const visible = text(html);

  it("shows the sections in template order", () => {
    const order = ["Financials", "Headcount", "Company KPIs", "Narrative", "Founder Pulse"].map((title) =>
      visible.indexOf(title),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows the header with month, due date, save state and the submit action", () => {
    expect(visible).toContain("September 2026");
    expect(visible).toContain("Due 15 Oct 2026");
    expect(visible).toContain("Saved 14:05");
    expect(visible).toContain("Review and submit");
  });

  it("lists the active revenue segments with a read-only total", () => {
    expect(visible).toContain("Retail");
    expect(visible).toContain("Online");
    expect(visible).not.toContain("Wholesale (closed)");
    expect(html).toContain(`id="sf-segment-${IDS.segRetail}"`);
    expect(html).toMatch(/<output[^>]*id="sf-field-revenue_total"/);
    expect(visible).toContain("RM 1,000");
    // No separate total revenue input when there are segments.
    expect(html).not.toMatch(/<input[^>]*id="sf-field-revenue_total"/);
  });

  it("uses text inputs with a decimal keypad and the currency symbol", () => {
    expect(html).toMatch(
      /<input[^>]*id="sf-field-gross_profit"[^>]*inputMode="decimal"|<input[^>]*inputMode="decimal"[^>]*id="sf-field-gross_profit"/i,
    );
    expect(visible).toContain("Enter 0 if cash-flow positive");
    expect(visible).toContain("Aug 2026: RM 800");
  });

  it("offers a ± button where the number may be negative (iPhone keypads have no minus key)", () => {
    const sign = 'aria-label="Negative number"';
    const grossProfit = inputGroupOf(html, "sf-field-gross_profit");
    expect(grossProfit).toContain(sign);
    expect(grossProfit).toContain('aria-pressed="true"'); // -150
    expect(grossProfit).toMatch(/inputMode="decimal"/);
    expect(inputGroupOf(html, "sf-field-net_profit")).toContain('aria-pressed="false"');
    expect(inputGroupOf(html, `sf-kpi-${IDS.kpiRevenue}-${IDS.montKiara}`)).toContain(sign);
    expect(inputGroupOf(html, `sf-kpi-${IDS.kpiDownloads}`)).toContain(sign);
    // Figures that cannot be negative keep the plain keypad box.
    for (const id of [
      "sf-field-cash_in_bank",
      "sf-field-burn_rate",
      "sf-field-headcount_ft",
      `sf-segment-${IDS.segRetail}`,
    ]) {
      const group = inputGroupOf(html, id);
      expect(group).toContain(`id="${id}"`);
      expect(group).not.toContain(sign);
    }
  });

  it("shows the live metrics", () => {
    expect(visible).toContain("Calculated");
    expect(visible).toContain("Gross margin");
    expect(visible).toContain("-15.0%");
    expect(visible).toContain("Revenue vs Aug 2026");
    expect(visible).toContain("+25.0%");
  });

  it("lays out the KPI grid per outlet and the other KPIs as fields", () => {
    expect(visible).toContain("By outlet");
    expect(visible).toContain("Mont Kiara");
    expect(visible).toContain("The Row");
    expect(html).toContain(`aria-label="Revenue per outlet (Mont Kiara)"`);
    expect(html).toContain(`id="sf-kpi-${IDS.kpiDownloads}"`);
    expect(visible).toContain("downloads");
  });

  it("opens narrative categories that have content, with last month alongside", () => {
    expect(visible).toContain("Company Summary");
    expect(visible).toContain("Opened Merdeka 118");
    expect(visible).toContain("Last month (Aug 2026)");
    expect(visible).toContain("Copy last month");
    expect(visible).toContain("1 of 2 filled in");
  });

  it("shows the founder pulse controls", () => {
    expect(visible).toContain("Team morale");
    expect(html).toContain('aria-label="1: Very low"');
    expect(visible).toContain("Sales introductions");
  });

  it("warns that earlier months come first and lists what is missing", () => {
    expect(visible).toContain("Submit Aug 2026 first");
    expect(html).toContain(`href="/portal/${IDS.company}/updates/2026-08"`);
    expect(visible).toContain("Before this month can be submitted");
    expect(visible).toContain("Net profit is required.");
    expect(visible).toContain("Revenue per outlet (Mont Kiara) is required.");
  });

  it("does not show inline errors before a field is visited", () => {
    expect(html).not.toContain('aria-invalid="true"');
  });
});

describe("SubmissionForm: other audiences and states", () => {
  it("tells contributors that only the owner submits", () => {
    const visible = text(render({ bundle: makeBundle("draft"), canSubmit: false }));
    expect(visible).toContain("Only your company owner can submit this month.");
    expect(visible).not.toContain("Review and submit");
  });

  it("marks on-behalf entry and never offers Submit", () => {
    const visible = text(
      render({ bundle: makeBundle("draft"), mode: "on_behalf", canSubmit: false, commentMode: "scaleup" }),
    );
    expect(visible).toContain("You are entering data on behalf of Batik Boutique. Changes are logged.");
    expect(visible).toContain("Only the company owner can submit this month.");
    expect(visible).not.toContain("Review and submit");
  });

  it("renders submitted months read-only for the company", () => {
    const html = render({
      bundle: makeBundle("submitted", { events: [event("submitted", { actor_name: "Aisha Rahman" })] }),
      mode: "readonly",
    });
    const visible = text(html);
    expect(visible).toContain("Submitted: awaiting review by ScaleUp");
    expect(visible).toContain("by Aisha Rahman");
    expect(html).not.toContain('inputMode="decimal"');
    expect(html).not.toContain("<textarea");
    expect(visible).not.toContain("Review and submit");
    expect(visible).not.toContain("Before this month can be submitted");
  });

  it("names ScaleUp staff '<full name> (ScaleUp)' to company users (BRD B28)", () => {
    // The data layer names ScaleUp actors for company users through staff_display_names.
    const approval = event("approved", { actor_name: "Renuka Sena (ScaleUp)", message: "Thanks, all clear." });
    const visible = text(render({ bundle: makeBundle("approved", { events: [approval] }), mode: "readonly" }));
    expect(visible).toContain("September 2026 is approved and locked");
    expect(visible).toContain("by Renuka Sena (ScaleUp).");
    expect(visible).toContain("Approved by Renuka Sena (ScaleUp)"); // the Activity timeline
    expect(visible).toContain("Request amendment");
  });

  it("shows plain names to ScaleUp staff", () => {
    const approval = event("approved", { actor_name: "Renuka Sena", message: "Thanks, all clear." });
    const visible = text(
      render({
        bundle: makeBundle("approved", { events: [approval] }),
        mode: "readonly",
        canSubmit: false,
        commentMode: "scaleup",
      }),
    );
    expect(visible).toContain("by Renuka Sena.");
    expect(visible).not.toContain("(ScaleUp)");
    expect(visible).not.toContain("Request amendment");
  });

  it("shows 'ScaleUp' only when nobody can be named", () => {
    const visible = text(
      render({ bundle: makeBundle("changes_requested", { events: [event("reopened")] }), canSubmit: true }),
    );
    expect(visible).toContain("ScaleUp reopened this month");
    expect(visible).toContain("Reopened by ScaleUp");
  });

  it("shows who asked for changes, with the message and who resubmits", () => {
    const request = event("changes_requested", {
      actor_name: "Renuka Sena (ScaleUp)",
      message: "Please split revenue by outlet.",
    });
    const owner = text(render({ bundle: makeBundle("changes_requested", { events: [request] }) }));
    expect(owner).toContain("Renuka Sena (ScaleUp) asked for changes");
    expect(owner).toContain("Please split revenue by outlet.");
    expect(owner).toContain("then resubmit by 15 Oct 2026.");
    expect(owner).toContain("Due 15 Oct 2026");

    const contributor = text(
      render({ bundle: makeBundle("changes_requested", { events: [request] }), canSubmit: false }),
    );
    expect(contributor).toContain("the company owner then resubmits by 15 Oct 2026.");
  });

  it("explains that exited companies are read-only, with no due date", () => {
    const visible = text(
      render({ bundle: makeBundle("draft", { companyStatus: "exited" }), mode: "readonly", canSubmit: false }),
    );
    expect(visible).toContain("Batik Boutique is no longer an active portfolio company, so its records are read-only.");
    expect(visible).not.toContain("Review and submit");
    expect(visible).not.toContain("Due 15 Oct 2026");
  });

  it("does not ask written-off companies to resubmit a month sent back", () => {
    const request = event("changes_requested", { actor_name: "Renuka Sena (ScaleUp)" });
    const visible = text(
      render({
        bundle: makeBundle("changes_requested", { companyStatus: "written_off", events: [request] }),
        mode: "readonly",
        canSubmit: false,
      }),
    );
    expect(visible).toContain("Renuka Sena (ScaleUp) asked for changes");
    expect(visible).toContain("Batik Boutique is no longer active, so this month stays as it was last saved.");
    expect(visible).not.toContain("Due again by");
    expect(visible).not.toContain("Due 15 Oct 2026");
  });
});

describe("SubmissionForm: comments", () => {
  const counts = { "field:gross_profit": { total: 2, unresolved: 1 }, general: { total: 1, unresolved: 1 } };

  it("company users only see buttons where ScaleUp started a thread", () => {
    const html = render({ bundle: makeBundle("draft"), commentCounts: counts });
    const targets = Array.from(html.matchAll(/data-comment-target="([^"]+)"/g)).map((match) => match[1]);
    expect(targets).toEqual(["field:gross_profit"]);
    expect(html).toContain('aria-label="Comments, 2 unresolved"');
  });

  it("ScaleUp staff who may comment get a button on every field, segment and KPI cell", () => {
    const html = render({
      bundle: makeBundle("draft"),
      mode: "on_behalf",
      canSubmit: false,
      commentMode: "scaleup",
      canStartThreads: true,
      commentCounts: counts,
    });
    const labels = new Map(
      Array.from(html.matchAll(/data-comment-target="([^"]+)"[^>]*data-label="([^"]*)"/g)).map((match) => [
        match[1],
        match[2],
      ]),
    );
    // Each button is named after its target, as on the review page.
    expect(labels.get("field:net_profit")).toBe("Net profit");
    expect(labels.get(`segment:${IDS.segRetail}`)).toBe("Revenue: Retail");
    expect(labels.get(`kpi:${IDS.kpiRevenue}:${IDS.montKiara}`)).toBe("Revenue per outlet (Mont Kiara)");
    expect(labels.get(`kpi:${IDS.kpiRevenue}:${IDS.theRow}`)).toBe("Revenue per outlet (The Row)");
    expect(labels.get(`kpi:${IDS.kpiDownloads}`)).toBe("App downloads");
  });

  it("hides comment buttons when commentMode is null", () => {
    const html = render({ bundle: makeBundle("draft"), commentMode: null, commentCounts: counts });
    expect(html).not.toContain("data-comment-target");
    expect(html).not.toContain("Comments, ");
  });
});
