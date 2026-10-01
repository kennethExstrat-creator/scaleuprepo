/**
 * Condensed report of the last run: per flow pass / fail / flaky / skipped, the failing step with what
 * was expected and what happened (first attempt and retry), screenshots, notes, and the console errors,
 * page errors and server errors seen. Reads e2e/test-results/{results.json,failures.ndjson,observations.ndjson}.
 *
 *   npx tsx scripts/summarize.ts            # text
 *   npx tsx scripts/summarize.ts --json     # JSON
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { E2E_ROOT } from "../helpers/env";

type JsonResult = {
  status: string;
  retry: number;
  duration: number;
  errors?: { message?: string }[];
  attachments?: { name: string; path?: string; contentType: string }[];
};
type JsonTest = {
  projectName: string;
  status: "expected" | "unexpected" | "flaky" | "skipped";
  annotations?: { type: string; description?: string }[];
  results: JsonResult[];
};
type JsonSpec = { title: string; file: string; tests: JsonTest[] };
type JsonSuite = { title: string; file: string; specs?: JsonSpec[]; suites?: JsonSuite[] };

const dir = resolve(E2E_ROOT, "test-results");
const readNdjson = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    : [];

const report = JSON.parse(readFileSync(resolve(dir, "results.json"), "utf8")) as { suites: JsonSuite[]; stats?: unknown };
const failures = readNdjson<{ test: string; retry: number; step: string; expected: string; actual: string; screenshots: string[]; url: string | null }>(
  resolve(dir, "failures.ndjson"),
);
const observations = readNdjson<{ test: string; retry: number; who: string; kind: string; url: string; text: string }>(
  resolve(dir, "observations.ndjson"),
);

const specs: JsonSpec[] = [];
const walk = (suite: JsonSuite) => {
  for (const spec of suite.specs ?? []) specs.push(spec);
  for (const child of suite.suites ?? []) walk(child);
};
report.suites.forEach(walk);

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const summary = specs.map((spec) => {
  const t = spec.tests[0];
  const outcome =
    t.status === "expected" ? "pass" : t.status === "flaky" ? "flaky (failed, passed on retry)" : t.status === "skipped" ? "skipped" : "fail";
  const attempts = t.results.map((r) => ({
    retry: r.retry,
    status: r.status,
    seconds: Math.round(r.duration / 1000),
    error: r.errors?.[0]?.message ? strip(r.errors[0].message).split("\n").slice(0, 6).join("\n") : null,
    failedSteps: failures.filter((f) => f.test === spec.title && f.retry === r.retry),
    screenshots: (r.attachments ?? []).filter((a) => a.contentType === "image/png" && a.path).map((a) => a.path),
  }));
  const obs = observations.filter((o) => o.test === spec.title && o.kind !== "note");
  return {
    flow: spec.title,
    project: t.projectName,
    outcome,
    reproducedOnRetry: t.status === "unexpected" && t.results.length > 1,
    notes: (t.annotations ?? []).filter((a) => a.type === "note" || a.type === "skip").map((a) => a.description),
    attempts,
    observations: obs,
  };
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const s of summary) {
    console.log(`\n=== [${s.project}] ${s.flow}\n    outcome: ${s.outcome}${s.reproducedOnRetry ? " (reproduced on retry)" : ""}`);
    for (const n of s.notes) console.log(`    note: ${n}`);
    for (const a of s.attempts) {
      if (a.status === "passed" || a.status === "skipped") {
        console.log(`    attempt ${a.retry}: ${a.status} (${a.seconds}s)`);
        continue;
      }
      console.log(`    attempt ${a.retry}: ${a.status} (${a.seconds}s)`);
      for (const f of a.failedSteps) {
        console.log(`      step: ${f.step}\n      expected: ${f.expected}\n      actual: ${f.actual.split("\n").slice(0, 5).join(" | ")}`);
        console.log(`      url: ${f.url}\n      screenshots: ${f.screenshots.join(", ")}`);
      }
      if (a.failedSteps.length === 0 && a.error) console.log(`      error: ${a.error.split("\n").join(" | ")}`);
    }
    const byKind = new Map<string, number>();
    for (const o of s.observations) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
    if (byKind.size > 0) {
      console.log(`    observations: ${[...byKind].map(([k, n]) => `${k} x${n}`).join(", ")}`);
      for (const o of s.observations.slice(0, 12)) console.log(`      - [r${o.retry} ${o.who}] ${o.kind} ${o.url}: ${o.text.slice(0, 300)}`);
    }
  }
}
