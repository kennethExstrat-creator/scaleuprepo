"use client";

import { createContext, useContext } from "react";

import { FieldCommentButton, type CommentMode } from "@/components/comments/comment-threads";
import { targetLabelFor } from "@/components/comments/target-labels";
import type { SubmissionBundle, SubmissionValues, TemplateFieldRow } from "@/lib/types/domain";
import type { ValidationIssue } from "@/lib/validation";

import type { DraftValues } from "./draft";
import type { DraftStore } from "./draft-store";
import type { CommentCounts } from "./presentation";

export type FormContextValue = {
  bundle: SubmissionBundle;
  store: DraftStore;
  /** The values on screen. */
  draft: DraftValues;
  /** Inputs whose text cannot be read, by target. */
  invalid: Readonly<Record<string, string>>;
  /** Inputs are shown (company or on-behalf entry of a draft / changes-requested month). */
  editable: boolean;
  /** Who is looking: the company side or ScaleUp (wording of banners and links). */
  audience: CommentMode;
  /** The company's reporting currency ('MYR', 'USD'). */
  currency: string;
  /** Client-side validation issues by target (§2.6 rules 1–5). */
  issuesByTarget: Record<string, ValidationIssue[]>;
  /** The message to show under an input (after it was left, or after a submit attempt), or null. */
  errorFor: (target: string) => string | null;
  /** Marks an input as visited (its errors show from now on). */
  touch: (target: string) => void;
  /** Field comment buttons; null hides them. `labels`: names of the targets (commentTargetLabels). */
  comments: {
    mode: CommentMode;
    canStartThreads: boolean;
    counts: CommentCounts;
    labels: Readonly<Record<string, string>>;
  } | null;
  /** The prior month's values and label ('Aug 2026'), for "Last month". */
  previous: { label: string; values: SubmissionValues } | null;
  /**
   * The company's revenue segments page (/portal/<id>/segments, BRD B30) when the viewer may change the
   * segments there (the owner of an active company on the company side); null otherwise.
   */
  segmentsHref: string | null;
  /** Copies last month's value into a field (asks first when the field already has a value). */
  copyLastMonth: (field: TemplateFieldRow) => void;
};

const FormContext = createContext<FormContextValue | null>(null);

export const FormContextProvider = FormContext.Provider;

export function useFormContext(): FormContextValue {
  const context = useContext(FormContext);
  if (!context) throw new Error("useFormContext must be used inside SubmissionForm.");
  return context;
}

/**
 * The comment button for a field, segment or KPI cell (M6's FieldCommentButton), named after its target
 * (e.g. "Revenue per outlet (Mont Kiara)"). Company users only see it where ScaleUp started a thread (they
 * reply, never start threads); ScaleUp staff see it wherever they may start one.
 */
export function CommentSlot({ target }: { target: string }) {
  const { comments, bundle } = useFormContext();
  if (!comments) return null;
  const counts = comments.counts[target];
  const total = counts?.total ?? 0;
  if (total === 0 && (comments.mode === "company" || !comments.canStartThreads)) return null;
  return (
    <FieldCommentButton
      submissionId={bundle.submission.id}
      target={target}
      mode={comments.mode}
      canStartThreads={comments.canStartThreads}
      count={total}
      unresolved={counts?.unresolved ?? 0}
      targetLabel={targetLabelFor(target, comments.labels)}
    />
  );
}
