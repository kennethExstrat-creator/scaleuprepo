// Shared ExcelJS helpers for the exports (C4 workbook, portfolio data): the ScaleUp brand header
// (#E2743A with white bold text), number formats, column widths, landscape print setup and Excel's
// limits. Pure: no server-only imports, so the builders can be unit-tested.
import type { Alignment, Borders, Cell, Fill, Font, Row, Workbook, Worksheet } from "exceljs";

import { parseMonthParts } from "@/lib/periods";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The logo orange (docs/ARCHITECTURE.md §0 Branding) as ARGB. */
export const BRAND_ARGB = "FFE2743A";
const WHITE_ARGB = "FFFFFFFF";
const TITLE_ARGB = "FF1F1F1F";
const NOTE_ARGB = "FF6B6B6B";
const SUBTLE_FILL_ARGB = "FFFBEFE8";
const MUTED_FILL_ARGB = "FFF4F4F4";
const BORDER_ARGB = "FFDDDDDD";

/** Excel number formats used across the exports. Percentages are stored as fractions (0.4667). */
export const NUMBER_FORMATS = {
  money: "#,##0;[Red]-#,##0",
  decimal: "#,##0.00;[Red]-#,##0.00",
  integer: "#,##0",
  pct: "0.0%;[Red]-0.0%",
  runway: "0.0",
  fx: "0.0000####",
  month: "mmm yyyy",
  date: "d mmm yyyy",
} as const;

export type NumberFormatName = keyof typeof NUMBER_FORMATS;

/** Excel's hard limit on the characters in one cell. */
export const EXCEL_MAX_CELL_CHARS = 32_767;
/** Excel's maximum row height in points. */
export const EXCEL_MAX_ROW_HEIGHT = 409;

const TRUNCATION_NOTE = "\n\n[Text shortened to fit one spreadsheet cell. The full text is on the platform.]";

