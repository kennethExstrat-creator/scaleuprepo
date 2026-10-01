// Server-render tests of the composed company pages (react-dom/server, no browser): the home in each
// company state (reporting, up to date, starting later, not yet reporting, read-only with and without
// history) and the history page. ScaleUp people appear only as "<full name> (ScaleUp)" (BRD B28).
import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HomeData } from "@/app/portal/[companyId]/_components/home-model";
import { HomeView } from "@/app/portal/[companyId]/_components/home-view";
import { HistoryView } from "@/app/portal/[companyId]/history/_components/history-view";
import { buildHistoryRows } from "@/app/portal/[companyId]/history/_lib/history-model";
import type { CompanyRow, FinancialSeriesPoint, SubmissionOverviewRow } from "@/lib/types/domain";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const PARTNER = "a1000000-0000-4000-8000-000000000005";
const ts = "2026-09-30T06:00:00+00:00";

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

/** Visible text: tags removed, entities decoded, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: COMPANY,
    name: "Batik Boutique",
    legal_name: null,
    registration_no: null,
    sector: null,
    country: "Malaysia",
    website: null,
    description: null,
    reporting_currency: "MYR",
    status: "active",
    status_changed_at: null,
    status_reason: null,
    reporting_start_month: "2026-07-01",
    created_at: ts,
    updated_at: ts,
    ...overrides,
  };
}

function overview(month: string, overrides: Partial<SubmissionOverviewRow> = {}): SubmissionOverviewRow {
  return {
    id: `90000000-0000-4000-8000-0000000000${month.slice(5, 7)}`,
    company_id: COMPANY,
    month,
    status: "draft",
    due_date: "2026-10-15",
    original_due_date: null,
    submitted_at: null,
    approved_at: null,
    revision: 0,
    last_saved_at: null,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: false,
    open_threads: 0,
    ...overrides,
  };
}

function point(month: string, status: FinancialSeriesPoint["status"], revenue: number): FinancialSeriesPoint {
  return {
    month,
    submission_id: `90000000-0000-4000-8000-0000000000${month.slice(5, 7)}`,
    status,
    currency: "MYR",
    fx_rate_to_myr: 1,
    revenue_total: revenue,
    gross_profit: revenue / 2,
    net_profit: 5_000,
    cash_in_bank: 400_000,
    burn_rate: 20_000,
    headcount_ft: 9,
    headcount_pt: 2,
  };
}

const JULY = overview("2026-07-01", {
  status: "approved",
  submitted_at: "2026-08-10T02:00:00Z",
  approved_at: "2026-08-18T02:00:00Z",
  revision: 1,
});
// Sent back by a partner; its 14 days have passed (BRD B19), so it is overdue.
const AUGUST = overview("2026-08-01", {
  status: "changes_requested",
  due_date: "2026-09-28",
  original_due_date: "2026-09-15",
  submitted_at: "2026-09-10T02:00:00Z",
  revision: 1,
  last_saved_at: "2026-09-12T02:00:00Z",
  is_overdue: true,
  days_overdue: 3,
  open_threads: 2,
});
const SEPTEMBER = overview("2026-09-01");

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    company: company(),
    submissions: [SEPTEMBER, AUGUST, JULY],
    series: [point("2026-07-01", "approved", 100_000), point("2026-08-01", "changes_requested", 120_000)],
    changeEvents: [
      {
        id: 7,
        submission_id: AUGUST.id,
        event: "changes_requested",
        actor_id: PARTNER,
        message: "Please split revenue by outlet.",
        created_at: "2026-09-14T02:00:00Z",
      },
    ],
    staffNames: { [PARTNER]: "Renuka Sena (ScaleUp)" },
    closes: [
      {
        id: "q3",
        period_type: "quarter",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
        label: "Q3 2026",
        status: "open",
        confirmed_at: null,
      },
    ],
    managementAccounts: [],
    dueDay: 15,
    today: "2026-10-01",
    ...overrides,
  };
}

function home(data: HomeData, companyRole: ComponentProps<typeof HomeView>["companyRole"] = "owner") {
  const html = render(HomeView, { companyId: COMPANY, companyRole, data });
  return { html, visible: text(html) };
}

describe("HomeView", () => {
  it("a reporting company: the month to work on, missing numbers, changes requested, figures and the close", () => {
    const { html, visible } = home(homeData());
    expect(html).toContain(">Batik Boutique</h1>");
    expect(html).toContain(`href="/portal/${COMPANY}/updates"`);

    // Focus: the earliest month needing action, continued where it was left.
    expect(visible).toContain("Changes requested by ScaleUp August 2026 Overdue");
    expect(visible).toContain("Due date 28 Sep 2026 3 days overdue");
    expect(visible).toContain("After Aug 2026, Sep 2026 is still to submit");
    expect(visible).toContain("Continue update");
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-08"`);

    // Red list of overdue months and ScaleUp's request, signed by the person (BRD B28).
    expect(visible).toContain("Missing numbers");
    expect(visible).toContain("August 2026 Due 28 Sep 2026 · 3 days overdue");
    expect(visible).toContain("Please split revenue by outlet. Renuka Sena (ScaleUp) · 14 Sep 2026");
    expect(html).not.toContain(PARTNER);

    // The latest submitted figures skip the month sent back; threads; the open quarter close.
    expect(visible).toContain("Latest figures July 2026 Approved");
    expect(visible).toContain("Revenue RM 100,000");
    expect(visible).toContain("Open comment threads 2 open threads on your monthly updates");
    expect(visible).toContain("Q3 2026 · Jul–Sep 2026 Open");
    expect(visible).toContain("Monthly updates submitted (1 of 3)");
    expect(visible).toContain("Management accounts not uploaded yet");
    expect(visible).toContain("Totals confirmed by you");
    // One open close: the documents page opens on it (M8's ?close=).
    expect(html).toContain(`href="/portal/${COMPANY}/documents?close=q3"`);
  });

  it("speaks to contributors about the owner's part", () => {
    const { visible } = home(homeData(), "contributor");
    expect(visible).toContain("Your company owner submits the update once the numbers are complete.");
    expect(visible).toContain("Totals confirmed by your company owner");
  });

  it("up to date: the latest month's status and when the next month opens", () => {
    const september = overview("2026-09-01", { status: "submitted", submitted_at: "2026-09-30T02:00:00Z", revision: 1 });
    const august = { ...AUGUST, status: "approved" as const, is_overdue: false, days_overdue: 0, open_threads: 0 };
    const { visible } = home(homeData({ submissions: [september, august, JULY], changeEvents: [], staffNames: {} }));
    expect(visible).toContain("You're up to date");
    expect(visible).toContain("September 2026 is with ScaleUp for review (submitted 30 Sep 2026).");
    expect(visible).toContain("Next: October 2026 opens on 1 Nov 2026 and is due by 15 Nov 2026.");
    expect(visible).not.toContain("Missing numbers");
    expect(visible).not.toContain("Changes requested");
    expect(visible).toContain("No open comment threads.");
  });

  // The admin set July as the start month (July and August opened as drafts), then moved it to
  // September: those drafts stay, but they are not required (never overdue, BRD B16 / §2.6 rule 6).
  const JUL_DRAFT = overview("2026-07-01", { due_date: "2026-08-15" });
  const AUG_DRAFT = overview("2026-08-01", { due_date: "2026-09-15" });
  const moved = (overrides: Partial<HomeData> = {}) =>
    homeData({
      company: company({ reporting_start_month: "2026-09-01" }),
      submissions: [SEPTEMBER, AUG_DRAFT, JUL_DRAFT],
      series: [],
      changeEvents: [],
      staffNames: {},
      ...overrides,
    });

  it("start month moved later: works on the start month, not on the drafts left from before it", () => {
    const { html, visible } = home(moved());
    expect(visible).toContain("Your next monthly update September 2026");
    expect(visible).toContain("Due date 15 Oct 2026 Due in 14 days");
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-09"`);
    expect(visible).not.toContain("Your next monthly update July 2026");
    expect(visible).not.toContain("still to submit");
    expect(visible).not.toContain("Past its due date");
    expect(visible).toContain(
      "Earlier months aren't required Jul 2026 and Aug 2026 are before your reporting start month (September 2026), so you don't need to submit them.",
    );
  });

  it("start month moved later, start month submitted: up to date", () => {
    const septemberSent = overview("2026-09-01", { status: "submitted", submitted_at: "2026-09-30T02:00:00Z", revision: 1 });
    const { visible } = home(moved({ submissions: [septemberSent, AUG_DRAFT, JUL_DRAFT] }));
    expect(visible).toContain("You're up to date");
    expect(visible).toContain("September 2026 is with ScaleUp for review (submitted 30 Sep 2026).");
    expect(visible).toContain("Next: October 2026 opens on 1 Nov 2026 and is due by 15 Nov 2026.");
    expect(visible).not.toContain("Continue update");
    expect(visible).not.toContain("Start update");
    expect(visible).toContain("Earlier months aren't required");
  });

  it("start month moved past every open month: when reporting starts, never 'with ScaleUp for review' for a draft", () => {
    const { visible } = home(moved({ company: company({ reporting_start_month: "2026-11-01" }), closes: [] }));
    expect(visible).toContain("Reporting starts with November 2026");
    expect(visible).toContain("opens on 1 Dec 2026 and is due by 15 Dec 2026");
    expect(visible).not.toContain("You're up to date");
    expect(visible).not.toContain("for review");
    expect(visible).toContain("Jul 2026, Aug 2026 and Sep 2026 are before your reporting start month (November 2026)");
  });

  it("start month cleared: no update to work on, consistent with 'No new months are being requested'", () => {
    const { visible } = home(
      moved({ company: company({ reporting_start_month: null }), submissions: [SEPTEMBER, AUG_DRAFT, JULY] }),
    );
    expect(visible).toContain("No new months are being requested");
    expect(visible).not.toContain("Your next monthly update");
    expect(visible).not.toContain("Start update");
    // July was approved: that is the latest update; no next month is announced.
    expect(visible).toContain("You're up to date");
    expect(visible).toContain("July 2026 was approved on 18 Aug 2026.");
    expect(visible).not.toContain("Next:");
    expect(visible).not.toContain("aren't required");
  });

  it("first month opening late (open_due_periods failed): no due date that has already passed", () => {
    const { visible } = home(homeData({ submissions: [], series: [], changeEvents: [], staffNames: {}, closes: [] }));
    expect(visible).toContain("Reporting starts with July 2026");
    expect(visible).toContain("Your first monthly update (July 2026) opens shortly; you'll see its due date here once it opens.");
    expect(visible).not.toContain("15 Aug 2026");
  });

  it("a start month in the future: when reporting starts", () => {
    const { visible } = home(
      homeData({
        company: company({ reporting_start_month: "2026-11-01" }),
        submissions: [],
        series: [],
        changeEvents: [],
        staffNames: {},
        closes: [],
      }),
    );
    expect(visible).toContain("Reporting starts with November 2026");
    expect(visible).toContain("opens on 1 Dec 2026 and is due by 15 Dec 2026");
    expect(visible).toContain("Your figures appear here once your first monthly update is submitted.");
    expect(visible).not.toContain("All monthly updates");
  });

  it("not yet reporting (BRD B16): ScaleUp will let them know", () => {
    const { visible } = home(
      homeData({ company: company({ reporting_start_month: null }), submissions: [], series: [], changeEvents: [], staffNames: {}, closes: [] }),
    );
    expect(visible).toContain("Monthly reporting hasn't started yet");
    expect(visible).toContain("ScaleUp will let you know when monthly reporting starts.");
    expect(visible).not.toContain("Read-only");
    expect(visible).not.toContain("All monthly updates");
  });

  it("written off without history: read-only, and no promise that reporting will start", () => {
    const { visible } = home(
      homeData({
        company: company({ name: "StayHere", status: "written_off", reporting_start_month: null }),
        submissions: [],
        series: [],
        changeEvents: [],
        staffNames: {},
        closes: [],
      }),
    );
    expect(visible).toContain("Read-only: Written off StayHere is no longer an active portfolio company");
    expect(visible).toContain("No monthly updates on the platform");
    expect(visible).not.toContain("ScaleUp will let you know");
  });

  it("exited with history: read-only, nothing to do, the latest month and figures still shown", () => {
    const { visible } = home(
      homeData({ company: company({ status: "exited" }), submissions: [SEPTEMBER, { ...AUGUST, is_overdue: false }, JULY] }),
    );
    expect(visible).toContain("Read-only: Exited");
    expect(visible).toContain("Latest monthly update September 2026 Not submitted");
    expect(visible).not.toContain("Continue update");
    expect(visible).not.toContain("Start update");
    expect(visible).not.toContain("Missing numbers");
    expect(visible).not.toContain("Renuka Sena");
    expect(visible).toContain("2 open threads on your monthly updates You can still read these threads, but no longer reply.");
    expect(visible).toContain("Latest figures July 2026");
    // No open close or upcoming close for a company that no longer reports.
    expect(visible).not.toContain("Q3 2026 · Jul–Sep 2026 Open");
  });
});

describe("HistoryView", () => {
  const rows = buildHistoryRows(
    [SEPTEMBER, AUGUST, JULY],
    [point("2026-07-01", "approved", 100_000), point("2026-08-01", "changes_requested", 120_000)],
    "MYR",
  );

  it("lists every month, newest first, with links to the form and the owner's Excel download", () => {
    const html = render(HistoryView, { companyId: COMPANY, companyName: "Batik Boutique", rows, canDownload: true, notReporting: false });
    const visible = text(html);
    expect(visible).toContain("3 months from Jul 2026 to Sep 2026.");
    expect(visible).toContain("1 not submitted");
    expect(visible).toContain("1 overdue");
    const order = ["Sep 2026 Not submitted", "Aug 2026 Overdue", "Jul 2026 Approved"].map((row) => visible.indexOf(row));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(visible).toContain("Jul 2026 Approved 10 Aug 2026 18 Aug 2026 1 RM 100,000 RM 5,000 RM 400,000 View");
    expect(html).toContain(`href="/api/exports/c4/${COMPANY}"`);
    expect(visible).toContain("Download my data (Excel)");
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-07"`);
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-09"`);
  });

  it("offers the download to owners only (canExport)", () => {
    const html = render(HistoryView, { companyId: COMPANY, companyName: "Batik Boutique", rows, canDownload: false, notReporting: false });
    expect(html).not.toContain("/api/exports/c4/");
  });

  it("explains an empty history", () => {
    const empty = (props: Partial<ComponentProps<typeof HistoryView>>) =>
      text(render(HistoryView, { companyId: COMPANY, companyName: "Batik Boutique", rows: [], canDownload: true, notReporting: false, ...props }));
    expect(empty({})).toContain("No monthly updates yet");
    expect(empty({ notReporting: true })).toContain("ScaleUp will let you know when monthly reporting starts.");
    const readOnly = empty({ notReporting: true, readOnly: true });
    expect(readOnly).toContain("No monthly updates on the platform");
    expect(readOnly).not.toContain("ScaleUp will let you know");
    expect(empty({})).not.toContain("Download my data");
  });
});
