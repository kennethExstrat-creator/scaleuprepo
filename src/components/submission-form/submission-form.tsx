"use client";

// The monthly update form (module M5: C3 monthly update, C6 review and submit, Fund Admin on-behalf entry).
// Cross-module contract: docs/ARCHITECTURE.md §5.7 (props below; optional props added by M5 are marked).
// Rendered by /portal/[companyId]/updates/[month] (mode "company" / "readonly") and
// /admin/companies/[companyId]/updates/[month] (mode "on_behalf" / "readonly").
//
// Structure: sections in template order (financials with the revenue area — the company's own revenue
// segments adding up to a calculated total, or total revenue entered directly, plus ScaleUp's revenue lines
// that need not add up (BRD B30, revenue.tsx) — and live metrics, headcount, the company KPI grid,
// additional numbers, narrative accordions per C4 category with last month's entry, founder pulse),
// autosave through the saveSubmissionValues Server Action (draft-store.ts), live checks
// with validateSubmissionDraft (the §2.6 mirror), and "Review and submit" (server check, declaration,
// submit_submission) for company owners.

import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import type { CommentMode } from "@/components/comments/comment-threads";
import { Button } from "@/components/ui/button";
import { saveSubmissionValues } from "@/lib/actions/submission";
import { toFiniteNumber } from "@/lib/format";
import { monthLabel, monthLabelLong, todayMYT } from "@/lib/periods";
import { fieldTarget, parseTarget, segmentTarget } from "@/lib/targets";
import {
  flattenTemplateFields,
  toValidationInput,
  type SubmissionBundle,
  type TemplateFieldRow,
  type TemplateSectionFull,
} from "@/lib/types/domain";
import type { FieldType, KpiValueType } from "@/lib/types/enums";
import { groupIssuesByTarget, kpiCellsForMonth, validateSubmissionDraft } from "@/lib/validation";

import { StatusBanners } from "./banners";
import { ActivityCard, NumbersCheck } from "./checklist";
import { isEmptyFieldDraft, reconcileWithCompanySegments, toDraftValues, withFieldValue } from "./draft";
import { DraftStore } from "./draft-store";
import { FormContextProvider, type FormContextValue } from "./form-context";
import { FormHeader } from "./form-header";
import {
  commentTargetLabels,
  isEditableStatus,
  isOverdueSubmission,
  targetDomId,
  totalUnresolved,
} from "./presentation";
import { ReviewSubmitDialog } from "./review-dialog";
import { FieldsSection, FinancialsSection, KpiSection, NarrativeGroup, PulseSection } from "./sections";

/**
 * `company`: a company owner or contributor editing their own month; `on_behalf`: a Fund Admin entering
 * data for the company (audited as on behalf); `readonly`: nothing can be edited (submitted or approved
 * months, viewers, exited or written-off companies).
 */
export type SubmissionFormMode = "company" | "on_behalf" | "readonly";

export type SubmissionFormProps = {
  /** getSubmissionBundle / getSubmissionBundleByMonth (src/lib/data); plain JSON, safe to pass from a Server Component. */
  bundle: SubmissionBundle;
  mode: SubmissionFormMode;
  /** Show the owner declaration and the submit button (canSubmit(ctx, companyId) and the month is draft / changes_requested). */
  canSubmit: boolean;
  /** Field comment buttons for this audience; null hides them. */
  commentMode: CommentMode | null;
  /** Comment threads per target (docs/ARCHITECTURE.md §2.5), for the field comment buttons. */
  commentCounts?: Record<string, { total: number; unresolved: number }>;
  /**
   * (Optional, added by M5.) ScaleUp staff who may start threads (`canComment(ctx)`); ignored for company
   * users, who only reply. Default false.
   */
  canStartThreads?: boolean;
  /**
   * (Optional, added by M5.) Earlier months that are still drafts ('YYYY-MM'): shown as "Submit … first"
   * while the month can be edited (months are submitted in order, BRD B5).
   */
  earlierDrafts?: string[];
};

/** The monthly update form: numbers, headcount, KPI grid, narrative and founder pulse, with autosave. */
export function SubmissionForm(props: SubmissionFormProps): JSX.Element {
  const { bundle, mode } = props;
  // A different month, mode or status starts from the server values again.
  return <SubmissionFormView key={`${bundle.submission.id}:${mode}:${bundle.submission.status}`} {...props} />;
}

