import type { ReactNode } from "react";

import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { COMPANY_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format";
import type { CompanyStatus, SubmissionStatus } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import type { ApproverState } from "./review-state";

export type ReviewSummaryProps = {
  status: SubmissionStatus;
  overdue: boolean;
  daysOverdue: number;
  dueDate: string;
  /** The first due date, when it was moved (extended or sent back). */
  originalDueDate: string | null;
  extensionReason: string | null;
  revision: number;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** The partner-in-charge and whether they can approve (approverState). */
  partnerInCharge: ApproverState;
  currency: string;
  companyStatus: CompanyStatus;
  lastSavedAt: string | null;
  /** An approved month whose owner asked to amend it (BRD B8): when they asked (pendingAmendment). */
  amendmentRequestedAt?: string | null;
  className?: string;
};

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** The partner-in-charge, marked when they cannot approve (deactivated, or without the Partner role). */
function PartnerInCharge({ approver }: { approver: ApproverState }) {
  if (approver.kind === "none") return <Muted>Not assigned</Muted>;
  const note = approver.kind === "inactive" ? "inactive" : approver.kind === "not_partner" ? "not a Partner" : null;
  return (
    <span className="block truncate" title={note ? `${approver.name} (${note}): only a Super Admin can approve` : approver.name}>
      {approver.name}
      {note ? <Muted>{` (${note})`}</Muted> : null}
    </span>
  );
}

/** Key facts of the month under review: status, due date, revision, submission, approval, partner-in-charge. */
export function ReviewSummary(props: ReviewSummaryProps) {
  const moved = props.originalDueDate !== null && props.originalDueDate !== props.dueDate;
  return (
    <Card size="sm" className={props.className}>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Status">
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={props.status} />
              {props.overdue ? (
                <StatusBadge status={props.status} overdue />
              ) : null}
              {props.status === "approved" && props.amendmentRequestedAt ? (
                <ToneBadge
                  tone="warning"
                  title={`The company owner asked to amend this month on ${formatDate(props.amendmentRequestedAt)}`}
                >
                  Amendment requested
                </ToneBadge>
              ) : null}
              {props.overdue && props.daysOverdue > 0 ? (
                <span className="text-xs text-destructive tabular-nums">
                  {props.daysOverdue} {props.daysOverdue === 1 ? "day" : "days"}
                </span>
              ) : null}
            </span>
          </Fact>
          <Fact label="Due date">
            <span className="tabular-nums">{formatDate(props.dueDate)}</span>
            {moved ? (
              <span className="block text-xs text-muted-foreground tabular-nums">Originally {formatDate(props.originalDueDate)}</span>
            ) : null}
            {props.extensionReason ? (
              <span className="line-clamp-2 text-xs text-muted-foreground" title={props.extensionReason}>
                Extended: {props.extensionReason}
              </span>
            ) : null}
          </Fact>
          <Fact label="Revision">
            {props.revision > 0 ? (
              <span className="tabular-nums">
                {props.revision}
                {props.revision > 1 ? <Muted> (resubmitted)</Muted> : null}
              </span>
            ) : (
              <Muted>Not submitted yet</Muted>
            )}
          </Fact>
          <Fact label="Submitted">
            {props.submittedAt ? (
              <>
                <span className="tabular-nums">{formatDateTime(props.submittedAt)}</span>
                {props.submittedBy ? <span className="block truncate text-xs text-muted-foreground">by {props.submittedBy}</span> : null}
              </>
            ) : (
              <Muted>—</Muted>
            )}
          </Fact>
          <Fact label="Approved">
            {props.approvedAt ? (
              <>
                <span className="tabular-nums">{formatDateTime(props.approvedAt)}</span>
                {props.approvedBy ? <span className="block truncate text-xs text-muted-foreground">by {props.approvedBy}</span> : null}
              </>
            ) : (
              <Muted>—</Muted>
            )}
          </Fact>
          <Fact label="Partner-in-charge">
            <PartnerInCharge approver={props.partnerInCharge} />
          </Fact>
          {props.companyStatus !== "active" ? (
            <Fact label="Company">
              <ToneBadge tone={COMPANY_STATUS_META[props.companyStatus].tone} title="Read-only: months can be approved but not sent back">
                {COMPANY_STATUS_META[props.companyStatus].label}
              </ToneBadge>
            </Fact>
          ) : null}
          {props.currency !== "MYR" ? (
            <Fact label="Reporting currency">
              <span className="font-medium">{props.currency}</span>
              <span className="block text-xs text-muted-foreground">Figures in {props.currency}</span>
            </Fact>
          ) : null}
          {props.lastSavedAt && props.status !== "approved" ? (
            <Fact label="Last saved">
              <span className="tabular-nums">{formatDateTime(props.lastSavedAt)}</span>
            </Fact>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}
