// The file reader and the pure parts of the historical months import (scripts/lib/tabular.ts,
// scripts/lib/history-import.ts; BRD §6.1, §12, B3).
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { classifyHeader, parseBooleanCell, parseMonthCell, parseNumberCell, roundTo } from "../../../scripts/lib/history-import";
import { csvTable, excelTable, parseCsv, TableError } from "../../../scripts/lib/tabular";

describe("parseCsv", () => {
  it("reads quoted values with commas, quotes and line breaks, and remembers each record's line", () => {
    const text = '﻿company,month,key_milestones\r\n"Batik, Boutique",2025-07,"Opened ""The Row""\nand IOI"\r\nRECQA,2025-08,\n';
    expect(parseCsv(text)).toEqual([
      { line: 1, fields: ["company", "month", "key_milestones"] },
      { line: 2, fields: ["Batik, Boutique", "2025-07", 'Opened "The Row"\nand IOI'] },
      { line: 4, fields: ["RECQA", "2025-08", ""] },
    ]);
  });

  it("refuses a quoted value that is never closed", () => {
    expect(() => parseCsv('a,b\n"open,1')).toThrow(TableError);
  });
});

describe("csvTable", () => {
  it("keys cells by the cleaned header, skips blank rows and keeps empty cells as null", () => {
    const table = csvTable("history.csv", "company ,  segment:  Online ,month\nRECQA, 1200 ,2025-07\n,,\nRECQA,,2025-08\n");
    expect(table.headers).toEqual(["company", "segment: Online", "month"]);
    expect(table.rows).toEqual([
      { source: "history.csv:2", cells: { company: "RECQA", "segment: Online": " 1200 ", month: "2025-07" } },
      { source: "history.csv:4", cells: { company: "RECQA", "segment: Online": null, month: "2025-08" } },
    ]);
  });

  it("refuses a column named twice and values under a column without a header", () => {
    expect(() => csvTable("a.csv", "company,Company\nx,y")).toThrow(/appears twice/);
    expect(() => csvTable("a.csv", "company,\nx,y")).toThrow(/no header/);
  });
});

describe("excelTable", () => {
  it("reads the first sheet: numbers, dates, formulas by their result and rich text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Monthly");
    sheet.addRow(["company", "month", "revenue_total", "key_milestones"]);
    sheet.addRow(["Kiddocare", new Date(Date.UTC(2025, 6, 1)), { formula: "1000+234.5", result: 1234.5 }, { richText: [{ text: "Launched " }, { text: "app" }] }]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const table = await excelTable("history.xlsx", buffer);
    expect(table.headers).toEqual(["company", "month", "revenue_total", "key_milestones"]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].source).toBe("history.xlsx row 2");
    expect(table.rows[0].cells.company).toBe("Kiddocare");
    expect(parseMonthCell(table.rows[0].cells.month)).toBe("2025-07");
    expect(table.rows[0].cells.revenue_total).toBe(1234.5);
    expect(table.rows[0].cells.key_milestones).toBe("Launched app");
  });
});

describe("cells and columns", () => {
  it("classifies headers", () => {
    expect(classifyHeader("Company")).toEqual({ kind: "company" });
    expect(classifyHeader("MONTH")).toEqual({ kind: "month" });
    expect(classifyHeader("revenue_total")).toEqual({ kind: "field", key: "revenue_total" });
    expect(classifyHeader("segment: Online sales ")).toEqual({ kind: "segment", segmentKind: "company", name: "Online sales" });
    expect(classifyHeader("Line:AOnePay")).toEqual({ kind: "segment", segmentKind: "scaleup", name: "AOnePay" });
    expect(classifyHeader("kpi:Revenue per outlet [Mont Kiara]")).toEqual({ kind: "kpi", name: "Revenue per outlet", member: "Mont Kiara" });
    expect(classifyHeader("kpi: App downloads")).toEqual({ kind: "kpi", name: "App downloads", member: null });
    expect(classifyHeader("# notes")).toEqual({ kind: "ignored" });
    expect(classifyHeader("Total revenue")).toBeNull();
    expect(classifyHeader("segment:   ")).toBeNull();
  });

  it("reads months in the accepted spellings", () => {
    expect(parseMonthCell("2025-07")).toBe("2025-07");
    expect(parseMonthCell("2025-7-01")).toBe("2025-07");
    expect(parseMonthCell("Jul 2025")).toBe("2025-07");
    expect(parseMonthCell("September 2025")).toBe("2025-09");
    expect(parseMonthCell("Sept. 2025")).toBe("2025-09");
    expect(parseMonthCell("2025-02-30")).toBeNull();
    expect(parseMonthCell("07/2025")).toBeNull();
    expect(parseMonthCell(202507)).toBeNull();
  });

  it("reads numbers and Yes/No", () => {
    expect(parseNumberCell("RM 1,234.50")).toEqual({ ok: true, value: 1234.5 });
    expect(parseNumberCell("(1,000)")).toEqual({ ok: true, value: -1000 });
    expect(parseNumberCell("12.5%", { percent: true })).toEqual({ ok: true, value: 12.5 });
    expect(parseNumberCell("about 5").ok).toBe(false);
    expect(parseNumberCell(true).ok).toBe(false);
    expect(parseBooleanCell("Yes")).toEqual({ ok: true, value: true });
    expect(parseBooleanCell("n")).toEqual({ ok: true, value: false });
    expect(parseBooleanCell(1)).toEqual({ ok: true, value: true });
    expect(parseBooleanCell("maybe").ok).toBe(false);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.345, 2)).toBe(-2.35);
  });
});
