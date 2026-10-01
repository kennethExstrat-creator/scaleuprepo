// Server-render smoke tests of the M4 dialogs. The shadcn Dialog renders through a portal (nothing on the
// server), so it is replaced here by plain elements: the dialog bodies (extension and FX rate forms) then
// render to HTML with realistic data.
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/admin/cycles/actions", () => ({
  openMonthEarlyAction: vi.fn(),
  extendDeadlineAction: vi.fn(),
  createFxRateAction: vi.fn(),
  updateFxRateAction: vi.fn(),
  deleteFxRateAction: vi.fn(),
}));
vi.mock("@/app/admin/settings/actions", () => ({ updateSettingsAction: vi.fn() }));
vi.mock("@/components/ui/dialog", () => {
  type Props = { children?: ReactNode; className?: string };
  const element = (tag: string) =>
    function Inline({ children, className }: Props) {
      return createElement(tag, { className }, children);
    };
  return {
    Dialog: ({ open, children }: Props & { open: boolean }) => (open ? createElement(Fragment, null, children) : null),
    DialogContent: element("div"),
    DialogHeader: element("div"),
    DialogFooter: element("div"),
    DialogTitle: element("h2"),
    DialogDescription: element("p"),
    DialogClose: ({ children }: Props) => createElement(Fragment, null, children),
  };
});

import { ExtendDeadlineDialog } from "@/app/admin/cycles/_components/extend-deadline-dialog";
import { FxRateDialog, rateInputText, type FxDialogTarget } from "@/app/admin/cycles/_components/fx-rate-dialog";
import { buildDeadlineChoices, buildFxCurrencies } from "@/app/admin/cycles/_lib/cycles-model";

import { ACME, BATIK, COMPANIES, KIDDO, NAMES, OVERVIEW, RATES, TODAY, overviewId } from "./fixtures";

const choices = buildDeadlineChoices(OVERVIEW, COMPANIES);
const groups = buildFxCurrencies({
  companies: COMPANIES,
  rates: RATES,
  overview: OVERVIEW,
  openMonths: ["2026-09", "2026-08", "2026-07"],
  names: NAMES,
});

function renderExtend(initial: { companyId: string; submissionId: string; label?: string } | null, list = choices) {
  return renderToStaticMarkup(
    createElement(ExtendDeadlineDialog, { open: true, onOpenChange: () => {}, choices: list, today: TODAY, initial }),
  );
}

function renderFx(target: FxDialogTarget) {
  return renderToStaticMarkup(
    createElement(FxRateDialog, {
      open: true,
      onOpenChange: () => {},
      target,
      currencies: ["USD"],
      groups,
      range: { from: "2024-01", to: "2026-10" },
    }),
  );
}

describe("ExtendDeadlineDialog", () => {
  it("opens on an overdue month with quick choices counted from today", () => {
    const html = renderExtend({ companyId: KIDDO, submissionId: overviewId(KIDDO, "2026-08-01") });
    expect(html).toContain("Extend a deadline");
    expect(html).toContain("September 2026");
    expect(html).toContain("August 2026");
    expect(html).toContain("July 2026");
    expect(html).toContain("16 days overdue");
    expect(html).toContain("originally 15 Aug 2026");
    expect(html).toContain("In 7 days");
    expect(html).toContain("Currently due 15 Sep 2026, which has passed");
    expect(html).toContain("Reason");
    expect(html).toContain("0 / 2,000");
    expect(html).toContain("Shown on the month&#x27;s timeline, also to the company.");
  });

  it("counts from the due date when the month is not overdue yet", () => {
    const html = renderExtend({ companyId: BATIK, submissionId: overviewId(BATIK, "2026-09-01") });
    expect(html).toContain("+7 days");
    expect(html).toContain("Currently due 15 Oct 2026. Choose a later date, up to 15 Oct 2027.");
  });

  it("asks for a company first, and explains when nothing can be extended", () => {
    const html = renderExtend(null);
    expect(html).toContain("Company");
    expect(html).not.toContain("New due date");
    expect(renderExtend(null, [])).toContain("No reporting company has a month that can be extended");
  });

  it("opens on nothing, with a note, when the target month is not offered", () => {
    // A company the dialog does not offer (e.g. no longer reporting), with one other company to choose from:
    // that company and its month must not be preselected.
    const acmeOnly = choices.filter((choice) => choice.companyId === ACME);
    const single = [{ ...acmeOnly[0], months: acmeOnly[0].months.slice(0, 1) }];
    const html = renderExtend(
      { companyId: "c0000000-0000-4000-8000-0000000000a1", submissionId: "alpha-aug", label: "Alpha, August 2026" },
      single,
    );
    expect(html).toContain("Alpha, August 2026 can no longer be extended here");
    expect(html).toContain("Choose a company and month below");
    expect(html).not.toContain("September 2026");
    expect(html).not.toContain("New due date");
    // Without the target, the single choice is preselected as before.
    expect(renderExtend(null, single)).toContain("New due date");

    // The company is offered but not that month: none of its other months is preselected.
    const kiddo = renderExtend({ companyId: KIDDO, submissionId: "approved-meanwhile" });
    expect(kiddo).toContain("That month can no longer be extended here");
    expect(kiddo).not.toContain("New due date");

    const none = renderExtend({ companyId: KIDDO, submissionId: "approved-meanwhile" }, []);
    expect(none).toContain("That month can no longer be extended here");
    expect(none).not.toContain("Choose a company and month below");
    expect(none).toContain("No reporting company has a month that can be extended");
  });
});

