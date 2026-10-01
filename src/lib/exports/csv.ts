// RFC 4180 CSV for the exports (BRD A13, §10 "Data extract"). Pure and client-safe.
//
// - Records end with CRLF; the file starts with a UTF-8 byte-order mark so Excel opens accented names
//   (and "—") correctly.
// - Fields that contain a comma, a double quote or a line break are enclosed in double quotes, with
//   quotes doubled.
// - Text a spreadsheet would run as a formula (starting with =, +, -, @, tab or CR) gets a leading
//   apostrophe ("CSV injection", OWASP). Numbers are written as plain decimals, never with an exponent.

/** A CSV cell: text, a number (plain decimal), or empty (null / undefined / non-finite numbers). */
export type CsvValue = string | number | null | undefined;

export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * A number as plain decimal text: 1234.5 → "1234.5", 1.2e-7 → "0.00000012", -0 → "0". With
 * `maxDecimals` the value is rounded first (1.23456 with 2 → "1.23"). Non-finite → "".
 */
export function plainNumber(value: number, maxDecimals?: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = maxDecimals === undefined ? value : roundTo(value, maxDecimals);
  let text = String(rounded + 0);
  if (/e/i.test(text)) {
    // Exponent notation (below 1e-6 or from 1e21): expand it. toFixed handles up to 100 decimals.
    text = Math.abs(rounded) >= 1e21 ? BigInt(Math.round(rounded)).toString() : rounded.toFixed(20);
    if (text.includes(".")) text = text.replace(/\.?0+$/, "");
  }
  return text === "-0" ? "0" : text;
}

/** Rounds half away from zero to `decimals` places (0–12), without 1.005 → 1.00 surprises. */
export function roundTo(value: number, decimals: number): number {
  const places = Math.min(12, Math.max(0, Math.trunc(decimals)));
  const factor = 10 ** places;
  const scaled = Math.abs(value) * factor;
  // Nudge by a relative epsilon so values such as 1.005 (stored as 1.00499999…) round up.
  const rounded = Math.round(scaled * (1 + Number.EPSILON)) / factor;
  return (value < 0 ? -rounded : rounded) + 0;
}

/** One field, escaped for CSV. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return plainNumber(value);
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One record (without the line ending). */
export function csvRecord(values: readonly CsvValue[]): string {
  return values.map(csvField).join(",");
}

/** Records joined with CRLF, each ending with CRLF (for streaming chunks after the first). */
export function csvLines(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((row) => csvRecord(row) + CSV_EOL).join("");
}

/** A whole CSV document: BOM (by default), header and rows, every record ending with CRLF. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  options: { bom?: boolean } = {},
): string {
  return (options.bom === false ? "" : CSV_BOM) + csvLines([header, ...rows]);
}