// ---------------------------------------------------------------------------------------------

type Block = { kind: "section"; section: TemplateSectionFull } | { kind: "narrative"; sections: TemplateSectionFull[] };

/** Sections in template order; consecutive narrative sections (C4 categories) share one card. */
function buildBlocks(sections: TemplateSectionFull[]): Block[] {
  const blocks: Block[] = [];
  for (const section of sections) {
    const last = blocks[blocks.length - 1];
    if (section.kind === "narrative" && last?.kind === "narrative") last.sections.push(section);
    else if (section.kind === "narrative") blocks.push({ kind: "narrative", sections: [section] });
    else blocks.push({ kind: "section", section });
  }
  return blocks;
}

function createDraftStore(bundle: SubmissionBundle, editable: boolean): DraftStore {
  const saved = toDraftValues(bundle.current);
  // With the company's own revenue segments (BRD B30), total revenue is their sum; a stale stored total
  // (e.g. after the owner removed a segment) is corrected and saved. ScaleUp revenue lines never count.
  const initial = editable ? reconcileWithCompanySegments(saved, bundle.config) : saved;
  const fieldTypes: Record<string, FieldType> = {};
  for (const field of flattenTemplateFields(bundle.template)) fieldTypes[field.key] = field.field_type;
  const kpiTypes: Record<string, KpiValueType> = {};
  for (const kpi of bundle.config.kpis) kpiTypes[kpi.id] = kpi.value_type;
  const submissionId = bundle.submission.id;

  return new DraftStore({
    initial,
    saved,
    lastSavedAt: bundle.submission.last_saved_at,
    types: { fieldTypes, kpiTypes },
    enabled: editable,
    save: async (payload) => {
      const result = await saveSubmissionValues({ submissionId, ...payload });
      return result.ok ? { ok: true, savedAt: result.data.savedAt } : { ok: false, error: result.error };
    },
  });
}

const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), button:not([disabled])";

/** Scrolls to the input of a target and focuses it (the first button of a button group). */
function focusTarget(target: string): void {
  const element = document.getElementById(targetDomId(target));
  if (!element) return;
  const focusable =
    element.matches(FOCUSABLE) || element.hasAttribute("tabindex")
      ? element
      : (element.querySelector<HTMLElement>(FOCUSABLE) ?? element);
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  focusable.focus({ preventScroll: true });
}

