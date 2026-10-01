import ExcelJS from "exceljs";
import type { Worksheet } from "exceljs";
import { describe, expect, it } from "vitest";

import {
  COMPANY_SEGMENTS_HEADING,
  SCALEUP_LINES_HEADING,
  buildC4Model,
  buildC4Workbook,
  c4CellText,
  c4WorkbookFileName,
  formatNarrativeValue,
  lastUpdatedText,
  segmentBlocks,
  segmentLabel,
  segmentsNote,
} from "@/lib/exports/c4-workbook";
import { ENTERED_EARLIER_TOTAL_NOTE } from "@/lib/exports/segments";
import { EXCEL_MAX_CELL_CHARS } from "@/lib/exports/xlsx";

import { IDS, batikInput, figures, month, num, template, text } from "./fixtures";

function sheet(workbook: ExcelJS.Workbook, name: string): Worksheet {
  const found = workbook.getWorksheet(name);
  if (!found) throw new Error(`missing sheet ${name}`);
  return found;
}

function value(ws: Worksheet, address: string): unknown {
  return ws.getCell(address).value;
}

function rowValues(ws: Worksheet, rowNumber: number, lastCol: number): unknown[] {
  const row = ws.getRow(rowNumber);
  return Array.from({ length: lastCol }, (_, i) => row.getCell(i + 1).value);
}

describe("C4 model", () => {
  it("has a column per half-year from the first reported one to the one in progress", () => {
    const model = buildC4Model(batikInput());
    expect(model.halves.map((h) => [h.period.label, h.inProgress, h.months.map((m) => m.key)])).toEqual([
      ["H1 2026", false, ["2026-05", "2026-06"]],
      ["H2 2026", true, ["2026-07", "2026-08", "2026-09"]],
    ]);
    expect(model.narrativeRows.map((row) => row.title)).toEqual([
      "Company Summary",
      "Revenue and Financial Metrics",
      "Operation",
      "Investment",
      "Founder Pulse",
    ]);
  });

  it("includes only approved months unless asked for all", () => {
    const approved = buildC4Model(batikInput());
    expect(approved.months.map((m) => [m.key, m.included])).toEqual([
      ["2026-05", true],
      ["2026-06", true],
      ["2026-07", true],
      ["2026-08", false],
      ["2026-09", false],
    ]);
    // Values of months that are not included are dropped even when they were loaded.
    expect(approved.byKey.get("2026-08")?.financials.revenue_total).toBeNull();
    const all = buildC4Model(batikInput({ include: "all" }));
    expect(all.months.every((m) => m.included)).toBe(true);
    expect(all.byKey.get("2026-08")?.financials.revenue_total).toBe(130_000);
  });

  it("defaults today to the export's Malaysia date", () => {
    const model = buildC4Model(batikInput({ today: undefined, generatedAt: "2026-12-31T16:30:00Z" }));
    expect(model.today).toBe("2027-01-01");
    expect(model.halves.at(-1)?.period.label).toBe("H1 2027");
  });
});