/** Text that fits one Excel cell (longer text is cut and says so). */
export function clampCellText(text: string): string {
  if (text.length <= EXCEL_MAX_CELL_CHARS) return text;
  return text.slice(0, EXCEL_MAX_CELL_CHARS - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

/**
 * A calendar date for an Excel date cell: 'YYYY-MM-DD' or 'YYYY-MM' (the 1st) → a Date at UTC
 * midnight, which ExcelJS writes as that calendar day whatever the server's timezone.
 */
export function excelDate(value: string): Date {
  const { year, month } = parseMonthParts(value);
  const day = /^\d{4}-\d{2}-(\d{2})$/.exec(value)?.[1];
  return new Date(Date.UTC(year, month - 1, day ? Number(day) : 1));
}

const THIN_BORDER: Partial<Borders> = {
  top: { style: "thin", color: { argb: BORDER_ARGB } },
  left: { style: "thin", color: { argb: BORDER_ARGB } },
  bottom: { style: "thin", color: { argb: BORDER_ARGB } },
  right: { style: "thin", color: { argb: BORDER_ARGB } },
};

function solidFill(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Brand header: #E2743A fill, white bold text, thin borders, vertically centred and wrapped. */
export function styleHeaderCell(cell: Cell, alignment: Partial<Alignment> = {}): void {
  cell.fill = solidFill(BRAND_ARGB);
  cell.font = { bold: true, color: { argb: WHITE_ARGB } };
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: "middle", wrapText: true, ...alignment };
}

/** Styles cells `fromCol`..`toCol` (1-based, inclusive) of `row` as the brand header. */
export function styleHeaderRow(row: Row, fromCol: number, toCol: number, alignment: Partial<Alignment> = {}): void {
  for (let col = fromCol; col <= toCol; col++) styleHeaderCell(row.getCell(col), alignment);
  row.height = 30;
}

/** A light brand-tinted fill for label columns and subtotal (half-year) columns. */
export function styleSubtleCell(cell: Cell, options: { bold?: boolean } = {}): void {
  cell.fill = solidFill(SUBTLE_FILL_ARGB);
  if (options.bold) cell.font = { ...cell.font, bold: true };
}

/** Grey fill for "not included" cells (months that are not approved). */
export function styleMutedCell(cell: Cell): void {
  cell.fill = solidFill(MUTED_FILL_ARGB);
  cell.font = { ...cell.font, italic: true, color: { argb: NOTE_ARGB } };
}

/** Thin grey borders around a data cell. */
export function styleBodyCell(cell: Cell): void {
  cell.border = THIN_BORDER;
}

/** Sheet title (row 1 by convention): bold, larger. */
export function writeTitle(sheet: Worksheet, rowNumber: number, text: string): void {
  const cell = sheet.getRow(rowNumber).getCell(1);
  cell.value = text;
  const font: Partial<Font> = { bold: true, size: 14, color: { argb: TITLE_ARGB } };
  cell.font = font;
}

/** A small grey italic note line (not wrapped: it may run across empty cells). */
export function writeNote(sheet: Worksheet, rowNumber: number, text: string, col = 1): void {
  const cell = sheet.getRow(rowNumber).getCell(col);
  cell.value = text;
  cell.font = { italic: true, size: 9, color: { argb: NOTE_ARGB } };
}

/** Column widths in characters, from column 1. */
export function setColumnWidths(sheet: Worksheet, widths: readonly number[]): void {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

/**
 * Landscape A4, fitted to one page wide, with repeated title rows / columns and a footer naming the
 * workbook and the page.
 */
export function applyPrintSetup(
  sheet: Worksheet,
  options: { titleRows?: string; titleColumns?: string; footer?: string } = {},
): void {
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: "landscape",
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
    ...(options.titleRows ? { printTitlesRow: options.titleRows } : {}),
    ...(options.titleColumns ? { printTitlesColumn: options.titleColumns } : {}),
  };
  const footer = sanitizeCellText(options.footer ?? "").replace(/&/g, "&&");
  sheet.headerFooter = {
    ...sheet.headerFooter,
    oddFooter: `&L${footer}&RPage &P of &N`,
  };
}

/**
 * Estimated height (points) of a row whose cells wrap `text` in columns of `width` characters, so wrapped
 * narrative is readable even in viewers that do not auto-fit rows. Capped at Excel's maximum.
 */
export function estimateRowHeight(cells: readonly { text: string; width: number }[], minHeight = 15): number {
  let lines = 1;
  for (const { text, width } of cells) {
    const perLine = Math.max(8, Math.floor(width * 1.15));
    let count = 0;
    for (const paragraph of text.split("\n")) count += Math.max(1, Math.ceil(paragraph.length / perLine));
    lines = Math.max(lines, count);
  }
  return Math.min(EXCEL_MAX_ROW_HEIGHT, Math.max(minHeight, Math.ceil(lines * 13.5 + 4)));
}

/** Workbook properties shared by every export. */
export function setWorkbookProperties(workbook: Workbook, options: { title: string; created: Date }): void {
  workbook.creator = "ScaleUp Portfolio Reporting";
  workbook.lastModifiedBy = "ScaleUp Portfolio Reporting";
  workbook.company = "ScaleUp Malaysia";
  workbook.title = sanitizeCellText(options.title);
  workbook.created = options.created;
  workbook.modified = options.created;
}

// Characters XML 1.0 does not allow (Excel reports the file as damaged): C0 controls other than tab,
// line feed and carriage return, and the non-characters U+FFFE / U+FFFF.
const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Text safe for a spreadsheet cell: XML-invalid characters removed, lone surrogates replaced. */
export function sanitizeCellText(text: string): string {
  return text.replace(XML_INVALID_CHARS, "").toWellFormed();
}

/**
 * Cleans every text cell of the workbook (user-entered narrative may contain control characters pasted
 * from other documents) and cuts text longer than Excel allows in one cell.
 */
export function sanitizeWorkbookText(workbook: Workbook): void {
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value !== "string") return;
        const clean = clampCellText(sanitizeCellText(cell.value));
        if (clean !== cell.value) cell.value = clean;
      });
    });
  });
}

/** The finished workbook as bytes (for a Response body); text cells are sanitised first. */
export async function workbookBytes(workbook: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  sanitizeWorkbookText(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
