// Server-render smoke tests of the M4 screens: every tab of the cycles workspace, its empty states and the
// settings form render to HTML with realistic data (runtime rendering errors and missing content are caught),
// and the permission variants offer only what each role may do.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/admin/cycles/actions", () => ({
  openMonthEarlyAction: vi.fn(async () => ({ ok: true, data: { month: "2026-10" } })),
  extendDeadlineAction: vi.fn(async () => ({ ok: true, data: {} })),
  createFxRateAction: vi.fn(async () => ({ ok: true, data: {} })),
  updateFxRateAction: vi.fn(async () => ({ ok: true, data: {} })),
  deleteFxRateAction: vi.fn(async () => ({ ok: true, data: {} })),
  updateCycleSettingsAction: vi.fn(async () => ({ ok: true, data: { updatedAt: "2026-10-01T00:00:00Z" } })),
}));
vi.mock("@/app/admin/settings/actions", () => ({
  updateSettingsAction: vi.fn(async () => ({ ok: true, data: { changed: true } })),
}));

import { CyclesWorkspace } from "@/app/admin/cycles/_components/cycles-workspace";
import { monthGroups } from "@/app/admin/cycles/_components/month-select";
import { progressText } from "@/app/admin/cycles/_components/months-table";
import {
  buildCycleMonths,
  buildDeadlineChoices,
  buildExtensions,
  buildFxCurrencies,
  groupCloses,
  openEarlyPreview,
  summariseOverdue,
  upcomingCloses,
  type CycleTab,
  type CyclesData,
} from "@/app/admin/cycles/_lib/cycles-model";
import { SettingsForm } from "@/app/admin/settings/_components/settings-form";
import { settingsFromRow } from "@/app/admin/settings/_lib/settings-model";

import {
  CLOSES,
  COMPANIES,
  EXTENSION_EVENTS,
  EXTENSION_ROWS,
  NAMES,
  OVERVIEW,
  PERIODS,
  RATES,
  SEND_BACK_EVENTS,
  SETTINGS,
} from "./fixtures";

const months = buildCycleMonths(PERIODS, OVERVIEW, NAMES);
const openMonths = months.map((month) => month.month);

const DATA: CyclesData = {
  today: "2026-10-01",
  currentMonth: "2026-10",
  dueDay: 15,
  graceDays: 14,
  escalationDays: 14,
  months,
  overdue: summariseOverdue(OVERVIEW, 14),
  openEarly: openEarlyPreview("2026-10", openMonths, 15, COMPANIES),
  currentTemplateLabel: "Portfolio Update v2",
  extensions: buildExtensions({
    rows: EXTENSION_ROWS,
    events: [...EXTENSION_EVENTS, ...SEND_BACK_EVENTS],
    companies: COMPANIES,
    overdueById: new Map(OVERVIEW.map((row) => [row.id, row.is_overdue] as const)),
    names: NAMES,
    graceDays: 14,
  }),
  deadlineChoices: buildDeadlineChoices(OVERVIEW, COMPANIES),
  closes: groupCloses(CLOSES),
  upcoming: upcomingCloses(openMonths[0], "2026-10", 15, COMPANIES),
  fx: buildFxCurrencies({ companies: COMPANIES, rates: RATES, overview: OVERVIEW, openMonths, names: NAMES }),
  fxCurrencies: ["USD"],
  fxRange: { from: "2024-01", to: "2026-10" },
  reportingCompanies: 4,
};

const ALL_RIGHTS = { canOpenMonths: true, canExtend: true, canManageFx: true, canEditSettings: true, canViewAudit: true };

function renderCycles(tab: CycleTab, data: CyclesData = DATA, rights: Partial<typeof ALL_RIGHTS> = {}) {
  return renderToStaticMarkup(
    createElement(CyclesWorkspace, {
      data,
      openError: null,
      initialTab: tab,
      initialExtendId: null,
      ...ALL_RIGHTS,
      ...rights,
    }),
  );
}

