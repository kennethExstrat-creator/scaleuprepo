"use client";

import {
  ArchiveIcon,
  CircleCheckIcon,
  ClockIcon,
  EyeIcon,
  FilePenLineIcon,
  ListOrderedIcon,
  MessageSquareWarningIcon,
  UserCogIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requestAmendment } from "@/lib/actions/submission";
import { SCALEUP_LABEL } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel, monthLabelLong } from "@/lib/periods";
import type { SubmissionBundle, SubmissionEventWithActor } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

import type { CommentMode } from "@/components/comments/comment-threads";
import { actorLabel, isEditableStatus, latestEvent, pendingAmendment } from "./presentation";
import type { SubmissionFormMode } from "./submission-form";

const TONES = {
  info: "border-info/25 bg-info/5 [&>svg]:text-info",
  warning: "border-warning/30 bg-warning/5 [&>svg]:text-warning",
  success: "border-success/25 bg-success/5 [&>svg]:text-success",
  neutral: "border-border bg-muted/40 [&>svg]:text-muted-foreground",
} as const;

function Banner({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Alert role="status" className={cn("px-3 py-2.5", TONES[tone])}>
      {icon}
      <AlertTitle>{title}</AlertTitle>
      {children || action ? (
        <AlertDescription className="flex flex-col gap-2 text-foreground/80">
          {children}
          {action ? <div className="flex flex-wrap gap-2 pt-0.5">{action}</div> : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

function Quote({ event }: { event: SubmissionEventWithActor }) {
  if (!event.message?.trim()) return null;
  return (
    <blockquote className="border-l-2 border-current/30 pl-3 break-words whitespace-pre-wrap text-foreground">
      {event.message}
    </blockquote>
  );
}

export type StatusBannersProps = {
  bundle: SubmissionBundle;
  mode: SubmissionFormMode;
  audience: CommentMode;
  /** Owner of the (active) company: may request an amendment of an approved month. */
  canSubmit: boolean;
  /** Earlier months still to submit ('YYYY-MM'); shown while this month can be edited. */
  earlierDrafts: string[];
  /** Base of month links, e.g. '/portal/<id>/updates'. */
  monthHrefBase: string;
};

/** What the month's status means for the person looking at it, and what they can do next. */
export function StatusBanners({ bundle, mode, audience, canSubmit, earlierDrafts, monthHrefBase }: StatusBannersProps) {
  const { submission, company, events } = bundle;
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const month = monthLabelLong(submission.month);
  const active = company.status === "active";
  const editable = mode !== "readonly" && isEditableStatus(submission.status);
  const banners: React.ReactNode[] = [];

  if (mode === "on_behalf") {
    banners.push(
      <Banner
        key="on-behalf"
        tone="info"
        icon={<UserCogIcon />}
        title={`You are entering data on behalf of ${company.name}. Changes are logged.`}
      >
        Values save automatically, as the company would see them. Only the company owner can submit the month.
      </Banner>,
    );
  }

  if (!active) {
    banners.push(
      <Banner
        key="inactive"
        tone="neutral"
        icon={<ArchiveIcon />}
        title={`${company.name} is no longer an active portfolio company, so its records are read-only.`}
      />,
    );
  }

  if (editable && earlierDrafts.length > 0) {
    banners.push(
      <Banner
        key="earlier"
        tone="warning"
        icon={<ListOrderedIcon />}
        title={`Submit ${earlierDrafts.map((m) => monthLabel(m)).join(", ")} first`}
      >
        <p>
          Months are submitted in order, so {month} can only be submitted once every earlier month has been submitted.
          You can still fill it in now.
        </p>
        <div className="flex flex-wrap gap-2">
          {earlierDrafts.map((m) => (
            <Button key={m} asChild variant="outline" size="sm">
              <Link href={`${monthHrefBase}/${m}`}>Open {monthLabel(m)}</Link>
            </Button>
          ))}
        </div>
      </Banner>,
    );
  }

  if (submission.status === "changes_requested") {
    const event = latestEvent(events, ["changes_requested", "reopened"]);
    const reopened = event?.event === "reopened";
    const who = event ? actorLabel(event) : SCALEUP_LABEL;
    const due = formatDate(submission.due_date);
    banners.push(
      <Banner
        key="changes"
        tone="warning"
        icon={<MessageSquareWarningIcon />}
        title={reopened ? `${who} reopened this month` : `${who} asked for changes`}
      >
        {event ? <Quote event={event} /> : null}
        <p className="text-xs">
          {event ? `${reopened ? "Reopened" : "Requested"} ${formatDateTime(event.created_at)}. ` : ""}
          {!active
            ? `${company.name} is no longer active, so this month stays as it was last saved.`
            : !editable
              ? `Due again by ${due}.`
              : canSubmit
                ? `Update the figures, reply to any comments, then resubmit by ${due}.`
                : `Update the figures and reply to any comments; the company owner then resubmits by ${due}.`}
        </p>
      </Banner>,
    );
  }

  if (submission.status === "submitted") {
    const event = latestEvent(events, ["submitted", "resubmitted"]);
    const who = event ? actorLabel(event) : null;
    banners.push(
      <Banner
        key="submitted"
        tone="info"
        icon={<ClockIcon />}
        title={audience === "company" ? "Submitted: awaiting review by ScaleUp" : "Submitted: awaiting review"}
      >
        <p>
          {submission.submitted_at
            ? `Submitted ${formatDateTime(submission.submitted_at)}${who ? ` by ${who}` : ""}. `
            : ""}
          {audience === "company"
            ? "The figures are locked while ScaleUp reviews them. ScaleUp will approve the month or ask for changes."
            : "The figures are locked until the month is approved or sent back for changes."}
        </p>
      </Banner>,
    );
  }

  if (submission.status === "approved") {
    const approval = latestEvent(events, ["approved"]);
    const pending = pendingAmendment(events);
    const mayAmend = canSubmit && active && audience === "company";
    banners.push(
      <Banner
        key="approved"
        tone="success"
        icon={<CircleCheckIcon />}
        title={`${month} is approved and locked`}
        action={
          mayAmend ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setAmendmentOpen(true)}>
              <FilePenLineIcon data-icon="inline-start" />
              {pending ? "Request another amendment" : "Request amendment"}
            </Button>
          ) : null
        }
      >
        <p>
          {submission.approved_at ? `Approved ${formatDateTime(submission.approved_at)}` : "Approved"}
          {approval ? ` by ${actorLabel(approval)}` : ""}.
          {mayAmend ? " If something needs to change, request an amendment and ScaleUp will reopen the month." : ""}
        </p>
        {approval ? <Quote event={approval} /> : null}
        {pending ? (
          <p className="text-xs">
            Amendment requested {formatDateTime(pending.created_at)}
            {pending.message ? `: "${pending.message}"` : ""}. ScaleUp will reopen the month if the change is needed.
          </p>
        ) : null}
      </Banner>,
    );
  }

  if (mode === "readonly" && active && isEditableStatus(submission.status) && audience === "scaleup") {
    banners.push(
      <Banner key="view-only" tone="neutral" icon={<EyeIcon />} title="View only">
        {submission.status === "draft"
          ? "The company hasn't submitted this month yet: these are the figures saved so far."
          : "The month is back with the company for changes: these are the figures saved so far."}{" "}
        Only Fund Admins can enter data on behalf of a company.
      </Banner>,
    );
  }

  return (
    <>
      {banners.length > 0 ? <div className="flex flex-col gap-3">{banners}</div> : null}
      <ConfirmDialog
        open={amendmentOpen}
        onOpenChange={setAmendmentOpen}
        title={`Request an amendment to ${month}?`}
        description="Tell ScaleUp what needs to change. They will reopen the month so you can correct and resubmit it; it then needs approval again."
        requireReason
        reasonLabel="What needs to change?"
        reasonPlaceholder="For example: net profit was restated after the audit adjustments."
        confirmLabel="Request amendment"
        onConfirm={async (reason) => {
          const result = await requestAmendment(submission.id, reason ?? "");
          // The reason's own message (e.g. its length limit) rather than "Please check the highlighted fields."
          if (!result.ok) throw new Error(result.fieldErrors?.reason ?? result.error);
          toast.success("Amendment requested", { description: "ScaleUp has been asked to reopen the month." });
        }}
      />
    </>
  );
}
