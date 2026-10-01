// Server-render smoke tests of the M7 UI with fixture data (react-dom/server, no browser): the
// components render without errors, show the right wording and links, and name ScaleUp people on the
// company side only as "<full name> (ScaleUp)" (BRD B28).
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrackerWorkspace } from "@/app/admin/tracker/_components/tracker-workspace";
import { FocusCard, ReadOnlyLatestCard, StartsLaterCard, UpToDateCard } from "@/app/portal/[companyId]/_components/focus-card";
import { EarlierMonthsNotice, NotReportingState, ReadOnlyNotice } from "@/app/portal/[companyId]/_components/home-notices";
import { latestFigures, summariseCloses, type HomeSubmission } from "@/app/portal/[companyId]/_components/home-model";
import { LatestFiguresCard } from "@/app/portal/[companyId]/_components/latest-figures-card";
import { PeriodCloseCard } from "@/app/portal/[companyId]/_components/period-close-card";
import { ChangesRequestedCard, CommentsCard, MissingNumbersCard } from "@/app/portal/[companyId]/_components/requests-cards";
import { halfOf, quarterOf } from "@/lib/periods";
import type { FinancialSeriesPoint } from "@/lib/types/domain";

import { IDS, SUBMISSIONS, company, data, filters, submission } from "./fixtures";

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

describe("TrackerWorkspace", () => {
  it("renders the summary, the grid, the legend and the not-yet-reporting group", () => {
    const html = render(TrackerWorkspace, { data: data(), initialFilters: filters(), canSetStartMonth: true });
    const visible = text(html);
    expect(visible).toContain("August 2026 · latest open month · due 15 Sep 2026 · 3 companies");
    expect(visible).toContain("Narrative coverage 50% 1 of 2 updates received");
    expect(visible).toContain("1 of 1 within 20 days of month end");
    expect(visible).toContain("Companies by month · 3 reporting companies");
    expect(visible).toContain("Across these 6 months: 2 overdue ( 1 escalated ) · 1 awaiting review");
    for (const name of ["Batik Boutique", "Kiddocare", "RECQA"]) expect(visible).toContain(name);
    expect(visible).toContain("Overdue · 3d");
    expect(visible).toContain("Escalated · 15d");
    expect(visible).toContain("Partner-in-charge: Renuka Sena");
    expect(visible).toContain("Not yet reporting (2)");
    expect(visible).toContain("Outside the reporting range");
    expect(visible).toContain("Not submitted dimmed: no longer requested");
    // Cells open the review page; company names open the company page.
    expect(html).toContain(`href="/admin/review/${SUBMISSIONS[1].id}"`);
    expect(html).toContain('aria-label="RECQA, August 2026: Escalated, 15 days overdue"');
    expect(html).toContain('title="Not submitted, 15 days overdue (escalated). Due 15 Sep 2026. No narrative."');
    expect(html).toContain('href="/admin/companies/c0000000-0000-4000-8000-000000000001"');
    // Accessible: a labelled scroll region, a caption and row / column headers.
    expect(html).toMatch(/role="region"[^>]*aria-labelledby="tracker-grid-caption"/);
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
  });

  it("applies the initial filters from the URL", () => {
    const html = render(TrackerWorkspace, {
      data: data(),
      initialFilters: filters({ status: "overdue" }),
      canSetStartMonth: false,
    });
    const visible = text(html);
    expect(visible).toContain("1 of 3 reporting companies");
    expect(visible).toContain("RECQA");
    expect(visible).not.toContain("Kiddocare");
    expect(visible).not.toContain("Not yet reporting (");
    expect(visible).toContain("Clear filters");
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Overdue/);
  });

  it("dims a draft left from before a start month that was moved later, and says why", () => {
    const moved = company({ id: IDS.recqa, name: "RECQA", startMonth: "2026-09" });
    const html = render(TrackerWorkspace, {
      data: data({ companies: [moved], submissions: [submission(IDS.recqa, "2026-08")] }),
      initialFilters: filters(),
      canSetStartMonth: true,
    });
    const cell = html.match(/<a [^>]*aria-label="RECQA, August 2026: Not submitted"[^>]*>/)?.[0] ?? "";
    expect(cell).toContain('title="Not submitted. Not requested: before the reporting start month (Sep 2026). Due 15 Sep 2026. No narrative."');
    expect(cell).toContain("opacity-60");
    // Not chased: the latest month has no company to count.
    expect(text(html)).toContain("August 2026 · latest open month · due 15 Sep 2026 · 0 companies");
  });

  it("explains empty states", () => {
    expect(text(render(TrackerWorkspace, { data: data({ months: [], submissions: [] }), initialFilters: filters(), canSetStartMonth: true }))).toContain(
      "No months are open yet",
    );
    expect(text(render(TrackerWorkspace, { data: data(), initialFilters: filters({ search: "zzz" }), canSetStartMonth: true }))).toContain(
      "No companies match these filters",
    );
    const notReporting = data({ companies: data().companies.filter((c) => c.startMonth === null), submissions: [] });
    expect(text(render(TrackerWorkspace, { data: notReporting, initialFilters: filters(), canSetStartMonth: true }))).toContain(
      "No company is reporting yet",
    );
  });
});

