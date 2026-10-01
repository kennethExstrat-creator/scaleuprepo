// Pure model of the company revenue segments page (/portal/[companyId]/segments, BRD B30): which months
// hold figures for each segment, month spans for display, the editor's per-row checks, and what saving
// an edited list would change (the comparability warning lists it). The database is the source of truth
// (`set_company_revenue_segments`); `companySegmentListError` / `diffCompanySegments` in
// @/lib/types/domain mirror it, and these helpers only phrase things for the screen. Client-safe;
// unit-tested in tests/features/seg.

import { REVENUE_SEGMENT_NAME_MAX, REVENUE_SEGMENTS_MAX } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  addMonths,
  compareMonths,
  dateToMonthKey,
  isMonthKey,
  MONTH_NAMES_SHORT,
  monthLabel,
  parseMonthParts,
} from "@/lib/periods";
import {
  normaliseSegmentName,
  type CompanySegmentChanges,
  type CompanySegmentInput,
  type RevenueSegmentRow,
} from "@/lib/types/domain";
import type { SubmissionStatus } from "@/lib/types/enums";

/**
 * The refusal when the company's segments changed after the page was opened (another tab, another
 * owner): the database's own words for ids that are no longer current, also used by the Server Action's
 * check of the list the editor was opened with. The editor offers "Reload segments" for it.
 */
export const SEGMENTS_CHANGED_MESSAGE =
  "The revenue segments have changed since this page was opened. Reload the page and try again.";

// ---------------------------------------------------------------------------------------------
// Which months use a segment
// ---------------------------------------------------------------------------------------------

/** The months with a figure for one segment ('YYYY-MM', oldest first). */
export type SegmentUsage = {
  months: string[];
  /** Submitted or approved months: they keep the segment's name and figure whatever changes. */
  lockedMonths: string[];
  /** Months still open for changes (not submitted yet, or sent back): they follow the current segments. */
  openMonths: string[];
};

/** One stored amount (`submission_segment_values`). */
export type SegmentFigure = { segment_id: string; submission_id: string; amount: number | null };

/** One month of the company (`v_submission_overview` / `submissions`). */
export type MonthStatus = { id: string; month: string; status: SubmissionStatus };

export const NO_USAGE: SegmentUsage = { months: [], lockedMonths: [], openMonths: [] };

const LOCKED_STATUSES: ReadonlySet<SubmissionStatus> = new Set<SubmissionStatus>(["submitted", "approved"]);

function sortedMonths(months: Iterable<string>): string[] {
  return [...new Set(months)].sort(compareMonths);
}

/**
 * Months with a figure per segment id: amounts that are null, or that belong to a month the caller cannot
 * see, are ignored. Segments without figures are absent (use `usageOf`).
 */
export function buildSegmentUsage(
  figures: ReadonlyArray<SegmentFigure>,
  submissions: ReadonlyArray<MonthStatus>,
): Record<string, SegmentUsage> {
  const byId = new Map(submissions.map((row) => [row.id, row] as const));
  const collected = new Map<string, { months: Set<string>; locked: Set<string>; open: Set<string> }>();
  for (const figure of figures) {
    if (typeof figure.amount !== "number" || !Number.isFinite(figure.amount)) continue;
    const submission = byId.get(figure.submission_id);
    if (!submission) continue;
    const month = dateToMonthKey(submission.month);
    const entry = collected.get(figure.segment_id) ?? { months: new Set(), locked: new Set(), open: new Set() };
    entry.months.add(month);
    (LOCKED_STATUSES.has(submission.status) ? entry.locked : entry.open).add(month);
    collected.set(figure.segment_id, entry);
  }
  const usage: Record<string, SegmentUsage> = {};
  for (const [id, entry] of collected) {
    usage[id] = {
      months: sortedMonths(entry.months),
      lockedMonths: sortedMonths(entry.locked),
      openMonths: sortedMonths(entry.open),
    };
  }
  return usage;
}

/** The usage of one segment (none when it has no figures). */
export function usageOf(usage: Readonly<Record<string, SegmentUsage>>, segmentId: string): SegmentUsage {
  return usage[segmentId] ?? NO_USAGE;
}

/** The valid months ('YYYY-MM'; days ignored), oldest first, each once. */
function validMonths(months: ReadonlyArray<string>): string[] {
  return sortedMonths(months.map((month) => month.slice(0, 7)).filter((month) => isMonthKey(month)));
}

/**
 * The months as a span: 'Sep 2026', 'Jul–Sep 2026' (same year) or 'Nov 2026 – Feb 2027'; '' for none.
 * Gaps are not shown: pair it with a count (as `describeUsage` does), or use `formatMonthList`.
 */
export function formatMonthSpan(months: ReadonlyArray<string>): string {
  const valid = validMonths(months);
  if (valid.length === 0) return "";
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (first === last) return monthLabel(first);
  const a = parseMonthParts(first);
  const b = parseMonthParts(last);
  if (a.year === b.year) return `${MONTH_NAMES_SHORT[a.month - 1]}–${MONTH_NAMES_SHORT[b.month - 1]} ${a.year}`;
  return `${monthLabel(first)} – ${monthLabel(last)}`;
}

