import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  EXCEL_MAX_CELL_CHARS,
  EXCEL_MAX_ROW_HEIGHT,
  applyPrintSetup,
  clampCellText,
  estimateRowHeight,
  excelDate,
  sanitizeCellText,
  workbookBytes,
} from "@/lib/exports/xlsx";

describe("cell text", () => {
  it("removes characters XML (and so Excel) refuses, keeping tabs and line breaks", () => {
    expect(sanitizeCellText("a\u000Bb\u0000c\u001Fd\tE\nF\r\nG￾")).toBe("abcd\tE\nF\r\nG");
    expect(sanitizeCellText("lone \uD800 surrogate")).toBe("lone � surrogate");
    expect(sanitizeCellText("emoji 😀 stays")).toBe("emoji 😀 stays");
  });

  it("cuts text to Excel's cell limit and says so", () => {
    expect(clampCellText("short")).toBe("short");
    const clamped = clampCellText("y".repeat(EXCEL_MAX_CELL_CHARS + 10));
    expect(clamped).toHaveLength(EXCEL_MAX_CELL_CHARS);
    expect(clamped.endsWith("The full text is on the platform.]")).toBe(true);
  });

  it("sanitises every text cell before writing the file", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Test");
    sheet.getCell("A1").value = "Pasted\u000Btext";
    sheet.getCell("B2").value = 12.5;
    sheet.getCell("C3").value = "z".repeat(EXCEL_MAX_CELL_CHARS + 1);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load((await workbookBytes(workbook)).buffer);
    const test = loaded.getWorksheet("Test");
    expect(test?.getCell("A1").value).toBe("Pastedtext");
    expect(test?.getCell("B2").value).toBe(12.5);
    expect(String(test?.getCell("C3").value)).toHaveLength(EXCEL_MAX_CELL_CHARS);
  });
});

describe("helpers", () => {
  it("makes calendar dates for Excel date cells whatever the server's timezone", () => {
    expect(excelDate("2026-07")).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(excelDate("2026-07-15")).toEqual(new Date(Date.UTC(2026, 6, 15)));
  });

  it("estimates wrapped row heights within Excel's limit", () => {
    expect(estimateRowHeight([{ text: "one line", width: 60 }])).toBe(18);
    expect(estimateRowHeight([{ text: "a\nb\nc", width: 60 }], 30)).toBe(45);
    expect(estimateRowHeight([{ text: "x".repeat(100_000), width: 60 }])).toBe(EXCEL_MAX_ROW_HEIGHT);
  });

  it("sets up landscape A4 printing fitted to one page wide, escaping & in the footer", () => {
    const sheet = new ExcelJS.Workbook().addWorksheet("S");
    applyPrintSetup(sheet, { titleRows: "4:5", titleColumns: "A:A", footer: "A & B" });
    expect(sheet.pageSetup).toMatchObject({
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "4:5",
      printTitlesColumn: "A:A",
    });
    expect(sheet.headerFooter.oddFooter).toBe("&LA && B&RPage &P of &N");
  });
});
