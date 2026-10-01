"use client";

import {
  CalendarPlusIcon,
  CheckCircle2Icon,
  EllipsisIcon,
  LockOpenIcon,
  PencilLineIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  ApproveDialog,
  ExtendDeadlineDialog,
  ReopenDialog,
  RequestChangesDialog,
  type SharedThreadReminder,
} from "./review-dialogs";
import type { ReviewAction, ReviewActionState } from "./review-state";

export type ReviewActionsProps = {
  /** `panel`: the desktop side card; `bar`: the sticky bottom bar on smaller screens. */
  variant: "panel" | "bar";
  className?: string;
  submissionId: string;
  companyName: string;
  /** "September 2026". */
  monthLabel: string;
  /** "Sep 2026". */
  monthShort: string;
  statusSummary: { title: string; description: string };
  /** reviewActions(status, permissions, approver). */
  actions: ReviewActionState[];
  dueDate: string;
  originalDueDate: string | null;
  /** Today in Malaysia time ('YYYY-MM-DD'): a deadline cannot be extended to a date in the past. */
  today: string;
  /** Days the month is overdue (0 when it is not). */
  daysOverdue: number;
  /** The due date after sending the month back or reopening it (BRD B19). */
  sendBackDueDate: string;
  /** Labels of confirmed closes covering the month ("Q3 2026"), reopened when it is sent back. */
  confirmedCloses: string[];
  openSharedThreads: SharedThreadReminder[];
  openThreadCount: number;
  flagSummary: { critical: number; warning: number };
  validationIssueCount: number | null;
  /** On-behalf form of this month (M5). */
  editOnBehalfHref: string;
};

const ACTION_META: Record<ReviewAction, { label: string; icon: LucideIcon }> = {
  approve: { label: "Approve", icon: CheckCircle2Icon },
  request_changes: { label: "Request changes", icon: Undo2Icon },
  reopen: { label: "Reopen month", icon: LockOpenIcon },
  extend: { label: "Extend deadline", icon: CalendarPlusIcon },
  edit_on_behalf: { label: "Edit on behalf", icon: PencilLineIcon },
};

const PRIMARY: ReadonlySet<ReviewAction> = new Set<ReviewAction>(["approve", "request_changes", "reopen"]);

type DialogAction = Exclude<ReviewAction, "edit_on_behalf">;

/**
 * The review actions for the month (request changes, approve, reopen, extend the deadline, edit on behalf),
 * each opening its dialog. Approve is shown disabled, with the reason, to reviewers who cannot approve.
 */
