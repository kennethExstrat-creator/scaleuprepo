/**
 * Reads a table of rows from a CSV or Excel file for scripts/import-history.ts: the first row is the
 * header, every later row is a record keyed by its header. Cells keep their type where the file has one
 * (Excel numbers, dates and booleans); CSV cells are text. Blank rows are skipped; each row remembers its
 * line (CSV, counting quoted line breaks) or row number (Excel) for error messages.
 *
 * Plain Node (tsx): no server-only imports. exceljs is already a dependency of the app.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

/** A cell as read: text, a number, a date (Excel), a boolean (Excel), or null when empty. */
export type CellValue = string | number | boolean | Date | null;

export type TableRow = {
  /** "<file name>:<line>" (CSV) or "<file name> row <n>" (Excel), for messages. */
  source: string;
  cells: Record<string, CellValue>;
};

export type Table = { file: string; headers: string[]; rows: TableRow[] };

export class TableError extends Error {}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields may contain commas, quotes ("") and line breaks; CRLF or LF)
// ---------------------------------------------------------------------------------------------

/** The records of a CSV text, each with the line it starts on. A leading UTF-8 BOM is ignored. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r" && input[i + 1] === "\n") {
      // CRLF: the \n ends the record.
    } else if (char === "\n" || char === "\r") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) throw new TableError(`A quoted value that starts on line ${recordLine} is never closed.`);
  if (field !== "" || fields.length > 0 || fieldStarted) endRecord();
  return records;
}

function isBlank(value: CellValue): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

/** Header names: trimmed, inner whitespace collapsed (e.g. "segment: Online"). */
export function cleanHeader(header: string): string {
  return header.replace(/\s+/g, " ").trim();
}

function toTable(file: string, headerLine: number, headers: string[], body: { label: string; values: CellValue[] }[]): Table {
  const cleaned = headers.map(cleanHeader);
  const seen = new Map<string, number>();
  cleaned.forEach((header, index) => {
    if (header === "") return;
    const key = header.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      throw new TableError(`${file}: the column "${header}" appears twice (columns ${first + 1} and ${index + 1}, header on line ${headerLine}).`);
    }
    seen.set(key, index);
  });
  const rows: TableRow[] = [];
  for (const record of body) {
    if (record.values.every(isBlank)) continue;
    const cells: Record<string, CellValue> = {};
    record.values.forEach((value, index) => {
      const header = cleaned[index];
      if (header === undefined || header === "") {
        if (!isBlank(value)) {
          throw new TableError(`${record.label}: a value in column ${index + 1}, which has no header.`);
        }
        return;
      }
      cells[header] = isBlank(value) ? null : value;
    });
    rows.push({ source: record.label, cells });
  }
  return { file, headers: cleaned.filter((header) => header !== ""), rows };
}

/** A CSV text as a table (the first non-blank record is the header). */
export function csvTable(file: string, text: string): Table {
  const records = parseCsv(text);
  const headerIndex = records.findIndex((record) => record.fields.some((field) => field.trim() !== ""));
  if (headerIndex < 0) throw new TableError(`${file} is empty.`);
  const header = records[headerIndex];
  return toTable(
    file,
    header.line,
    header.fields,
    records.slice(headerIndex + 1).map((record) => ({ label: `${file}:${record.line}`, values: record.fields })),
  );
}

// ---------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------

/** An exceljs cell value as a plain value (rich text joined, formulas by their result, links by text). */
export function excelCellValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: unknown }).result;
      if (result === undefined || result === null) return null;
      if (typeof result === "object" && "error" in (result as object)) {
        throw new TableError(`A formula in the file has an error (${String((result as { error: unknown }).error)}).`);
      }
      return excelCellValue(result as ExcelJS.CellValue);
    }
    if ("text" in value && typeof (value as { text: unknown }).text === "string") return (value as { text: string }).text;
    if ("error" in value) throw new TableError(`A cell in the file has an error (${String(value.error)}).`);
  }
  return String(value);
}

/** The first worksheet (or `sheetName`) of an Excel workbook as a table (the first non-blank row is the header). */
export async function excelTable(file: string, buffer: Buffer, sheetName?: string): Promise<Table> {
  const workbook = new ExcelJS.Workbook();
  // exceljs' load() is typed for its own Buffer interface; a Node Buffer works.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) {
    throw new TableError(sheetName ? `${file} has no sheet called "${sheetName}".` : `${file} has no sheets.`);
  }
  const rows: { number: number; values: CellValue[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: CellValue[] = [];
    for (let col = 1; col <= row.cellCount; col++) values.push(excelCellValue(row.getCell(col).value));
    rows.push({ number: rowNumber, values });
  });
  const headerIndex = rows.findIndex((row) => row.values.some((value) => !isBlank(value)));
  if (headerIndex < 0) throw new TableError(`${file} is empty.`);
  const header = rows[headerIndex];
  const headers = header.values.map((value) => (value === null ? "" : value instanceof Date ? value.toISOString() : String(value)));
  const width = Math.max(headers.length, ...rows.map((row) => row.values.length));
  while (headers.length < width) headers.push("");
  return toTable(
    file,
    header.number,
    headers,
    rows.slice(headerIndex + 1).map((row) => ({ label: `${file} row ${row.number}`, values: row.values })),
  );
}

/** Reads a .csv, .xlsx or .xlsm file as a table. */
export async function readTable(filePath: string, options: { sheet?: string } = {}): Promise<Table> {
  const name = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await readFile(filePath);
  if (extension === ".csv" || extension === ".txt") return csvTable(name, buffer.toString("utf8"));
  if (extension === ".xlsx" || extension === ".xlsm") return excelTable(name, buffer, options.sheet);
  throw new TableError(`${name}: use a .csv or .xlsx file (old .xls workbooks: save them as .xlsx first).`);
}