function SubmissionFormView({
  bundle,
  mode,
  canSubmit,
  commentMode,
  commentCounts,
  canStartThreads = false,
  earlierDrafts = [],
}: SubmissionFormProps) {
  const router = useRouter();
  const { submission, company } = bundle;
  const editable = mode !== "readonly" && isEditableStatus(submission.status);
  const audience: CommentMode = commentMode ?? (mode === "on_behalf" ? "scaleup" : "company");
  const currency = company.reporting_currency.trim() || "MYR";
  const month = monthLabelLong(submission.month);
  const monthHrefBase =
    audience === "scaleup" ? `/admin/companies/${company.id}/updates` : `/portal/${company.id}/updates`;
  const today = todayMYT();

  // --- Draft and autosave ---------------------------------------------------------------------
  const [store] = useState(() => createDraftStore(bundle, editable));
  /** Set when the person chose to reload after a failed save (no "unsaved changes" prompt then). */
  const reloading = useRef(false);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Newer server values (the page re-rendered after a save, a co-worker's edits) replace untouched entries.
  // The company's revenue segments may have changed too since the form opened (BRD B30: the owner removed
  // or renamed one on the segments page): total revenue then follows the segments now in use, and the
  // corrected total is autosaved like any other change (update() does nothing when it is already right).
  useEffect(() => {
    store.syncFromServer(toDraftValues(bundle.current), bundle.submission.last_saved_at);
    if (editable) store.update((draft) => reconcileWithCompanySegments(draft, bundle.config));
  }, [store, bundle, editable]);

  useEffect(() => {
    store.start();
    return () => {
      // Leaving the page (e.g. a sidebar link): send what is pending.
      void store.flush();
      store.stop();
    };
  }, [store]);

  useEffect(() => {
    if (!editable) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (reloading.current || !store.hasUnsavedWork()) return;
      void store.flush();
      event.preventDefault();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void store.flush();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store, editable]);

  // --- Validation -----------------------------------------------------------------------------
  const kpiCells = useMemo(() => kpiCellsForMonth(toValidationInput(bundle)), [bundle]);
  const issues = useMemo(
    () => (editable ? validateSubmissionDraft(toValidationInput(bundle, snapshot.draft)) : []),
    [bundle, editable, snapshot.draft],
  );
  const issuesByTarget = useMemo(() => groupIssuesByTarget(issues), [issues]);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);

  const touch = useCallback((target: string) => {
    setTouched((current) => (current.has(target) ? current : new Set(current).add(target)));
  }, []);

  const errorFor = (target: string): string | null => {
    if (!editable || !(attempted || touched.has(target))) return null;
    return snapshot.invalid[target] ?? issuesByTarget[target]?.[0]?.message ?? null;
  };

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of bundle.template.sections) {
      for (const field of section.fields) map.set(fieldTarget(field.key), field.label);
    }
    for (const segment of bundle.config.segments) map.set(segmentTarget(segment.id), `Revenue for ${segment.name}`);
    for (const cell of kpiCells) map.set(cell.target, cell.label);
    return map;
  }, [bundle, kpiCells]);
  const labelFor = useCallback((target: string) => labels.get(target) ?? "this field", [labels]);
  const unreadable = useMemo(() => Object.entries(snapshot.invalid), [snapshot.invalid]);

  // --- Narrative accordions and jump links ------------------------------------------------------
  const blocks = useMemo(() => buildBlocks(bundle.template.sections), [bundle.template.sections]);
  const narrativeSectionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of bundle.template.sections) {
      if (section.kind !== "narrative") continue;
      for (const field of section.fields) map.set(field.key, section.key);
    }
    return map;
  }, [bundle.template.sections]);
  const [openSections, setOpenSections] = useState<string[]>(() =>
    bundle.template.sections
      .filter((section) => section.kind === "narrative")
      .filter((section) =>
        section.fields.some((field) => !isEmptyFieldDraft(store.getSnapshot().draft.values[field.key])),
      )
      .map((section) => section.key),
  );

  const jumpTo = useCallback(
    (target: string) => {
      touch(target);
      const parsed = parseTarget(target);
      const sectionKey = parsed.kind === "field" ? narrativeSectionOf.get(parsed.fieldKey) : undefined;
      if (sectionKey) setOpenSections((current) => (current.includes(sectionKey) ? current : [...current, sectionKey]));
      // Let an accordion open first.
      window.setTimeout(() => focusTarget(target), 80);
    },
    [narrativeSectionOf, touch, setOpenSections],
  );

  // --- Copy last month --------------------------------------------------------------------------
  const [copyRequest, setCopyRequest] = useState<TemplateFieldRow | null>(null);
  const applyCopy = useCallback(
    (field: TemplateFieldRow) => {
      const stored = bundle.previous?.values.values[field.key];
      if (!stored) return;
      store.update((current) =>
        withFieldValue(current, field.key, {
          value_number: toFiniteNumber(stored.value_number),
          value_text: stored.value_text,
          value_json: stored.value_json,
        }),
      );
    },
    [bundle.previous, store],
  );
  const copyLastMonth = useCallback(
    (field: TemplateFieldRow) => {
      if (isEmptyFieldDraft(store.getSnapshot().draft.values[field.key])) applyCopy(field);
      else setCopyRequest(field);
    },
    [applyCopy, store, setCopyRequest],
  );

  // --- Review and submit ------------------------------------------------------------------------
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewUnreadable, setReviewUnreadable] = useState<[string, string][]>([]);
  const showSubmit = editable && mode === "company" && canSubmit;

  const openReview = () => {
    setAttempted(true);
    setReviewUnreadable(Object.entries(store.getSnapshot().invalid));
    setReviewOpen(true);
  };

  const onSubmitted = () => {
    setReviewOpen(false);
    toast.success(`${month} submitted`, {
      description: "ScaleUp will review it and let you know if anything needs to change.",
    });
    // submitSubmission revalidated the form, the list and the home page, so the list loads fresh.
    router.push(`/portal/${company.id}/updates`);
  };

  const submitButton = showSubmit ? (
    <Button type="button" size="sm" onClick={openReview}>
      <SendIcon data-icon="inline-start" />
      Review and submit
    </Button>
  ) : null;
  const submitNote =
    editable && mode === "company" && !canSubmit
      ? "Only your company owner can submit this month."
      : editable && mode === "on_behalf"
        ? "Only the company owner can submit this month."
        : null;

  // --- Context --------------------------------------------------------------------------------
  // Names of the comment targets, as on the review page ("Revenue per outlet (Mont Kiara)").
  const commentLabels = useMemo(() => commentTargetLabels(bundle, labels), [bundle, labels]);
  const comments = commentMode
    ? {
        mode: commentMode,
        canStartThreads: commentMode === "scaleup" && canStartThreads,
        counts: commentCounts ?? {},
        labels: commentLabels,
      }
    : null;

  const context: FormContextValue = {
    bundle,
    store,
    draft: snapshot.draft,
    invalid: snapshot.invalid,
    editable,
    audience,
    currency,
    issuesByTarget,
    errorFor,
    touch,
    comments,
    previous: bundle.previous
      ? { label: monthLabel(bundle.previous.submission.month), values: bundle.previous.values }
      : null,
    copyLastMonth,
    // Owners of an active company manage the company's revenue segments (BRD B30); canSubmit says owner.
    segmentsHref:
      audience === "company" && mode !== "on_behalf" && canSubmit && company.status === "active"
        ? `/portal/${company.id}/segments`
        : null,
  };

  const overdue = isOverdueSubmission(submission, company, today);

  return (
    <FormContextProvider value={context}>
      <section aria-label={`${month} monthly update`} className="flex w-full flex-col gap-6" data-mode={mode}>
        <FormHeader
          bundle={bundle}
          overdue={overdue}
          today={today}
          editable={editable}
          snapshot={snapshot}
          onRetry={() => store.retry()}
          comments={
            comments
              ? {
                  mode: comments.mode,
                  canStartThreads: comments.canStartThreads,
                  unresolved: totalUnresolved(commentCounts),
                  targetLabels: commentLabels,
                }
              : null
          }
          action={
            submitButton ??
            (submitNote ? <span className="hidden text-xs text-muted-foreground md:inline">{submitNote}</span> : null)
          }
        />

        <StatusBanners
          bundle={bundle}
          mode={mode}
          audience={audience}
          canSubmit={canSubmit}
          earlierDrafts={editable ? earlierDrafts : []}
          monthHrefBase={monthHrefBase}
        />

        {snapshot.status === "error" && snapshot.error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>Your latest changes haven&apos;t been saved: {snapshot.error}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => store.retry()}>
                Retry
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  reloading.current = true;
                  window.location.reload();
                }}
              >
                Reload page
              </Button>
            </span>
          </div>
        ) : null}

        {blocks.map((block) => {
          if (block.kind === "narrative") {
            return (
              <NarrativeGroup
                key={`narrative-${block.sections[0].key}`}
                sections={block.sections}
                open={openSections}
                onOpenChange={setOpenSections}
              />
            );
          }
          const { section } = block;
          switch (section.kind) {
            case "financials":
              return <FinancialsSection key={section.id} section={section} />;
            case "kpis":
              return <KpiSection key={section.id} section={section} cells={kpiCells} />;
            case "pulse":
              return <PulseSection key={section.id} section={section} />;
            default:
              return <FieldsSection key={section.id} section={section} />;
          }
        })}

        {editable ? (
          <NumbersCheck
            issues={issues}
            unreadable={unreadable}
            labelFor={labelFor}
            onJump={jumpTo}
            action={submitButton}
            note={submitNote}
          />
        ) : null}

        <ActivityCard events={bundle.events} />
      </section>

      {showSubmit ? (
        <ReviewSubmitDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          bundle={bundle}
          store={store}
          unreadable={reviewUnreadable}
          labelFor={labelFor}
          monthHrefBase={monthHrefBase}
          onJump={jumpTo}
          onSubmitted={onSubmitted}
        />
      ) : null}

      <ConfirmDialog
        open={copyRequest !== null}
        onOpenChange={(open) => {
          if (!open) setCopyRequest(null);
        }}
        title="Replace with last month's entry?"
        description={
          copyRequest ? `"${copyRequest.label}" already has an entry for ${month}. It will be replaced.` : undefined
        }
        confirmLabel="Replace"
        onConfirm={() => {
          if (copyRequest) applyCopy(copyRequest);
        }}
      />
    </FormContextProvider>
  );
}