describe("cycles workspace", () => {
  it("renders the header, summary and months", () => {
    const html = renderCycles("months");
    expect(html).toContain("Reporting cycles");
    expect(html).toContain("due on the 15th of that month");
    expect(html).toContain("Change cycle settings");
    expect(html).toContain("All settings");
    expect(html).toContain("Open Oct 2026 early");
    expect(html).toContain("Extend a deadline");
    expect(html).toContain("September 2026");
    expect(html).toContain("Kenneth Lim");
    expect(html).toContain("Early");
    expect(html).toContain("Portfolio Update v2");
    expect(html).toContain("Since replaced");
    expect(html).toContain("Q4 2026 · H2 2026");
    // Overdue tile: 3 overdue at 3 companies, 2 escalated.
    expect(html).toContain("2 escalated (over 14 days)");
    // The latest month's usual due date, and July's company due later.
    expect(html).toContain("Due 15 Oct 2026 · 0 of 4 companies submitted");
    expect(html).toContain("1 due 29 Aug 2026 (extended or sent back)");
  });

  it("quotes the date every company is due when a month opened late", () => {
    const late = OVERVIEW.filter((row) => row.month === "2026-09-01").map((row) => ({ ...row, due_date: "2026-10-29" }));
    const lateMonths = buildCycleMonths(PERIODS, [...OVERVIEW.filter((row) => row.month !== "2026-09-01"), ...late], NAMES);
    const html = renderCycles("months", { ...DATA, months: lateMonths });
    expect(html).toContain("All 4 due 29 Oct 2026 (opened late)");
    expect(html).toContain("Due 29 Oct 2026 · 0 of 4 companies submitted");
  });

  it("renders the deadlines", () => {
    const html = renderCycles("deadlines");
    expect(html).toContain("3 months with a later due date than usual");
    expect(html).toContain("Auditors finalising the accounts.");
    expect(html).toContain("Moved when the month was sent back for changes, to give time to resubmit.");
    expect(html).toContain("Kenneth Lim, 15 Sep 2026, 11:00");
    expect(html).toContain("Sent back");
    expect(html).toContain("extended 2 times");
    expect(html).toContain("Extend again");
    expect(html).toContain("Written off");
    expect(html).toContain("/admin/audit?action=extend_due_date");
    // RECQA (sent back) and Kiddocare (extended) can be extended; StayHere (written off) cannot.
    expect(html.match(/aria-label="Extend the deadline for /g)).toHaveLength(2);
    expect(html).not.toContain("Extend the deadline for StayHere");
  });

  it("explains a send-back after an extension, and offers Extend only where the dialog does", () => {
    const [kiddo, recqa] = [DATA.extensions[1], DATA.extensions[0]];
    const extensions = [
      {
        ...kiddo,
        cause: "sent_back" as const,
        dueDate: "2026-11-08",
        sentBack: { kind: "reopened" as const, at: "2026-10-25T02:00:00Z", by: "Aisha Rahman" },
      },
      // Active but no longer reporting: listed, without Extend.
      { ...recqa, canExtendAgain: false, extendBlock: "not_reporting" as const, reportingStartMonth: null },
    ];
    const html = renderCycles("deadlines", { ...DATA, extensions });
    expect(html).toContain("Moved again when the month was reopened after approval, to give time to resubmit.");
    expect(html).toContain("Aisha Rahman, 25 Oct 2026, 10:00");
    expect(html).toContain(
      "Extended earlier to 29 Aug 2026 by Kenneth Lim on 20 Aug 2026 (2 extensions): Auditors finalising the accounts.",
    );
    expect(html).toContain("Reopened");
    expect(html).toContain("Not reporting");
    expect(html).toContain("Extend the deadline for Kiddocare, July 2026");
    expect(html).not.toContain("Extend the deadline for RECQA");
  });

  it("renders the closes with links to Documents", () => {
    const html = renderCycles("closes");
    expect(html).toContain("Coming up");
    expect(html).toContain("Q4 2026");
    expect(html).toContain("1 Jan 2027");
    expect(html).toContain("/admin/documents?period=Q3-2026");
  });

  it("renders the FX rates with the missing month highlighted", () => {
    const html = renderCycles("fx");
    expect(html).toContain("No USD rate for Aug 2026");
    expect(html).toContain("Missing");
    expect(html).toContain("4.75");
    expect(html).toContain("+13.1% vs Jul 2026");
    expect(html).toContain("Add rate");
    expect(html).toContain("No company reports in this currency any more");
    expect(html).toContain("i-Motorbike (not yet reporting)");
    expect(html).toContain("No rate");
    expect(html).toContain("/admin/audit?entity=fx_rates");
  });

  it("offers nothing a role cannot do", () => {
    const html = renderCycles("fx", DATA, {
      canOpenMonths: false,
      canExtend: false,
      canManageFx: false,
      canEditSettings: false,
      canViewAudit: false,
    });
    expect(html).not.toContain("Open Oct 2026 early");
    expect(html).not.toContain("Extend a deadline");
    expect(html).not.toContain("Add rate");
    expect(html).not.toContain("Change cycle settings");
    expect(html).not.toContain("All settings");
    expect(html).not.toContain("Edit the USD rate");
    expect(html).not.toContain("Change history");
  });

  it("shows empty states", () => {
    const empty: CyclesData = {
      ...DATA,
      months: [],
      openEarly: null,
      extensions: [],
      deadlineChoices: [],
      closes: [],
      fx: [],
      fxCurrencies: [],
    };
    expect(renderCycles("months", empty)).toContain("No reporting months yet");
    expect(renderCycles("deadlines", empty)).toContain("No deadlines have moved");
    expect(renderCycles("closes", empty)).toContain("No closes yet");
    expect(renderCycles("fx", empty)).toContain("Every company reports in MYR");
  });

  it("explains a failure to open months", () => {
    const html = renderToStaticMarkup(
      createElement(CyclesWorkspace, {
        data: DATA,
        openError: "Publish the default reporting template before opening reporting months.",
        initialTab: "months",
        initialExtendId: null,
        ...ALL_RIGHTS,
      }),
    );
    expect(html).toContain("New months could not be opened");
    expect(html).toContain("Publish the default reporting template");
  });
});

describe("cycle helpers used by the components", () => {
  it("describes a month's progress", () => {
    expect(progressText(months[1].progress)).toBe("1 awaiting review, 3 overdue");
    expect(progressText({ ...months[1].progress, total: 0 })).toBe("No companies report this month.");
  });

  it("groups months by year, newest first, keeping the current value", () => {
    expect(monthGroups("2025-11", "2026-02")).toEqual([
      { year: "2026", months: ["2026-02", "2026-01"] },
      { year: "2025", months: ["2025-12", "2025-11"] },
    ]);
    expect(monthGroups("2026-01", "2026-02", "2023-05").at(-1)).toEqual({ year: "2023", months: ["2023-05"] });
  });
});

describe("settings form", () => {
  it("renders every setting with its default", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        initial: settingsFromRow(SETTINGS),
        updatedAt: SETTINGS.updated_at,
        currentMonth: "2026-10",
      }),
    );
    for (const text of [
      "Reporting cycle",
      "Due day",
      "of the following month",
      "Grace period for late-opened months",
      "Escalate overdue months after",
      "Earliest reporting month",
      "July 2026",
      "Review flags",
      "Revenue swing flag",
      "Minimum runway",
      "Maximum contributors a company owner can invite",
      "ScaleUp can always add more",
      "Submission declaration",
      "Require two-factor authentication",
      "Terms of use version",
      "Version in force: 2026-09.",
      "Default: 15th of the following month.",
      "Default: 4 contributors.",
      "No unsaved changes",
      "Review and save",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Two-factor authentication is off");
  });

  it("warns while two-factor authentication is off", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        initial: { ...settingsFromRow(SETTINGS), requireMfa: false },
        updatedAt: SETTINGS.updated_at,
        currentMonth: "2026-10",
      }),
    );
    expect(html).toContain("Two-factor authentication is off");
    expect(html).toContain("Use the default");
  });
});
