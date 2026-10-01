import { describe, expect, it } from "vitest";

import { CSV_BOM, csvField, csvLines, csvRecord, plainNumber, roundTo, toCsv } from "@/lib/exports/csv";

describe("csvField (RFC 4180)", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvField("Batik Boutique")).toBe("Batik Boutique");
    expect(csvField(1234.5)).toBe("1234.5");
    expect(csvField(-500)).toBe("-500");
    expect(csvField(0)).toBe("0");
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvField("Docspe, Plexis.ai")).toBe('"Docspe, Plexis.ai"');
    expect(csvField('The "Row"')).toBe('"The ""Row"""');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("writes empty fields for missing and non-finite values", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(Number.NaN)).toBe("");
    expect(csvField(Number.POSITIVE_INFINITY)).toBe("");
    expect(csvField("")).toBe("");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvField("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvField("+60123")).toBe("'+60123");
    expect(csvField("-5 cameras")).toBe("'-5 cameras");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("\tcmd")).toBe("'\tcmd");
    // Numbers are numbers: a negative figure stays a plain negative number.
    expect(csvField(-12.5)).toBe("-12.5");
  });
});

describe("numbers", () => {
  it("never uses exponent notation", () => {
    expect(plainNumber(1.2e-7)).toBe("0.00000012");
    expect(plainNumber(123456789012.34)).toBe("123456789012.34");
    expect(plainNumber(-0)).toBe("0");
    expect(plainNumber(1e21)).toBe("1000000000000000000000");
  });

  it("rounds half away from zero", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(46.66666, 2)).toBe(46.67);
    expect(roundTo(0.1 + 0.2, 4)).toBe(0.3);
    expect(plainNumber(2.5, 0)).toBe("3");
  });
});

describe("documents", () => {
  it("starts with a BOM and ends every record with CRLF", () => {
    const csv = toCsv(["Company", "Revenue"], [
      ["Batik Boutique", 1000],
      ["E.R.T.H", null],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}Company,Revenue\r\nBatik Boutique,1000\r\nE.R.T.H,\r\n`);
  });

  it("can leave the BOM out (streamed chunks)", () => {
    expect(toCsv(["a"], [], { bom: false })).toBe("a\r\n");
    expect(csvLines([["x", 1], ["y", 2]])).toBe("x,1\r\ny,2\r\n");
    expect(csvRecord(["a,b", 3])).toBe('"a,b",3');
  });
});