describe("C4 narrative cells", () => {
  it("lists monthly entries and states months without a narrative", () => {
    const model = buildC4Model(batikInput());
    const [h1, h2] = model.halves;
    const row = (title: string) => {
      const found = model.narrativeRows.find((r) => r.title === title);
      if (!found) throw new Error(title);
      return found;
    };
    expect(c4CellText(model, h1, row("Company Summary"))).toBe("May 2026: Opened Mont Kiara.\n\nNo update: Jun 2026");
    expect(c4CellText(model, h1, row("Revenue and Financial Metrics"))).toBe("No update: May 2026, Jun 2026");
    expect(c4CellText(model, h2, row("Company Summary"))).toBe(
      "No update: Jul 2026\n\nNot yet approved: Aug 2026, Sep 2026",
    );
    expect(c4CellText(model, h2, row("Operation"))).toBe(
      "Jul 2026:\n• Operations highlights: Opened The Row.\n• Team highlights: Hired a head of retail.\n\nNot yet approved: Aug 2026, Sep 2026",
    );
    expect(c4CellText(model, h2, row("Investment"))).toBe(
      "Jul 2026:\n• Fundraising status: Actively raising\n\nNot yet approved: Aug 2026, Sep 2026",
    );
    expect(c4CellText(model, h1, row("Founder Pulse"))).toBe("May 2026:\n• Team morale: 4 / 5\n\nNo update: Jun 2026");
    expect(c4CellText(model, h2, row("Founder Pulse"))).toBe(
      "Jul 2026:\n• Help needed (tags): Fundraising, Hiring\n\nNot yet approved: Aug 2026, Sep 2026",
    );
  });

  it("marks months that are not approved when every month is included", () => {
    const model = buildC4Model(batikInput({ include: "all" }));
    const h2 = model.halves[1];
    const summary = model.narrativeRows[0];
    expect(c4CellText(model, h2, summary)).toBe(
      "No update: Jul 2026\n\nAug 2026 (not yet approved): Signed the Merdeka 118 lease.\n\nNo update (not yet approved): Sep 2026",
    );
  });

  it("dates the Last Updated row from approvals (or submissions and saves when all months are included)", () => {
    const approved = buildC4Model(batikInput());
    expect(approved.halves.map((h) => lastUpdatedText(h))).toEqual(["20 Jul 2026", "18 Aug 2026"]);
    const all = buildC4Model(batikInput({ include: "all" }));
    expect(all.halves.map((h) => lastUpdatedText(h))).toEqual(["20 Jul 2026", "18 Sep 2026"]);
  });

  it("uses each month's own template version and maps sections by title", () => {
    const old = template(IDS.templateV0);
    // In the old version the milestones lived in a differently keyed section with the same title.
    old.sections = old.sections.map((section) =>
      section.title === "Company Summary"
        ? { ...section, key: "summary_v0", fields: [{ ...section.fields[0], key: "milestones_v0", label: "Milestones" }] }
        : section,
    );
    const input = batikInput({
      templates: [template(), old],
      months: [
        month("2026-05", "approved", {
          template_version_id: IDS.templateV0,
          approved_at: "2026-06-19T03:00:00Z",
          values: { milestones_v0: text("First outlet open.") },
        }),
      ],
    });
    const model = buildC4Model(input);
    expect(c4CellText(model, model.halves[0], model.narrativeRows[0])).toBe("May 2026: First outlet open.");
  });

  it("formats picklists, tags, ratings with labels and booleans", () => {
    const rating = template().sections.find((s) => s.key === "founder_pulse")?.fields[0];
    if (!rating) throw new Error("rating field");
    expect(formatNarrativeValue(rating, num(5))).toBe("5 / 5 (Very high)");
    expect(formatNarrativeValue(rating, num(3))).toBe("3 / 5");
    expect(formatNarrativeValue({ field_type: "tags", options: null }, { value_number: null, value_text: null, value_json: [] })).toBeNull();
    expect(formatNarrativeValue({ field_type: "boolean", options: null }, { value_number: null, value_text: null, value_json: false })).toBe("No");
    expect(formatNarrativeValue({ field_type: "long_text", options: null }, text("  \r\nLine one\r\n\r\n\r\nLine two  "))).toBe(
      "Line one\n\nLine two",
    );
    expect(formatNarrativeValue({ field_type: "long_text", options: null }, text("   "))).toBeNull();
    expect(formatNarrativeValue({ field_type: "currency", options: null }, num(1234.5), "USD")).toBe("USD 1,235");
  });

  it("shortens text that does not fit in one Excel cell", () => {
    const long = "x".repeat(40_000);
    const input = batikInput({
      months: [
        month("2026-05", "approved", { approved_at: "2026-06-19T03:00:00Z", values: { key_milestones: text(long) } }),
      ],
    });
    const model = buildC4Model(input);
    const cell = c4CellText(model, model.halves[0], model.narrativeRows[0]);
    expect(cell.length).toBeLessThanOrEqual(EXCEL_MAX_CELL_CHARS);
    expect(cell.endsWith("[Text shortened to fit one spreadsheet cell. The full text is on the platform.]")).toBe(true);
  });

  it("says when a half-year has no months", () => {
    const input = batikInput({
      today: "2027-01-15",
      months: [
        month("2025-12", "approved", { approved_at: "2026-01-20T02:00:00Z", values: { revenue_total: num(100) } }),
        month("2026-12", "approved", { approved_at: "2027-01-12T02:00:00Z", values: { revenue_total: num(150) } }),
      ],
    });
    const model = buildC4Model(input);
    expect(model.halves.map((h) => h.period.label)).toEqual(["H2 2025", "H1 2026", "H2 2026", "H1 2027"]);
    expect(c4CellText(model, model.halves[1], model.narrativeRows[0])).toBe("No monthly updates in this half-year.");
    expect(c4CellText(model, model.halves[3], model.narrativeRows[0])).toBe("No months reported yet.");
  });
});