const COMPANY = "c0000000-0000-4000-8000-000000000001";

function month(monthDate: string, overrides: Partial<HomeSubmission> = {}): HomeSubmission {
  return {
    id: `s-${monthDate}`,
    month: monthDate,
    status: "draft",
    due_date: "2026-08-15",
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

describe("company home cards", () => {
  const july = month("2026-07-01", { is_overdue: true, days_overdue: 46 });
  const august = month("2026-08-01", { status: "changes_requested", due_date: "2026-10-05", revision: 1, submitted_at: "2026-09-12T02:00:00Z", last_saved_at: "2026-09-29T06:05:00Z", open_threads: 2 });

  it("focus card: the month to work on, its due date and the next step", () => {
    const owner = text(render(FocusCard, { companyId: COMPANY, focus: july, later: [august], companyRole: "owner", today: "2026-09-30" }));
    expect(owner).toContain("Your next monthly update July 2026");
    expect(owner).toContain("Overdue");
    expect(owner).toContain("15 Aug 2026 46 days overdue");
    expect(owner).toContain("Not started yet");
    expect(owner).toContain("Last submitted Not submitted yet");
    expect(owner).toContain("After Jul 2026, Aug 2026 is still to submit");
    expect(owner).toContain("Start update");

    const html = render(FocusCard, { companyId: COMPANY, focus: august, later: [], companyRole: "contributor", today: "2026-09-30" });
    const contributor = text(html);
    expect(contributor).toContain("Changes requested by ScaleUp");
    expect(contributor).toContain("29 Sep 2026, 14:05");
    expect(contributor).toContain("Last submitted 12 Sep 2026");
    expect(contributor).toContain("Your company owner submits the update");
    expect(contributor).toContain("Continue update");
    expect(html).toContain(`href="/portal/${COMPANY}/updates/2026-08"`);
  });

  it("up to date, starts later and read-only cards", () => {
    const upToDate = text(
      render(UpToDateCard, {
        companyId: COMPANY,
        latest: month("2026-08-01", { status: "submitted", submitted_at: "2026-09-12T02:00:00Z" }),
        next: { month: "2026-09", opensOn: "2026-10-01", dueOn: "2026-10-15", alreadyDue: false },
      }),
    );
    expect(upToDate).toContain("You're up to date");
    expect(upToDate).toContain("August 2026 is with ScaleUp for review (submitted 12 Sep 2026).");
    expect(upToDate).toContain("Next: September 2026 opens on 1 Oct 2026 and is due by 15 Oct 2026.");

    // Should already be open, usual due date still ahead: that date stands.
    const opensShortly = text(
      render(UpToDateCard, {
        companyId: COMPANY,
        latest: month("2026-08-01", { status: "approved", approved_at: "2026-09-18T02:00:00Z" }),
        next: { month: "2026-09", opensOn: "2026-10-01", dueOn: "2026-10-15", alreadyDue: true },
      }),
    );
    expect(opensShortly).toContain("August 2026 was approved on 18 Sep 2026.");
    expect(opensShortly).toContain("Next: September 2026 opens shortly and is due by 15 Oct 2026.");

    const later = text(render(StartsLaterCard, { next: { month: "2026-10", opensOn: "2026-11-01", dueOn: "2026-11-15", alreadyDue: false } }));
    expect(later).toContain("Reporting starts with October 2026");
    expect(later).toContain("Your first monthly update (October 2026) opens on 1 Nov 2026 and is due by 15 Nov 2026.");
    // Opening late (open_due_periods failed): never a due date that has already passed (BRD B4).
    const late = text(render(StartsLaterCard, { next: { month: "2026-07", opensOn: "2026-08-01", dueOn: null, alreadyDue: true } }));
    expect(late).toContain("Your first monthly update (July 2026) opens shortly; you'll see its due date here once it opens.");
    expect(late).not.toContain("due by");

    const readOnly = text(
      render(ReadOnlyLatestCard, { companyId: COMPANY, latest: month("2026-06-01", { status: "approved", approved_at: "2026-07-18T02:00:00Z", submitted_at: "2026-07-10T02:00:00Z" }) }),
    );
    expect(readOnly).toContain("Approved 18 Jul 2026.");
    expect(text(render(ReadOnlyNotice, { companyName: "StayHere", status: "written_off" }))).toContain(
      "Read-only: Written off StayHere is no longer an active portfolio company",
    );
    expect(text(render(NotReportingState, {}))).toContain("ScaleUp will let you know when monthly reporting starts.");
  });

  it("earlier months notice: drafts left from before the start month are not required", () => {
    const two = text(
      render(EarlierMonthsNotice, { months: [month("2026-07-01"), month("2026-08-01")], startMonth: "2026-09-01" }),
    );
    expect(two).toContain("Earlier months aren't required");
    expect(two).toContain(
      "Jul 2026 and Aug 2026 are before your reporting start month (September 2026), so you don't need to submit them. You can still find them under All monthly updates.",
    );
    const one = text(render(EarlierMonthsNotice, { months: [month("2026-08-01")], startMonth: "2026-09" }));
    expect(one).toContain("An earlier month isn't required Aug 2026 is before your reporting start month (September 2026)");
    expect(one).toContain("you don't need to submit it.");
    expect(render(EarlierMonthsNotice, { months: [], startMonth: "2026-09-01" })).toBe("");
  });

  it("missing numbers, changes requested (by '<name> (ScaleUp)') and comments", () => {
    const missing = text(render(MissingNumbersCard, { companyId: COMPANY, months: [july] }));
    expect(missing).toContain("Missing numbers");
    expect(missing).toContain("July 2026 Due 15 Aug 2026 · 46 days overdue");
    expect(render(MissingNumbersCard, { companyId: COMPANY, months: [] })).toBe("");

    const changesHtml = render(ChangesRequestedCard, {
      companyId: COMPANY,
      requests: [
        {
          submission: august,
          message: "Please split revenue by outlet.",
          author: "Renuka Sena (ScaleUp)",
          requestedAt: "2026-09-20T02:00:00Z",
          kind: "changes_requested",
        },
        {
          submission: month("2026-06-01", { status: "changes_requested", due_date: "2026-10-12" }),
          message: null,
          author: "ScaleUp",
          requestedAt: null,
          kind: "reopened",
        },
      ],
    });
    const changes = text(changesHtml);
    expect(changes).toContain("Resubmit by 5 Oct 2026");
    expect(changes).toContain("Please split revenue by outlet.");
    // BRD B28: the person's name with the "(ScaleUp)" label; plain "ScaleUp" when nobody can be named.
    expect(changes).toContain("Renuka Sena (ScaleUp) · 20 Sep 2026");
    expect(changes).toContain("No message was added. ScaleUp · approved month reopened");
    expect(changesHtml).toContain('<time dateTime="2026-09-20T02:00:00Z" title="20 Sep 2026, 10:00">');
    expect(changesHtml).toContain(`href="/portal/${COMPANY}/updates/2026-06"`);

    // Neutral: a shared thread may be the owner's own amendment request, not ScaleUp's.
    const comments = text(render(CommentsCard, { companyId: COMPANY, total: 2, months: [august] }));
    expect(comments).toContain("Open comment threads 2 open threads on your monthly updates");
    expect(comments).toContain("Aug 2026 2 open threads");
    expect(comments).not.toContain("from ScaleUp");
    expect(comments).not.toContain("no longer reply");
    expect(text(render(CommentsCard, { companyId: COMPANY, total: 1, months: [august], readOnly: true }))).toContain(
      "1 open thread on your monthly updates You can still read these threads, but no longer reply.",
    );
    expect(text(render(CommentsCard, { companyId: COMPANY, total: 0, months: [] }))).toContain("No open comment threads.");
  });

  it("latest figures in the company's currency", () => {
    const point = (monthDate: string, overrides: Partial<FinancialSeriesPoint> = {}): FinancialSeriesPoint => ({
      month: monthDate,
      submission_id: `s-${monthDate}`,
      status: "approved",
      currency: "MYR",
      fx_rate_to_myr: 1,
      revenue_total: 100_000,
      gross_profit: 40_000,
      net_profit: -10_000,
      cash_in_bank: 600_000,
      burn_rate: 50_000,
      headcount_ft: 12,
      headcount_pt: 3,
      ...overrides,
    });
    const myr = text(render(LatestFiguresCard, { companyId: COMPANY, figures: latestFigures([point("2026-06-01", { revenue_total: 80_000 }), point("2026-07-01")]) }));
    expect(myr).toContain("July 2026");
    expect(myr).toContain("Revenue RM 100,000 +25.0% vs Jun 2026");
    expect(myr).toContain("Gross margin 40.0% Gross profit RM 40,000");
    expect(myr).toContain("Net margin -10.0% Net profit -RM 10,000");
    expect(myr).toContain("Cash in bank RM 600,000 Burn RM 50,000 a month");
    expect(myr).toContain("Runway 12.0 months");
    expect(myr).toContain("Headcount 15 12 full-time · 3 part-time");

    const usd = text(render(LatestFiguresCard, { companyId: COMPANY, figures: latestFigures([point("2026-07-01", { currency: "USD", burn_rate: 0 })]) }));
    expect(usd).toContain("in USD");
    expect(usd).toContain("USD 100,000");
    expect(usd).toContain("Cash-flow positive");
    expect(text(render(LatestFiguresCard, { companyId: COMPANY, figures: null }))).toContain(
      "Your figures appear here once your first monthly update is submitted.",
    );
  });

  it("period close: what the open close still needs, or the next one", () => {
    const { open, lastConfirmed } = summariseCloses({
      closes: [
        { id: "q3", period_type: "quarter", period_start: "2026-07-01", period_end: "2026-09-30", label: "Q3 2026", status: "open", confirmed_at: null },
        { id: "q2", period_type: "quarter", period_start: "2026-04-01", period_end: "2026-06-30", label: "Q2 2026", status: "confirmed", confirmed_at: "2026-07-20T02:00:00Z" },
      ],
      documents: [{ id: "d2", period_close_id: "q3", version: 2, uploaded_at: "2026-10-05T02:00:00Z" }],
      submissions: [month("2026-07-01", { status: "approved" }), month("2026-08-01", { status: "submitted" }), month("2026-09-01")],
      startMonth: "2026-04-01",
    });
    const html = render(PeriodCloseCard, { companyId: COMPANY, open, upcoming: [], lastConfirmed, companyRole: "owner" });
    const visible = text(html);
    expect(visible).toContain("Q3 2026 · Jul–Sep 2026 Open");
    expect(visible).toContain("Monthly updates submitted (2 of 3)");
    expect(visible).toContain("Management accounts uploaded (version 2, 5 Oct 2026)");
    expect(visible).toContain("To do: Totals confirmed by you");
    expect(visible).toContain("Q2 2026 was confirmed on 20 Jul 2026.");
    expect(html).toContain(`href="/portal/${COMPANY}/documents?close=q3"`);

    const upcoming = text(render(PeriodCloseCard, { companyId: COMPANY, open: [], upcoming: [quarterOf("2026-09")], lastConfirmed: null, companyRole: "contributor" }));
    expect(upcoming).toContain("Next close: Q3 2026 (Jul–Sep 2026) . Once September 2026 opens on 1 Oct 2026");
    const both = text(
      render(PeriodCloseCard, { companyId: COMPANY, open: [], upcoming: [quarterOf("2026-12"), halfOf("2026-12")], lastConfirmed: null, companyRole: "owner" }),
    );
    expect(both).toContain("Q4 2026 (Oct–Dec 2026) and H2 2026 (Jul–Dec 2026)");
    expect(render(PeriodCloseCard, { companyId: COMPANY, open: [], upcoming: [], lastConfirmed: null, companyRole: "owner" })).toBe("");
  });
});