function monthCount(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"}`;
}

/** 'A', 'A and B', 'A, B and C'. */
function joinWithAnd(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The months for a sentence, never implying a month that is not there: months that follow each other as
 * a span ('Sep 2026', 'Jul–Sep 2026'); with a gap, each month while there are at most three ('Jul 2026
 * and Sep 2026'), else the count ('4 months between Jun and Oct 2026'). A month in the middle can be open
 * while those around it are submitted (ScaleUp sent it back), so lists of submitted or open months can
 * have gaps. '' for none.
 */
export function formatMonthList(months: ReadonlyArray<string>): string {
  const valid = validMonths(months);
  if (valid.length === 0) return "";
  const contiguous = valid.every((month, i) => i === 0 || addMonths(valid[i - 1], 1) === month);
  if (contiguous) return formatMonthSpan(valid);
  if (valid.length <= 3) return joinWithAnd(valid.map((month) => monthLabel(month)));
  const first = parseMonthParts(valid[0]);
  const last = parseMonthParts(valid[valid.length - 1]);
  const from = first.year === last.year ? MONTH_NAMES_SHORT[first.month - 1] : monthLabel(valid[0]);
  return `${monthCount(valid.length)} between ${from} and ${monthLabel(valid[valid.length - 1])}`;
}

/** 'Figures in 3 months (Jul–Sep 2026)', or 'No figures yet'. */
export function describeUsage(usage: SegmentUsage): string {
  if (usage.months.length === 0) return "No figures yet";
  return `Figures in ${monthCount(usage.months.length)} (${formatMonthSpan(usage.months)})`;
}

/**
 * How a retired segment is shown in "No longer used": when it was used and when it was retired, e.g.
 * { used: 'Used in Jul–Aug 2026', retired: 'Retired 1 Oct 2026' } ('Never used' without figures).
 */
export function describeRetired(
  segment: Pick<RevenueSegmentRow, "retired_at">,
  usage: SegmentUsage,
): { used: string; retired: string | null } {
  const used = usage.months.length === 0 ? "Never used" : `Used in ${formatMonthList(usage.months)}`;
  return { used, retired: segment.retired_at ? `Retired ${formatDate(segment.retired_at)}` : null };
}

// ---------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------

/** One row of the editor: a current segment (`id`) or a new one (`id` null). `key` is stable while editing. */
export type EditorItem = { key: string; id: string | null; name: string };

/** The editor rows of the company's current segments, in order. */
export function toEditorItems(segments: ReadonlyArray<Pick<RevenueSegmentRow, "id" | "name">>): EditorItem[] {
  return segments.map((segment) => ({ key: segment.id, id: segment.id, name: segment.name }));
}

/** The list `set_company_revenue_segments` takes (names trimmed as the database stores them). */
export function toSegmentInputs(items: ReadonlyArray<EditorItem>): CompanySegmentInput[] {
  return items.map((item) => {
    const name = normaliseSegmentName(item.name);
    return item.id ? { id: item.id, name } : { name };
  });
}

/** A key that changes whenever the saved segments change (names, order): remounts the editor after a save. */
export function segmentsKey(segments: ReadonlyArray<Pick<RevenueSegmentRow, "id" | "name">>): string {
  return segments.map((segment) => `${segment.id}:${segment.name}`).join("|");
}

/**
 * Whether the segments in use now are exactly those an editor was opened with: the same ids (ignoring
 * case), names and order. When they differ, someone saved in between (a second tab, another owner) and
 * the edited list must not be saved: it would retire segments the editor never showed (clearing their
 * figures in months not yet submitted) or undo their renames without any warning.
 */
export function sameSegmentList(
  expected: ReadonlyArray<Pick<RevenueSegmentRow, "id" | "name">>,
  actual: ReadonlyArray<Pick<RevenueSegmentRow, "id" | "name">>,
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (segment, i) => segment.id.toLowerCase() === actual[i].id.toLowerCase() && segment.name === actual[i].name,
    )
  );
}

function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 1 && code <= 0x1f) || code === 0x7f) return true;
  }
  return false;
}

/** The problem with one name on its own (blank, too long, line breaks or tabs), or null. */
export function nameIssue(name: string): string | null {
  const trimmed = normaliseSegmentName(name);
  if (trimmed === "") return "Enter a name for this segment.";
  if ([...trimmed].length > REVENUE_SEGMENT_NAME_MAX) return `Use at most ${REVENUE_SEGMENT_NAME_MAX} characters.`;
  if (hasControlCharacter(trimmed)) return "Names can't contain line breaks or tabs.";
  return null;
}

/**
 * The problem of each row, in order (null when fine): its own name, else a name used by an earlier row
 * (ignoring case), the way the database compares them.
 */
export function rowIssues(items: ReadonlyArray<Pick<EditorItem, "name">>): (string | null)[] {
  const seen = new Set<string>();
  return items.map((item) => {
    const own = nameIssue(item.name);
    if (own) return own;
    const key = normaliseSegmentName(item.name).toLowerCase();
    if (seen.has(key)) return `Another segment is already called "${normaliseSegmentName(item.name)}".`;
    seen.add(key);
    return null;
  });
}