export function ReviewActions(props: ReviewActionsProps) {
  const { variant, actions } = props;
  const [dialog, setDialog] = useState<DialogAction | null>(null);

  const dialogs = (
    <>
      <RequestChangesDialog
        open={dialog === "request_changes"}
        onOpenChange={(open) => setDialog(open ? "request_changes" : null)}
        submissionId={props.submissionId}
        companyName={props.companyName}
        monthLabel={props.monthLabel}
        sendBackDueDate={props.sendBackDueDate}
        confirmedCloses={props.confirmedCloses}
        openSharedThreads={props.openSharedThreads}
      />
      <ApproveDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        submissionId={props.submissionId}
        companyName={props.companyName}
        monthLabel={props.monthLabel}
        flagSummary={props.flagSummary}
        openThreadCount={props.openThreadCount}
        validationIssueCount={props.validationIssueCount}
      />
      <ReopenDialog
        open={dialog === "reopen"}
        onOpenChange={(open) => setDialog(open ? "reopen" : null)}
        submissionId={props.submissionId}
        companyName={props.companyName}
        monthLabel={props.monthLabel}
        sendBackDueDate={props.sendBackDueDate}
        confirmedCloses={props.confirmedCloses}
      />
      <ExtendDeadlineDialog
        open={dialog === "extend"}
        onOpenChange={(open) => setDialog(open ? "extend" : null)}
        submissionId={props.submissionId}
        companyName={props.companyName}
        monthLabel={props.monthLabel}
        dueDate={props.dueDate}
        originalDueDate={props.originalDueDate}
        today={props.today}
        daysOverdue={props.daysOverdue}
      />
    </>
  );

  function actionButton(state: ReviewActionState, options: { fullWidth?: boolean; size?: "default" | "sm" } = {}) {
    const action = state.action;
    const meta = ACTION_META[action];
    const Icon = meta.icon;
    const label = action === "approve" ? `Approve ${props.monthShort}` : meta.label;
    const variantFor = action === "approve" ? "default" : action === "edit_on_behalf" ? "ghost" : "outline";
    const className = cn(options.fullWidth && "w-full justify-start");

    if (action === "edit_on_behalf") {
      return (
        <Button key={state.action} asChild variant={variantFor} size={options.size} className={className}>
          <Link href={props.editOnBehalfHref}>
            <Icon data-icon="inline-start" />
            {meta.label}
          </Link>
        </Button>
      );
    }

    const button = (
      <Button
        key={state.action}
        type="button"
        variant={variantFor}
        size={options.size}
        className={className}
        disabled={!state.enabled}
        onClick={() => setDialog(action)}
      >
        <Icon data-icon="inline-start" />
        {label}
      </Button>
    );
    if (state.enabled) return button;
    // Disabled buttons get no pointer events: the wrapper carries the tooltip (and keyboard focus).
    return (
      <Tooltip key={state.action}>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={cn("inline-flex rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50", options.fullWidth && "w-full")} aria-label={`${label}: ${state.reason ?? "not available"}`}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-pretty">
          {state.reason}
        </TooltipContent>
      </Tooltip>
    );
  }

  const disabledApprove = actions.find((state) => state.action === "approve" && !state.enabled);

  if (variant === "panel") {
    return (
      <div className={cn("flex flex-col gap-4", props.className)}>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">{props.statusSummary.title}</p>
          <p className="text-sm text-pretty text-muted-foreground">{props.statusSummary.description}</p>
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-col gap-2">
            {actions.map((state) => actionButton(state, { fullWidth: true }))}
            {disabledApprove?.reason ? <p className="text-xs text-pretty text-muted-foreground">{disabledApprove.reason}</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">There is nothing for you to do on this month.</p>
        )}
        {dialogs}
      </div>
    );
  }

  // Sticky bar (smaller screens): the main decisions as buttons, the rest in a menu.
  if (actions.length === 0) return null;
  const primary = actions.filter((state) => PRIMARY.has(state.action));
  const secondary = actions.filter((state) => !PRIMARY.has(state.action));
  const inBar = primary.length > 0 ? primary : secondary;
  const inMenu = primary.length > 0 ? secondary : [];

  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 -mb-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-backdrop-filter:bg-background/80 md:-mx-6 md:-mb-6 md:px-6 lg:-mx-8 lg:-mb-8 lg:px-8",
        props.className,
      )}
    >
      <div className="flex items-center gap-2">
        <p className="hidden min-w-0 flex-1 truncate text-sm font-medium sm:block">{props.statusSummary.title}</p>
        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
          {inBar.map((state) => (
            <div key={state.action} className="flex-1 sm:flex-none [&>*]:w-full">
              {actionButton(state)}
            </div>
          ))}
          {inMenu.length > 0 ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="More actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-48">
                {inMenu.map((state) => {
                  const action = state.action;
                  const meta = ACTION_META[action];
                  const Icon = meta.icon;
                  if (action === "edit_on_behalf") {
                    return (
                      <DropdownMenuItem key={state.action} asChild>
                        <Link href={props.editOnBehalfHref}>
                          <Icon />
                          {meta.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  }
                  return (
                    <DropdownMenuItem key={action} onSelect={() => setDialog(action)}>
                      <Icon />
                      {meta.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {disabledApprove?.reason ? <p className="mt-1.5 text-xs text-pretty text-muted-foreground">{disabledApprove.reason}</p> : null}
      {dialogs}
    </div>
  );
}
