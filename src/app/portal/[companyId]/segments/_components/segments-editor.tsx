"use client";

// The company owner's editor of the company's own revenue segments (BRD B30): rename in place, move up
// and down, remove (with undo until saved) and add, then save the whole list at once. Changing segments
// that are (or were) in use asks for confirmation with the comparability warning and what changes; a
// pure reorder and the very first set-up save directly. Names are checked as the database checks them;
// row errors show once a row has been left or after a save attempt. Each save sends the list the editor
// was opened with: if the segments changed since (a second tab, another owner), the save is refused and
// the owner reloads instead of overwriting what they did not see.

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListPlusIcon,
  PlusIcon,
  RotateCwIcon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
  UserCogIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormError } from "@/components/app/form-error";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGES, type ActionResult } from "@/lib/actions/result";
import { REVENUE_SEGMENT_CHANGE_WARNING, REVENUE_SEGMENT_NAME_MAX, REVENUE_SEGMENTS_MAX } from "@/lib/constants";
import {
  companySegmentListError,
  diffCompanySegments,
  normaliseSegmentName,
  type CompanySegmentChanges,
  type RevenueSegmentRow,
} from "@/lib/types/domain";
import { cn } from "@/lib/utils";
import { saveRevenueSegmentsAction, type SavedRevenueSegments, type SaveRevenueSegmentsInput } from "../actions";
import {
  changeCountsText,
  describeChanges,
  describeUsage,
  formatMonthList,
  keepVerb,
  needsComparabilityWarning,
  newNameIssue,
  openMonthsText,
  rowIssues,
  SEGMENTS_CHANGED_MESSAGE,
  toEditorItems,
  toSegmentInputs,
  usageOf,
  type EditorItem,
  type SegmentUsage,
} from "../_lib/segments-model";

/** More lines than this in "What changes" also get a count next to the heading (the list may scroll). */
const COUNTED_CHANGES = 3;

export type SegmentsEditorProps = {
  companyId: string;
  companyName: string;
  /** The company's segments in use, in order (`config.companySegments`). */
  current: RevenueSegmentRow[];
  /** The company had segments that are no longer used: any change then affects comparability too. */
  hasRetired: boolean;
  /** Months with figures per segment id. */
  usage: Record<string, SegmentUsage>;
  /** Months not submitted yet ('YYYY-MM'): they follow the segments saved here. */
  openMonths: string[];
  /**
   * (Optional) Who is editing: the company owner ("owner", the default) or ScaleUp on the owner's behalf
   * ("scaleup": the ScaleUp company page; the wording speaks about the company instead of "your").
   */
  audience?: SegmentsEditorAudience;
  /**
   * (Optional) The Server Action that saves the list: the owner's `saveRevenueSegmentsAction` by default;
   * the ScaleUp company page passes `saveCompanySegmentsOnBehalfAction` (Super Admin / Fund Admin, audited
   * as on behalf). Both take the same input.
   */
  saveAction?: (input: SaveRevenueSegmentsInput) => Promise<ActionResult<SavedRevenueSegments>>;
};

export type SegmentsEditorAudience = "owner" | "scaleup";