/** The problem with a name typed into "Add a segment" (given the rows already listed), or null. */
export function newNameIssue(name: string, items: ReadonlyArray<Pick<EditorItem, "name">>): string | null {
  if (items.length >= REVENUE_SEGMENTS_MAX) return `You can have at most ${REVENUE_SEGMENTS_MAX} revenue segments.`;
  const own = nameIssue(name);
  if (own) return own;
  const key = normaliseSegmentName(name).toLowerCase();
  const taken = items.find((item) => normaliseSegmentName(item.name).toLowerCase() === key);
  return taken ? `There's already a segment called "${normaliseSegmentName(taken.name)}".` : null;
}

/**
 * Whether saving needs the comparability warning (BRD B30): something is added, removed or renamed while
 * the company has, or had, segments of its own. A pure reorder, and the very first set-up, save directly.
 */
export function needsComparabilityWarning(changes: CompanySegmentChanges, hadSegments: boolean): boolean {
  return changes.affectsComparability && hadSegments;
}

/** One line of "What changes" in the warning. */
export type ChangeSummaryItem = { title: string; detail?: string };

function quoted(name: string): string {
  return `"${name}"`;
}

/** "keeps" after one month ("Jul 2026 keeps"), "keep" after several ("Jul–Aug 2026 keep"). */
export function keepVerb(months: ReadonlyArray<string>): string {
  return months.length === 1 ? "keeps" : "keep";
}

/**
 * What saving would change, for the warning dialog: renames (a new series when the segment has figures in
 * submitted months, which keep the old name, while the figures of months not yet submitted move to the
 * new name), removals (submitted months keep the figures; figures in months not yet submitted are
 * cleared), additions and the order; and that monthly updates ask for total revenue directly when no
 * segment is left. Months are listed with `formatMonthList`, so a month sent back between two submitted
 * ones is never described as submitted.
 */
export function describeChanges(
  changes: CompanySegmentChanges,
  usage: Readonly<Record<string, SegmentUsage>>,
  remaining: number,
): ChangeSummaryItem[] {
  const items: ChangeSummaryItem[] = [];
  for (const { segment, name } of changes.renamed) {
    const used = usageOf(usage, segment.id);
    let detail = "Months not yet submitted show the new name.";
    if (used.lockedMonths.length > 0) {
      detail =
        `It continues as a new series: ${formatMonthList(used.lockedMonths)} (already submitted) ` +
        `${keepVerb(used.lockedMonths)} ${quoted(segment.name)}.`;
      if (used.openMonths.length > 0) {
        detail += ` Its figures in ${formatMonthList(used.openMonths)} (not submitted yet) move to ${quoted(name)}.`;
      }
    }
    items.push({ title: `Rename ${quoted(segment.name)} to ${quoted(name)}`, detail });
  }
  for (const segment of changes.removed) {
    const used = usageOf(usage, segment.id);
    const parts: string[] = [];
    if (used.lockedMonths.length > 0) {
      parts.push(`${formatMonthList(used.lockedMonths)} (already submitted) ${keepVerb(used.lockedMonths)} its figures.`);
    }
    if (used.openMonths.length > 0) {
      parts.push(`Its figures in ${formatMonthList(used.openMonths)} (not submitted yet) will be cleared.`);
    }
    items.push({ title: `Remove ${quoted(segment.name)}`, detail: parts.length > 0 ? parts.join(" ") : undefined });
  }
  if (changes.added.length > 0) {
    items.push({
      title: `Add ${changes.added.map(quoted).join(", ")}`,
      detail: "Months not yet submitted will ask for revenue for the new segments.",
    });
  }
  if (changes.reordered) items.push({ title: "Change the order of the segments" });
  if (remaining === 0) {
    items.push({
      title: "No segments left",
      detail: "Monthly updates will ask for total revenue directly.",
    });
  }
  return items;
}

/**
 * The changes counted, for a long confirmation: '2 renamed, 1 removed and 3 added', plus 'a new order'
 * when the segments that stay move. '' when nothing changes.
 */
export function changeCountsText(changes: CompanySegmentChanges): string {
  const parts: string[] = [];
  if (changes.renamed.length > 0) parts.push(`${changes.renamed.length} renamed`);
  if (changes.removed.length > 0) parts.push(`${changes.removed.length} removed`);
  if (changes.added.length > 0) parts.push(`${changes.added.length} added`);
  if (changes.reordered) parts.push("a new order");
  return joinWithAnd(parts);
}

/** 'Sep 2026' / 'Aug–Sep 2026': the months that would follow a change (shown with the warning). */
export function openMonthsText(openMonths: ReadonlyArray<string>): string {
  if (openMonths.length === 0) return "";
  if (openMonths.length <= 3) return openMonths.map((month) => monthLabel(month)).join(", ");
  return `${monthCount(openMonths.length)} (${formatMonthSpan(openMonths)})`;
}