describe("C4 workbook", () => {
  it("has the four sheets with the brand header, frozen panes and landscape printing", async () => {
    const workbook = buildC4Workbook(batikInput());
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(["C4", "Revenue Lines", "KPIs", "Monthly Grid"]);

    // Round trip through a real file.
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(loaded.worksheets.map((ws) => ws.name)).toEqual(["C4", "Revenue Lines", "KPIs", "Monthly Grid"]);
    const c4 = sheet(loaded, "C4");
    const header = c4.getCell("A4");
    expect(header.value).toBe("Category");
    expect(header.fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { argb: "FFE2743A" } });
    expect(header.font).toMatchObject({ bold: true, color: { argb: "FFFFFFFF" } });
    expect(c4.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 5 });
    expect(c4.pageSetup).toMatchObject({ orientation: "landscape", fitToPage: true, fitToWidth: 1 });
    expect(sheet(loaded, "Revenue Lines").views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 5 });
    expect(sheet(loaded, "KPIs").views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 5 });
    expect(sheet(loaded, "Monthly Grid").views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 4 });
  });

  it("lays out the C4 sheet: company, Last Updated, categories × half-years, Input Here", () => {
    const c4 = sheet(buildC4Workbook(batikInput()), "C4");
    expect(value(c4, "A1")).toBe("Company");
    expect(value(c4, "B1")).toBe("Batik Boutique (Batik Boutique Sdn Bhd)");
    expect(String(value(c4, "B2"))).toContain("Approved months only");
    expect(rowValues(c4, 4, 3)).toEqual(["Category", "H1 2026", "Input Here (H2 2026)"]);
    expect(rowValues(c4, 5, 3)).toEqual(["Last Updated", "20 Jul 2026", "18 Aug 2026"]);
    expect(value(c4, "A6")).toBe("Company Summary");
    expect(value(c4, "B6")).toBe("May 2026: Opened Mont Kiara.\n\nNo update: Jun 2026");
    expect(value(c4, "A10")).toBe("Founder Pulse");
    expect(c4.getCell("B6").alignment).toMatchObject({ wrapText: true, vertical: "top" });
    expect(c4.getRow(8).height).toBeGreaterThan(30);
  });

  it("writes Revenue Lines with half-year totals from the approved months", () => {
    const rl = sheet(buildC4Workbook(batikInput()), "Revenue Lines");
    // Columns: A label, B May, C Jun, D H1 2026, E Jul, F Aug, G Sep, H H2 2026.
    expect(rowValues(rl, 4, 8)).toEqual([
      "Line (RM)",
      "May 2026",
      "Jun 2026",
      "H1 2026",
      "Jul 2026",
      "Aug 2026",
      "Sep 2026",
      "H2 2026",
    ]);
    expect(rowValues(rl, 5, 8)).toEqual([
      "Status",
      "Approved",
      "Approved",
      "2 months included",
      "Approved",
      "Submitted",
      "Not submitted",
      "1 month included",
    ]);
    // BRD B30: the company's own segments (adding up to total revenue), total revenue, then ScaleUp's lines.
    expect(value(rl, "A6")).toBe("Company revenue segments (add up to total revenue)");
    expect(rowValues(rl, 7, 8)).toEqual(["Retail", 60_000, 70_000, 130_000, 80_000, null, null, 80_000]);
    expect(rowValues(rl, 8, 8)).toEqual(["Online", 30_000, 40_000, 70_000, 40_000, null, null, 40_000]);
    expect(rowValues(rl, 9, 8)).toEqual(["Wholesale (no longer used)", 10_000, null, 10_000, null, null, null, null]);
    expect(rowValues(rl, 10, 8)).toEqual(["Total revenue", 100_000, 110_000, 210_000, 120_000, null, null, 120_000]);
    expect(value(rl, "A11")).toBe("ScaleUp revenue lines (need not add up to total revenue)");
    // Half-year sums are exact to the cent (100.1 + 200.2 is 300.29999999999995 in floating point).
    expect(rowValues(rl, 12, 8)).toEqual(["Corporate gifting", 100.1, 200.2, 300.3, 7_000, null, null, 7_000]);
    // "Events" (no longer used) has no figure in an included month, so it has no row.
    expect(value(rl, "A13")).toBe("Gross profit");
    expect(value(rl, "A14")).toBe("GP %");
    expect(value(rl, "B14")).toBe(0.4);
    expect(value(rl, "D14")).toBe(0.4);
    expect(rl.getCell("B14").numFmt).toBe("0.0%;[Red]-0.0%");
    expect(value(rl, "D16")).toBeCloseTo(-0.071429, 6);
    expect(rowValues(rl, 17, 4)).toEqual(["Cash in bank (month end)", 600_000, 560_000, 560_000]);
    expect(rowValues(rl, 18, 4)).toEqual(["Monthly burn", 50_000, 40_000, 45_000]);
    expect(value(rl, "A19")).toBe("Runway (months)");
    expect(value(rl, "B19")).toBe(12);
    expect(value(rl, "D19")).toBeCloseTo(12.444, 3);
    expect(value(rl, "E19")).toBe("Cash-flow positive");
    expect(value(rl, "H19")).toBe("Cash-flow positive");
    expect(rowValues(rl, 20, 4)).toEqual(["Headcount (full-time)", 10, 11, 11]);
    expect(value(rl, "A22")).toBe("Revenue YoY %");
    expect(rl.getCell("B10").numFmt).toBe("#,##0;[Red]-#,##0");
    // Segment headings are tinted rows across the sheet; segments are indented under them.
    expect(rl.getCell("A6").font).toMatchObject({ bold: true, italic: true });
    expect(rl.getCell("H6").fill).toMatchObject({ fgColor: { argb: "FFFBEFE8" } });
    expect(rl.getCell("A7").alignment).toMatchObject({ indent: 1 });
    expect(String(value(rl, "A3"))).toContain("Revenue segments are the company's own breakdown and add up to total revenue");
    // Months that are not approved stay empty and greyed out.
    expect(rl.getCell("F10").fill).toMatchObject({ fgColor: { argb: "FFF4F4F4" } });
    // No RM block for MYR companies.
    expect(value(rl, "A24")).toBeNull();
  });

  it("includes every month, marked by status, when asked", () => {
    const rl = sheet(buildC4Workbook(batikInput({ include: "all" })), "Revenue Lines");
    // The Sep draft follows the current segments, as the monthly form shows it: its stale figure on
    // Wholesale (retired) is not shown, and its total revenue is the sum of the segments it shows
    // (Retail 50,000), not the stale stored 90,000 (BRD B30).
    expect(rowValues(rl, 10, 8)).toEqual(["Total revenue", 100_000, 110_000, 210_000, 120_000, 130_000, 50_000, 300_000]);
    expect(value(rl, "H5")).toBe("3 months included");
    expect(rowValues(rl, 7, 8)).toEqual(["Retail", 60_000, 70_000, 130_000, 80_000, 90_000, 50_000, 220_000]);
    expect(rowValues(rl, 9, 8)).toEqual(["Wholesale (no longer used)", 10_000, null, 10_000, null, null, null, null]);
    expect(rowValues(rl, 12, 1)).toEqual(["Corporate gifting"]);
    expect(value(rl, "A13")).toBe("Gross profit");
    // Cash at half-year end comes from the latest month (Sep has none: no back-fill); burn is averaged.
    expect(value(rl, "H17")).toBeNull();
    expect(value(rl, "H18")).toBe(10_000);
    expect(String(value(rl, "A3"))).toContain(
      "Months still open for changes show total revenue as the sum of their segments, as the monthly form calculates it.",
    );
  });

  it("calculates an open month's total revenue from the company's own segments (BRD B30)", () => {
    // The owner removed Wholesale (RM 300) while Sep was a draft holding Retail 700 + Wholesale 300 and a
    // stored total of RM 1,000; Corporate gifting is a ScaleUp line and never part of total revenue.
    const input = batikInput({
      include: "all",
      kpis: [],
      months: [
        month("2026-08", "approved", {
          approved_at: "2026-09-18T03:00:00Z",
          values: figures({ revenue: 1_000, gp: 400, np: 100, cash: 9_000, burn: 500, ft: 5, pt: 0 }),
          segments: { [IDS.retail]: 600, [IDS.online]: 400, [IDS.gifting]: 50 },
        }),
        month("2026-09", "draft", {
          values: figures({ revenue: 1_000, gp: 350, np: 70, cash: 8_500, burn: 500, ft: 5, pt: 0 }),
          segments: { [IDS.retail]: 700, [IDS.wholesale]: 300, [IDS.gifting]: 60 },
        }),
      ],
    });
    const model = buildC4Model(input);
    const september = model.byKey.get("2026-09");
    expect(september?.financials.revenue_total).toBe(700);
    expect(september?.revenueEnteredEarlier).toBe(false);
    expect(september?.segments).toEqual({ [IDS.retail]: 700, [IDS.gifting]: 60 });
    // Submitted and approved months keep their stored total.
    expect(model.byKey.get("2026-08")?.financials.revenue_total).toBe(1_000);

    const workbook = buildC4Workbook(input);
    const rl = sheet(workbook, "Revenue Lines");
    // Columns: A label, B Aug, C Sep, D H2 2026. Rows: 6 heading, 7 Retail, 8 Online, 9 Total revenue.
    expect(rowValues(rl, 7, 4)).toEqual(["Retail", 600, 700, 1_300]);
    expect(rowValues(rl, 8, 4)).toEqual(["Online", 400, null, 400]);
    expect(rowValues(rl, 9, 4)).toEqual(["Total revenue", 1_000, 700, 1_700]);
    expect(rl.getCell("C9").note).toBeUndefined();
    // GP % against the calculated total (350 / 700), and the half-year from the same figures.
    expect(value(rl, "A13")).toBe("GP %");
    expect(value(rl, "C13")).toBe(0.5);
    expect(value(rl, "D13")).toBeCloseTo(0.441176, 6); // 750 / 1,700 (periodTotals: 4 decimals of a percent)

    const grid = sheet(workbook, "Monthly Grid");
    const headers: string[] = [];
    grid.getRow(4).eachCell((cell) => headers.push(String(cell.value)));
    const col = (name: string) => headers.indexOf(name) + 1;
    const sepRow = grid.getRow(6);
    expect(sepRow.getCell(col("Total revenue")).value).toBe(700);
    expect(sepRow.getCell(col("Revenue MoM %")).value).toBeCloseTo(-0.3, 10);
  });

  it("keeps a total entered before the segments were filled in, with a note", () => {
    const input = batikInput({
      include: "all",
      kpis: [],
      company: { name: "Batik Boutique", legal_name: null, reporting_currency: "USD" },
      months: [
        month("2026-08", "approved", {
          approved_at: "2026-09-18T03:00:00Z",
          fx_rate_to_myr: 4,
          values: figures({ revenue: 1_000, gp: 400, np: 100, cash: 9_000, burn: 500, ft: 5, pt: 0 }),
          segments: { [IDS.retail]: 600, [IDS.online]: 400 },
        }),
        // Total revenue was entered directly, then the owner set up segments: none is filled in yet.
        month("2026-09", "draft", {
          fx_rate_to_myr: 4,
          values: figures({ revenue: 900, gp: 300, np: 50, cash: 8_500, burn: 500, ft: 5, pt: 0 }),
          segments: { [IDS.gifting]: 60 },
        }),
      ],
    });
    expect(buildC4Model(input).byKey.get("2026-09")?.revenueEnteredEarlier).toBe(true);

    const workbook = buildC4Workbook(input);
    const rl = sheet(workbook, "Revenue Lines");
    expect(rowValues(rl, 9, 4)).toEqual(["Total revenue", 1_000, 900, 1_900]);
    expect(rl.getCell("C9").note).toBe(ENTERED_EARLIER_TOTAL_NOTE);
    expect(rl.getCell("B9").note).toBeUndefined();
    // The RM block's total carries the same note.
    const rmTotalRow = rl.getColumn(1).values.indexOf("Total revenue (RM)");
    expect(rmTotalRow).toBeGreaterThan(9);
    expect(rowValues(rl, rmTotalRow, 3)).toEqual(["Total revenue (RM)", 4_000, 3_600]);
    expect(rl.getCell(rmTotalRow, 3).note).toBe(ENTERED_EARLIER_TOTAL_NOTE);

    const grid = sheet(workbook, "Monthly Grid");
    const headers: string[] = [];
    grid.getRow(4).eachCell((cell) => headers.push(String(cell.value)));
    const total = grid.getRow(6).getCell(headers.indexOf("Total revenue") + 1);
    expect(total.value).toBe(900);
    expect(total.note).toBe(ENTERED_EARLIER_TOTAL_NOTE);
  });

  it("explains open months' totals only when every month is included and the company has segments", () => {
    const blocks = segmentBlocks(buildC4Model(batikInput()));
    const sentence = "Months still open for changes show total revenue as the sum of their segments";
    expect(segmentsNote(blocks, "all")).toContain(sentence);
    expect(segmentsNote(blocks, "approved")).not.toContain(sentence);
    expect(segmentsNote({ company: [], scaleup: blocks.scaleup }, "all")).not.toContain(sentence);
    expect(segmentsNote({ company: [], scaleup: [] }, "all")).toBeNull();
  });

  it("keeps a retired segment's submitted figures and starts a renamed segment as a new series (BRD B30)", () => {
    const renamedFrom = "a1000000-0000-4000-8000-000000000010";
    const renamedTo = "a1000000-0000-4000-8000-000000000011";
    const input = batikInput({
      include: "all",
      segments: [
        { id: renamedFrom, name: "Online", is_active: false, kind: "company", sort_order: 2 },
        { id: renamedTo, name: "Web", is_active: true, kind: "company", sort_order: 2 },
        { id: IDS.retail, name: "Retail", is_active: true, kind: "company", sort_order: 1 },
      ],
      months: [
        month("2026-07", "approved", {
          approved_at: "2026-08-18T03:00:00Z",
          values: figures({ revenue: 100, gp: 40, np: 10, cash: 1_000, burn: 10, ft: 1, pt: 0 }),
          segments: { [IDS.retail]: 60, [renamedFrom]: 40 },
        }),
        // Sent back after the rename: it still holds the old segment's figure, which it no longer shows.
        month("2026-08", "changes_requested", {
          values: figures({ revenue: 110, gp: 40, np: 10, cash: 1_000, burn: 10, ft: 1, pt: 0 }),
          segments: { [IDS.retail]: 70, [renamedFrom]: 40, [renamedTo]: 40 },
        }),
      ],
    });
    const model = buildC4Model(input);
    expect(model.byKey.get("2026-08")?.segments).toEqual({ [IDS.retail]: 70, [renamedTo]: 40 });
    const blocks = segmentBlocks(model);
    expect(blocks.company.map((segment) => segmentLabel(segment))).toEqual(["Retail", "Web", "Online (no longer used)"]);
    expect(blocks.scaleup).toEqual([]);

    const rl = sheet(buildC4Workbook(input), "Revenue Lines");
    // Columns: A label, B Jul, C Aug, D H2 2026.
    expect(rowValues(rl, 7, 4)).toEqual(["Retail", 60, 70, 130]);
    expect(rowValues(rl, 8, 4)).toEqual(["Web", null, 40, 40]);
    expect(rowValues(rl, 9, 4)).toEqual(["Online (no longer used)", 40, null, 40]);
    expect(value(rl, "A10")).toBe("Total revenue");
    // Without ScaleUp revenue lines there is no block for them.
    expect(value(rl, "A11")).toBe("Gross profit");
  });

  it("orders each kind's segments: in use first, then by order and name", () => {
    const blocks = segmentBlocks(buildC4Model(batikInput()));
    expect(blocks.company.map((segment) => segment.name)).toEqual(["Retail", "Online", "Wholesale"]);
    expect(blocks.scaleup.map((segment) => segment.name)).toEqual(["Corporate gifting"]);
    // Without any segments, no headings and no note.
    const rl = sheet(buildC4Workbook(batikInput({ segments: [] })), "Revenue Lines");
    expect(value(rl, "A6")).toBe("Total revenue");
    expect(value(rl, "A3")).toBeNull();
    expect(COMPANY_SEGMENTS_HEADING).toBe("Company revenue segments (add up to total revenue)");
    expect(SCALEUP_LINES_HEADING).toBe("ScaleUp revenue lines (need not add up to total revenue)");
  });

  it("adds an RM block for non-MYR companies when FX rates are visible", () => {
    const usd = batikInput({
      company: { name: "i-Motorbike", legal_name: "iMotorbike Pte Ltd", reporting_currency: "USD" },
      segments: [],
      kpis: [],
      months: [
        month("2026-07", "approved", {
          approved_at: "2026-08-18T03:00:00Z",
          fx_rate_to_myr: 4.2,
          values: figures({ revenue: 1_000, gp: 400, np: -100, cash: 10_000, burn: 500, ft: 5, pt: 0 }),
        }),
        month("2026-08", "approved", {
          approved_at: "2026-09-18T03:00:00Z",
          fx_rate_to_myr: null,
          values: figures({ revenue: 2_000, gp: 800, np: 100, cash: 9_000, burn: 600, ft: 5, pt: 0 }),
        }),
      ],
    });
    const rl = sheet(buildC4Workbook(usd), "Revenue Lines");
    expect(value(rl, "A4")).toBe("Line (USD)");
    // Rows 6–16 are the figures; row 17 is blank; the RM block starts at row 18.
    expect(String(value(rl, "A18"))).toContain("RM equivalent");
    expect(rowValues(rl, 19, 4)).toEqual(["FX rate (USD to MYR)", 4.2, null, null]);
    expect(rowValues(rl, 20, 4)).toEqual(["Total revenue (RM)", 4_200, null, null]);
    expect(rowValues(rl, 23, 4)).toEqual(["Cash in bank (RM)", 42_000, null, null]);

    const companyView = sheet(buildC4Workbook({ ...usd, fxVisible: false }), "Revenue Lines");
    expect(value(companyView, "A18")).toBeNull();
    const grid = sheet(buildC4Workbook({ ...usd, fxVisible: false }), "Monthly Grid");
    expect(rowValues(grid, 4, 5)).toEqual(["Month", "Status", "Submitted", "Approved", "Total revenue"]);
  });

  it("converts both revenue breakdowns in the RM block", () => {
    const usd = batikInput({
      company: { name: "i-Motorbike", legal_name: null, reporting_currency: "USD" },
      segments: [
        { id: IDS.retail, name: "Rentals", is_active: true, kind: "company", sort_order: 1 },
        { id: IDS.gifting, name: "Fleet sales", is_active: true, kind: "scaleup", sort_order: 1 },
      ],
      kpis: [],
      months: [
        month("2026-07", "approved", {
          approved_at: "2026-08-18T03:00:00Z",
          fx_rate_to_myr: 4,
          values: figures({ revenue: 1_000, gp: 400, np: -100, cash: 10_000, burn: 500, ft: 5, pt: 0 }),
          segments: { [IDS.retail]: 1_000, [IDS.gifting]: 300 },
        }),
      ],
    });
    const rl = sheet(buildC4Workbook(usd), "Revenue Lines");
    // Rows 6–20: heading, Rentals, Total revenue, heading, Fleet sales, then GP … YoY; 21 blank; 22 RM header.
    expect(value(rl, "A20")).toBe("Revenue YoY %");
    expect(value(rl, "A21")).toBeNull();
    expect(String(value(rl, "A22"))).toContain("RM equivalent");
    expect(rowValues(rl, 23, 3)).toEqual(["FX rate (USD to MYR)", 4, null]);
    expect(value(rl, "A24")).toBe("Company revenue segments (add up to total revenue)");
    expect(rowValues(rl, 25, 3)).toEqual(["Rentals (RM)", 4_000, 4_000]);
    expect(rowValues(rl, 26, 3)).toEqual(["Total revenue (RM)", 4_000, 4_000]);
    expect(value(rl, "A27")).toBe("ScaleUp revenue lines (need not add up to total revenue)");
    expect(rowValues(rl, 28, 3)).toEqual(["Fleet sales (RM)", 1_200, 1_200]);
    expect(value(rl, "A29")).toBe("Gross profit (RM)");
  });

  it("computes revenue YoY like for like", () => {
    const input = batikInput({
      today: "2027-01-15",
      segments: [],
      months: [
        month("2025-12", "approved", { approved_at: "2026-01-20T02:00:00Z", values: { revenue_total: num(100) } }),
        month("2026-12", "approved", { approved_at: "2027-01-12T02:00:00Z", values: { revenue_total: num(150) } }),
      ],
    });
    const rl = sheet(buildC4Workbook(input), "Revenue Lines");
    // B Dec 2025, C H2 2025, D–I Jan–Jun 2026, J H1 2026, K–P Jul–Dec 2026, Q H2 2026.
    expect(value(rl, "P4")).toBe("Dec 2026");
    expect(value(rl, "Q4")).toBe("H2 2026");
    expect(value(rl, "A16")).toBe("Revenue YoY %");
    expect(value(rl, "P16")).toBe(0.5);
    expect(value(rl, "Q16")).toBe(0.5);
    expect(value(rl, "D5")).toBe("No update");
    expect(value(rl, "J5")).toBe("0 months included");
  });

  it("writes one KPI row per KPI and dimension member", () => {
    const kpis = sheet(buildC4Workbook(batikInput()), "KPIs");
    expect(rowValues(kpis, 4, 6)).toEqual(["KPI", "Member", "Unit", "Frequency", "May 2026", "Jun 2026"]);
    expect(rowValues(kpis, 6, 5)).toEqual(["Revenue per outlet", "Mont Kiara", "RM", "Monthly", 25_000]);
    expect(rowValues(kpis, 7, 2)).toEqual(["Revenue per outlet", "The Row"]);
    expect(rowValues(kpis, 8, 5)).toEqual(["Profitable", "Mont Kiara", "—", "Monthly", "Yes"]);
    expect(rowValues(kpis, 10, 5)).toEqual(["App downloads", "—", "downloads", "Monthly", 1_500]);
    // The inactive member and the inactive KPI without values are left out.
    expect(value(kpis, "A11")).toBeNull();
  });

  it("writes the monthly grid with status, figures, derived metrics and KPIs", () => {
    const grid = sheet(buildC4Workbook(batikInput()), "Monthly Grid");
    const header = grid.getRow(4);
    const headers: string[] = [];
    header.eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      "Month",
      "Status",
      "Submitted",
      "Approved",
      "Total revenue",
      "Revenue segment: Retail",
      "Revenue segment: Online",
      "Revenue segment: Wholesale (no longer used)",
      "ScaleUp revenue line: Corporate gifting",
      "Gross profit",
      "Net profit",
      "Cash in bank",
      "Monthly burn",
      "Headcount FT",
      "Headcount PT",
      "Active customers",
      "Team morale",
      "GP %",
      "NP %",
      "Runway (months)",
      "Revenue MoM %",
      "Revenue YoY %",
      "Revenue per outlet: Mont Kiara",
      "Revenue per outlet: The Row",
      "Profitable: Mont Kiara",
      "Profitable: The Row",
      "App downloads",
      "Narrative",
    ]);
    const col = (name: string) => headers.indexOf(name) + 1;
    const may = grid.getRow(5);
    expect(may.getCell(1).value).toEqual(new Date(Date.UTC(2026, 4, 1)));
    expect(may.getCell(col("Status")).value).toBe("Approved");
    expect(may.getCell(col("Approved")).value).toEqual(new Date(Date.UTC(2026, 5, 19)));
    expect(may.getCell(col("Total revenue")).value).toBe(100_000);
    expect(may.getCell(col("Revenue segment: Wholesale (no longer used)")).value).toBe(10_000);
    expect(may.getCell(col("ScaleUp revenue line: Corporate gifting")).value).toBe(100.1);
    expect(may.getCell(col("Active customers")).value).toBe(120);
    expect(may.getCell(col("Narrative")).value).toBe("Provided");
    expect(String(value(grid, "A3"))).toContain("ScaleUp revenue lines are set by ScaleUp");
    const june = grid.getRow(6);
    expect(june.getCell(col("Revenue MoM %")).value).toBeCloseTo(0.1, 10);
    expect(june.getCell(col("Narrative")).value).toBe("No update");
    const august = grid.getRow(8);
    expect(august.getCell(col("Status")).value).toBe("Submitted");
    expect(august.getCell(col("Total revenue")).value).toBeNull();
    expect(grid.autoFilter).toMatchObject({ from: { row: 4, column: 1 }, to: { row: 9, column: headers.length } });
  });

  it("handles a company with no months yet", () => {
    const workbook = buildC4Workbook(batikInput({ months: [] }));
    const c4 = sheet(workbook, "C4");
    expect(rowValues(c4, 4, 2)).toEqual(["Category", "Input Here (H2 2026)"]);
    expect(value(c4, "B6")).toBe("No months reported yet.");
    expect(value(sheet(workbook, "Revenue Lines"), "A4")).toBe("No monthly updates yet.");
    expect(value(sheet(workbook, "Monthly Grid"), "A5")).toBe("No monthly updates yet.");
  });

  it("names the download after the company and date", () => {
    expect(c4WorkbookFileName("Batik Boutique", "2026-09-30", "approved")).toBe("Batik Boutique C4 workbook 2026-09-30.xlsx");
    expect(c4WorkbookFileName("RECQA", "2026-09-30", "all")).toBe("RECQA C4 workbook 2026-09-30 (all months).xlsx");
  });
});