/** The editor; render it with `key={segmentsKey(current)}` so a save starts it again from the saved list. */
export function SegmentsEditor({
  companyId,
  companyName,
  current,
  hasRetired,
  usage,
  openMonths,
  audience = "owner",
  saveAction = saveRevenueSegmentsAction,
}: SegmentsEditorProps) {
  const onBehalf = audience === "scaleup";
  const router = useRouter();
  const baseId = useId();
  const [items, setItems] = useState<EditorItem[]>(() => toEditorItems(current));
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  /** Bumped when a save is refused, to bring the message (above the list) into view. */
  const [revealError, setRevealError] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(0);
  const addInput = useRef<HTMLInputElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const rowInputs = useRef(new Map<string, HTMLInputElement>());

  const inputs = useMemo(() => toSegmentInputs(items), [items]);
  const changes = useMemo(() => diffCompanySegments(current, inputs), [current, inputs]);
  const issues = useMemo(() => rowIssues(items), [items]);
  const listError = useMemo(() => companySegmentListError(inputs), [inputs]);
  const dirty = changes.changed;
  const firstSetUp = current.length === 0 && !hasRetired;
  const warn = needsComparabilityWarning(changes, current.length > 0 || hasRetired);
  const full = items.length >= REVENUE_SEGMENTS_MAX;

  // Leaving the page with unsaved changes asks first (browser prompt).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // A refused save: once the confirmation has closed (it hands focus back to "Save changes" without
  // scrolling), scroll the message above the list into view, with "Reload segments" when they changed.
  useEffect(() => {
    if (revealError === 0 || confirmOpen) return;
    const timer = window.setTimeout(() => errorBox.current?.scrollIntoView({ block: "nearest" }), 150);
    return () => window.clearTimeout(timer);
  }, [revealError, confirmOpen]);

  const rowId = (key: string) => `${baseId}-row-${key}`;

  function touch(key: string) {
    setTouched((set) => (set.has(key) ? set : new Set(set).add(key)));
  }

  function rename(key: string, name: string) {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, name } : item)));
    setFormError(null);
  }

  function move(index: number, delta: -1 | 1) {
    setItems((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setFormError(null);
  }

  function remove(item: EditorItem) {
    // Keep the keyboard focus nearby: the next row (else the previous one), else "Add a segment".
    const index = items.findIndex((entry) => entry.key === item.key);
    const neighbour = items[index + 1] ?? items[index - 1];
    setItems((list) => list.filter((entry) => entry.key !== item.key));
    setFormError(null);
    window.setTimeout(() => {
      const target = neighbour ? rowInputs.current.get(neighbour.key) : undefined;
      (target ?? addInput.current)?.focus();
    }, 0);
  }

  /** Puts a current segment that was removed back where it was. */
  function restore(segment: RevenueSegmentRow) {
    setItems((list) => {
      if (list.some((item) => item.id === segment.id)) return list;
      const at = Math.min(Math.max(current.findIndex((row) => row.id === segment.id), 0), list.length);
      const next = [...list];
      next.splice(at, 0, { key: segment.id, id: segment.id, name: segment.name });
      return next;
    });
    setFormError(null);
  }

  function add() {
    const issue = newNameIssue(newName, items);
    if (issue) {
      setNewNameError(issue);
      addInput.current?.focus();
      return;
    }
    const name = normaliseSegmentName(newName);
    // A segment removed above and typed in again is that segment (the database treats it the same way).
    const removed = changes.removed.find((segment) => segment.name.toLowerCase() === name.toLowerCase());
    if (removed) {
      restore(removed);
    } else {
      const key = `new-${nextKey.current++}`;
      setItems((list) => [...list, { key, id: null, name }]);
    }
    setNewName("");
    setNewNameError(null);
    setFormError(null);
    addInput.current?.focus();
  }

  function discard() {
    setItems(toEditorItems(current));
    setTouched(new Set());
    setAttempted(false);
    setNewName("");
    setNewNameError(null);
    setFormError(null);
  }

  function focusFirstProblem() {
    const index = issues.findIndex(Boolean);
    const item = index >= 0 ? items[index] : undefined;
    if (item) rowInputs.current.get(item.key)?.focus();
  }

  function showSaveError(message: string) {
    setFormError(message);
    setRevealError((count) => count + 1);
  }

  /** Saves the list; resolves to the message to show, or null when saved. */
  async function submit(): Promise<string | null> {
    let result: ActionResult<SavedRevenueSegments>;
    try {
      result = await saveAction({
        companyId,
        // What this editor started from: refused if someone saved other segments since.
        expected: current.map((segment) => ({ id: segment.id, name: segment.name })),
        segments: inputs.map((input) => ({ id: input.id ?? null, name: input.name })),
      });
    } catch {
      return MESSAGES.network;
    }
    if (!result.ok) return result.error;
    toast.success(firstSetUp ? "Revenue segments saved" : "Revenue segments updated", {
      description:
        result.data.segments.length === 0
          ? "Monthly updates now ask for total revenue directly."
          : onBehalf
            ? `${companyName}'s monthly updates not yet submitted use these segments.`
            : "Monthly updates not yet submitted use these segments.",
    });
    return null;
  }

  function save() {
    setAttempted(true);
    setFormError(null);
    if (!dirty) return;
    // Row problems are shown under each row; anything else in the database's own words.
    const problem = issues.some(Boolean) ? "Check the segment names below." : listError;
    if (problem) {
      setFormError(problem);
      focusFirstProblem();
      return;
    }
    if (warn) {
      setConfirmOpen(true);
      return;
    }
    startTransition(async () => {
      const message = await submit();
      if (message) showSaveError(message);
    });
  }

  function reload() {
    discard();
    startTransition(() => router.refresh());
  }

  const status = pending
    ? "Saving…"
    : !dirty
      ? current.length === 0
        ? "No segments yet."
        : "All changes saved."
      : changeCountText(changes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            {onBehalf
              ? firstSetUp
                ? `Set up ${companyName}'s revenue segments`
                : `${companyName}'s revenue segments`
              : firstSetUp
                ? "Set up your revenue segments"
                : "Your revenue segments"}
          </h2>
        </CardTitle>
        <CardDescription>
          {firstSetUp
            ? `Break ${companyName}'s total revenue down the way you run the business, for example by product, ` +
              "channel or market."
            : current.length === 0
              ? "No segments are in use, so monthly updates ask for total revenue directly. Add segments to report " +
                "revenue by segment again."
              : "Used in every monthly update, in this order. Total revenue is calculated from them."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {onBehalf ? <OnBehalfNote companyName={companyName} /> : null}
        {firstSetUp ? <FirstSetUpNote openMonths={openMonths} onBehalf={onBehalf} /> : null}

        {formError ? (
          <div ref={errorBox} className="flex scroll-mt-20 flex-col gap-2">
            <FormError id={`${baseId}-error`} message={formError} />
            {formError === SEGMENTS_CHANGED_MESSAGE ? (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={reload} disabled={pending}>
                  <RotateCwIcon data-icon="inline-start" />
                  Reload segments
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <ol className="divide-y rounded-lg border" aria-label="Revenue segments, in order">
            {items.map((item, index) => {
              const id = rowId(item.key);
              const issue = attempted || touched.has(item.key) ? issues[index] : null;
              const original = item.id ? current.find((segment) => segment.id === item.id) : undefined;
              const renamed = original !== undefined && original.name !== normaliseSegmentName(item.name);
              const label = normaliseSegmentName(item.name) || `segment ${index + 1}`;
              return (
                <li key={item.key} className="flex items-start gap-2 px-2 py-2.5 sm:gap-3 sm:px-3">
                  <span
                    className="mt-1.5 w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Input
                      id={id}
                      ref={(element) => {
                        if (element) rowInputs.current.set(item.key, element);
                        else rowInputs.current.delete(item.key);
                      }}
                      value={item.name}
                      maxLength={REVENUE_SEGMENT_NAME_MAX}
                      autoComplete="off"
                      aria-label={`Name of segment ${index + 1}`}
                      aria-invalid={issue ? true : undefined}
                      aria-describedby={issue ? `${id}-meta ${id}-error` : `${id}-meta`}
                      onChange={(event) => rename(item.key, event.target.value)}
                      onBlur={() => touch(item.key)}
                      className="bg-background"
                    />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {item.id === null ? <ToneBadge tone="info">New</ToneBadge> : null}
                      {renamed ? <ToneBadge tone="warning">Renamed</ToneBadge> : null}
                      <RowNote id={`${id}-meta`} item={item} original={original} renamed={renamed} usage={usage} />
                    </div>
                    {issue ? (
                      <p id={`${id}-error`} className="text-xs font-medium text-destructive">
                        {issue}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${label} up`}
                      title="Move up"
                      disabled={index === 0 || pending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${label} down`}
                      title="Move down"
                      disabled={index === items.length - 1 || pending}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${label}`}
                      title="Remove"
                      disabled={pending}
                      onClick={() => remove(item)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            {current.length > 0 || changes.removed.length > 0
              ? "No segments left. Monthly updates will ask for total revenue directly."
              : hasRetired
                ? "No segments in use. Add a segment below to report revenue by segment again."
                : "No segments yet. Add your first segment below."}
          </p>
        )}

        {changes.removed.length > 0 ? (
          <RemovedSegments removed={changes.removed} usage={usage} disabled={pending} onRestore={restore} />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${baseId}-new`}>Add a segment</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Input
              id={`${baseId}-new`}
              ref={addInput}
              value={newName}
              maxLength={REVENUE_SEGMENT_NAME_MAX}
              autoComplete="off"
              placeholder={items.length === 0 ? "For example: Subscriptions" : "Segment name"}
              disabled={full || pending}
              aria-invalid={newNameError ? true : undefined}
              aria-describedby={newNameError ? `${baseId}-new-error` : `${baseId}-new-help`}
              onChange={(event) => {
                setNewName(event.target.value);
                setNewNameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              className="bg-background sm:max-w-sm"
            />
            <Button
              type="button"
              variant="outline"
              onClick={add}
              disabled={full || pending || newName.trim() === ""}
            >
              <PlusIcon data-icon="inline-start" />
              Add segment
            </Button>
          </div>
          {newNameError ? (
            <p id={`${baseId}-new-error`} className="text-xs font-medium text-destructive">
              {newNameError}
            </p>
          ) : (
            <p id={`${baseId}-new-help`} className="text-xs text-muted-foreground">
              {full
                ? `You have the most segments allowed (${REVENUE_SEGMENTS_MAX}).`
                : "Added segments are saved with the rest of your changes."}
            </p>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {status}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={discard} disabled={!dirty || pending}>
            Discard changes
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!dirty || pending}
            aria-busy={pending || undefined}
            aria-describedby={formError ? `${baseId}-error` : undefined}
          >
            {pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {firstSetUp ? "Save segments" : "Save changes"}
          </Button>
        </div>
      </CardFooter>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={onBehalf ? `Change ${companyName}'s revenue segments?` : "Change your revenue segments?"}
        description={<ChangeSummary changes={changes} usage={usage} remaining={items.length} openMonths={openMonths} />}
        confirmLabel="Save changes"
        onConfirm={async () => {
          const message = await submit();
          if (message === null) return;
          showSaveError(message);
          // Changed elsewhere since the page was opened: close, so "Reload segments" is in reach. Any
          // other refusal stays in the dialog (and on the page once it is closed).
          if (message === SEGMENTS_CHANGED_MESSAGE) return;
          throw new Error(message);
        }}
      />
    </Card>
  );
}

function changeCountText(changes: CompanySegmentChanges): string {
  const count = changes.added.length + changes.removed.length + changes.renamed.length + (changes.reordered ? 1 : 0);
  return count === 1 ? "1 unsaved change." : `${count} unsaved changes.`;
}

/** ScaleUp staff editing a company's own segments: they act for the owner, and it is recorded. */
function OnBehalfNote({ companyName }: { companyName: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
      <UserCogIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-foreground/85">
        You are changing {companyName}&apos;s own segments on the owner&apos;s behalf. The audit log records the change
        as made on their behalf; let the owner know, as they normally manage these segments in the company portal.
      </p>
    </div>
  );
}

/** What the first set-up means for the monthly updates. */
function FirstSetUpNote({ openMonths, onBehalf }: { openMonths: string[]; onBehalf: boolean }) {
  const months = openMonthsText(openMonths);
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <ListPlusIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <ul className="flex list-disc flex-col gap-1 pl-4 text-foreground/85">
        <li>
          {onBehalf
            ? "The segments must add up to total revenue: each month the company enters revenue per segment, and total " +
              "revenue is calculated from them."
            : "Your segments must add up to total revenue: each month you enter revenue per segment, and total revenue " +
              "is calculated from them."}
        </li>
        <li>
          {onBehalf
            ? "They are reused every month, so the figures stay comparable over time. Change them only when the way the " +
              "company reports revenue changes."
            : "They are reused every month, so your figures stay comparable over time. Change them only when the way " +
              "you report revenue changes."}
        </li>
        <li>
          {months
            ? onBehalf
              ? `Once saved, the months not submitted yet (${months}) ask for revenue per segment.`
              : `Once saved, the months you haven't submitted yet (${months}) ask for revenue per segment.`
            : onBehalf
              ? "Once saved, the next monthly update asks for revenue per segment."
              : "Once saved, your next monthly update asks for revenue per segment."}{" "}
          Months already submitted are not changed.
        </li>
      </ul>
    </div>
  );
}

/** The usage note under a row, and what a rename does. */
function RowNote({
  id,
  item,
  original,
  renamed,
  usage,
}: {
  id: string;
  item: EditorItem;
  original: RevenueSegmentRow | undefined;
  renamed: boolean;
  usage: Record<string, SegmentUsage>;
}) {
  let text: string;
  if (item.id === null || !original) {
    text = "New: asked for from the months not yet submitted.";
  } else {
    const used = usageOf(usage, original.id);
    if (renamed && used.lockedMonths.length > 0) {
      const locked = `${formatMonthList(used.lockedMonths)} (already submitted) ${keepVerb(used.lockedMonths)}`;
      text = `Renamed from "${original.name}": continues as a new series. ${locked} "${original.name}".`;
    } else if (renamed) {
      text = `Renamed from "${original.name}". ${describeUsage(used)}.`;
    } else {
      text = `${describeUsage(used)}.`;
    }
  }
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {text}
    </p>
  );
}

/** Current segments removed in the editor: retired when saved, with undo until then. */
function RemovedSegments({
  removed,
  usage,
  disabled,
  onRestore,
}: {
  removed: RevenueSegmentRow[];
  usage: Record<string, SegmentUsage>;
  disabled: boolean;
  onRestore: (segment: RevenueSegmentRow) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Removed when you save</p>
      <p className="text-xs text-muted-foreground">
        Months already submitted keep these segments and their figures. Figures entered in months not yet submitted
        are cleared.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {removed.map((segment) => (
          <li key={segment.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm">
              <span className="font-medium line-through decoration-muted-foreground/60">{segment.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{describeUsage(usageOf(usage, segment.id))}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={() => onRestore(segment)}
              aria-label={`Undo removing ${segment.name}`}
            >
              <Undo2Icon data-icon="inline-start" />
              Undo
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The confirmation's text: the comparability warning (BRD B30) and each change. Inside the dialog's
 * description paragraph, so only inline elements (spans shown as blocks). The dialog has no height limit
 * of its own, so the list of changes is capped (it scrolls inside) to keep the warning and the dialog's
 * buttons on screen on a phone; long lists are also counted next to the heading.
 */
export function ChangeSummary({
  changes,
  usage,
  remaining,
  openMonths,
}: {
  changes: CompanySegmentChanges;
  usage: Record<string, SegmentUsage>;
  remaining: number;
  openMonths: string[];
}) {
  const lines = describeChanges(changes, usage, remaining);
  const months = openMonthsText(openMonths);
  const counts = lines.length > COUNTED_CHANGES ? changeCountsText(changes) : "";
  return (
    <>
      <span className="block">{REVENUE_SEGMENT_CHANGE_WARNING}</span>
      {months ? <span className="mt-2 block">Months not yet submitted: {months}.</span> : null}
      <span className="mt-3 block font-medium text-foreground">
        What changes
        {counts ? <span className="font-normal text-muted-foreground"> ({counts})</span> : null}
      </span>
      {/* On a phone the rest of the dialog (title, warning, months, stacked buttons and a possible error
          line) takes up to about 29rem: the list gets what is left of the screen, at most 40% of it and
          at least 5rem. */}
      <span
        data-slot="segment-changes"
        className="mt-1.5 block max-h-[clamp(5rem,100svh_-_29rem,40svh)] overflow-y-auto overscroll-contain rounded-md border bg-background/60 px-2.5 py-2 text-left"
      >
        {lines.map((line, index) => (
          <span key={line.title} className={cn("block", index > 0 && "mt-1.5")}>
            <span className="block text-foreground">{line.title}</span>
            {line.detail ? <span className="block text-xs">{line.detail}</span> : null}
          </span>
        ))}
      </span>
    </>
  );
}