describe("FxRateDialog", () => {
  it("adds a rate with the previous month's rate to hand", () => {
    const html = renderFx({ mode: "create", currency: "USD", month: "2026-10" });
    expect(html).toContain("Add an FX rate");
    expect(html).toContain("1 USD =");
    expect(html).toContain("MYR");
    expect(html).toContain("Sep 2026: 4.75.");
    expect(html).toContain("Use this rate");
    expect(html).toContain("Add rate");
  });

  it("points at an existing rate instead of adding a second one", () => {
    const html = renderFx({ mode: "create", currency: "USD", month: "2026-09" });
    expect(html).toContain("USD already has a rate for September 2026 (4.75)");
  });

  it("edits a rate and shows the change from the previous one", () => {
    const html = renderFx({ mode: "edit", currency: "USD", month: "2026-09", rate: 4.75 });
    expect(html).toContain("Edit the USD rate for September 2026");
    expect(html).toContain('value="4.75"');
    expect(html).toContain("Jul 2026: 4.2.");
    expect(html).toContain("Change: +13.1%.");
    expect(html).toContain("That is a change of more than 10% from Jul 2026");
    expect(html).toContain("Save rate");
  });

  it("writes rates back into the box without trailing zeros", () => {
    expect(rateInputText(4.215)).toBe("4.215");
    expect(rateInputText(0.00028123)).toBe("0.00028123");
    expect(rateInputText(1234.5)).toBe("1,234.5");
    expect(rateInputText(null)).toBe("");
  });
});

describe("SettingsReviewDialog", () => {
  it("lists each change with its effect and asks to acknowledge turning 2FA off", async () => {
    const { SettingsReviewDialog } = await import("@/app/admin/settings/_components/settings-form");
    const { describeSettingsChanges, settingsFromRow } = await import("@/app/admin/settings/_lib/settings-model");
    const { SETTINGS } = await import("./fixtures");
    const saved = settingsFromRow(SETTINGS);
    const changes = describeSettingsChanges(saved, { ...saved, requireMfa: false, dueDay: 20 }, "2026-10");
    const html = renderToStaticMarkup(
      createElement(SettingsReviewDialog, {
        open: true,
        onOpenChange: () => {},
        changes,
        pending: false,
        error: "Someone else changed the settings while you were editing.",
        onConfirm: () => {},
      }),
    );
    expect(html).toContain("Save these 2 changes?");
    expect(html).toContain("Due day");
    expect(html).toContain("20th of the following month");
    expect(html).toContain("Two-factor authentication");
    expect(html).toContain("Not required");
    expect(html).toContain("I understand that accounts will be protected by a password only");
    expect(html).toContain("Someone else changed the settings");
    expect(html).toContain("Save changes");
  });
});
