import {
  ArchiveIcon,
  BadgeCheckIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FileCheckIcon,
  FileXIcon,
  HistoryIcon,
  InfoIcon,
  LockIcon,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  canConfirmPeriodClose,
  canEnterData,
  canExport,
  canReopenPeriodClose,
  type PermissionSubject,
} from "@/lib/auth/permissions";
import { COMPANY_STATUS_LABELS, NOT_YET_REPORTING_META, PERIOD_CLOSE_STATUS_META, SUBMISSION_STATUS_META } from "@/lib/constants";
import { DOCUMENT_PACK_MAX_BYTES, documentPackTooLargeMessage } from "@/lib/exports/document-pack-limits";
import { formatDate, formatDateTime, formatFileSize } from "@/lib/format";
import { monthLabel, monthLabelLong, todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";
import { cn } from "@/lib/utils";

import { CloseDisclosure } from "./close-disclosure";
import { CloseMonths } from "./close-months";
import { ConfirmCloseDialog } from "./confirm-close-dialog";
import { DocumentTable } from "./document-table";
import { loadCompanyDocuments } from "./queries";
import { ReopenCloseButton } from "./reopen-close-button";
import { formatFigure, PERIOD_FIGURES } from "./totals";
import { TotalsTable } from "./totals-table";
import { UploadDocumentDialog } from "./upload-document-dialog";
import { defaultExpandedCloses, upcomingClose, type CloseView, type CompanyDocumentsView, type DocumentsMode } from "./view-model";

export type PeriodClosePanelProps = {
  /** The company (already loaded and visible to the caller). */
  company: CompanyRow;
  /** "company" on /portal (ScaleUp staff shown as "<full name> (ScaleUp)", BRD B28), "scaleup" on /admin. */
  mode: DocumentsMode;
  /** The signed-in user (from the page's guard): decides upload, confirm and reopen. */
  ctx: PermissionSubject;
  /** Expand this close (e.g. `?close=<id>`). */
  focusCloseId?: string | null;
  /** Or expand the close with this label (e.g. 'Q3 2026' from `?period=Q3-2026`). */
  focusPeriodLabel?: string | null;
};

type Permissions = {
  /** Members of the active company; Fund Admins on behalf (canEnterData). */
  canUpload: boolean;
  /** Owner of the active company; Fund Admins on behalf (canConfirmPeriodClose). */
  canConfirm: boolean;
  /** Super Admins and Fund Admins, active companies only (canReopenPeriodClose). */
  canReopen: boolean;
  /** ScaleUp staff; owners for their own company (canExport): the document pack download. */
  canExport: boolean;
};

/** Link to the document pack of a close (zip, module M9: GET /api/exports/documents/[companyId]?closeId=). */
function documentPackHref(companyId: string, closeId: string): string {
  return `/api/exports/documents/${companyId}?closeId=${closeId}`;
}

/**
 * A company's quarter and half-year closes and its documents (BRD §6.1 period close, C4), shared by the
 * company portal (/portal/[companyId]/documents) and ScaleUp (/admin/documents?company=<id>). Per close:
 * the months and their status, live totals (or the confirmed snapshot with any restatement), who
 * confirmed and when, and the management accounts and supporting files with their versions. Uploads,
 * confirmation and reopening follow the caller's rights (the database enforces them too); exited and
 * written-off companies are read-only.
 */
export async function PeriodClosePanel({ company, mode, ctx, focusCloseId, focusPeriodLabel }: PeriodClosePanelProps) {
  const sb = await createClient();
  const view = await loadCompanyDocuments(sb, company, mode);
  const permissions: Permissions = {
    canUpload: canEnterData(ctx, company.id, company.status),
    canConfirm: canConfirmPeriodClose(ctx, company.id, company.status),
    canReopen: canReopenPeriodClose(ctx, company.status),
    canExport: canExport(ctx, company.id),
  };
  const onBehalf = ctx.scaleupRole !== null;
  const focusId =
    focusCloseId ?? (focusPeriodLabel ? (view.closes.find((close) => close.label === focusPeriodLabel)?.id ?? null) : null);
  const expanded = new Set(defaultExpandedCloses(view.closes, focusId));
  const readOnly = company.status !== "active";

  return (
    <div className="flex flex-col gap-8">
      {readOnly ? (
        <Alert>
          <LockIcon aria-hidden="true" />
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>
            {company.name} is no longer an active portfolio company ({COMPANY_STATUS_LABELS[company.status]}), so its
            period closes and documents can no longer change. Everything can still be viewed and downloaded.
          </AlertDescription>
        </Alert>
      ) : null}

      {!readOnly && onBehalf && (permissions.canUpload || permissions.canConfirm) ? (
        <Alert className="border-info/25 bg-info/5">
          <InfoIcon className="text-info" aria-hidden="true" />
          <AlertDescription className="text-foreground">
            As a Fund Admin you can upload documents and confirm closes on behalf of {company.name}. Everything you do
            here is recorded in the audit log as done on its behalf.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="period-closes-heading" className="flex flex-col gap-4">
        <div className="space-y-1">
          <h2 id="period-closes-heading" className="font-heading text-lg font-semibold">
            Quarter and half-year closes
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {mode === "company"
              ? "At the end of each quarter and half-year, check the period totals, upload your management accounts and confirm. You can confirm once every month of the period is submitted and at least one management accounts file is uploaded."
              : "At the end of each quarter and half-year the company checks the period totals, uploads its management accounts and confirms. Confirmation needs every month of the period submitted and at least one management accounts file."}
          </p>
        </div>
        {view.closes.length === 0 ? (
          <NoClosesState view={view} mode={mode} />
        ) : (
          <div className="flex flex-col gap-3">
            {view.closes.map((close) => (
              <CloseCard
                key={close.id}
                close={close}
                view={view}
                mode={mode}
                permissions={permissions}
                onBehalf={onBehalf}
                defaultOpen={expanded.has(close.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="other-documents-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2 id="other-documents-heading" className="font-heading text-lg font-semibold">
              Other documents
            </h2>
            <p className="text-sm text-muted-foreground">Supporting files that aren&apos;t tied to a quarter or half-year.</p>
          </div>
          {permissions.canUpload ? (
            <UploadDocumentDialog
              companyId={company.id}
              companyName={company.name}
              periodCloseId={null}
              onBehalf={onBehalf}
              triggerLabel="Upload a file"
            />
          ) : null}
        </div>
        <DocumentTable
          documents={view.otherDocuments}
          caption={`Other documents of ${company.name}`}
          emptyText={
            permissions.canUpload
              ? "No other documents yet. Upload supporting files that aren't tied to a period, such as a board pack or audited accounts."
              : "No other documents."
          }
          showType
        />
      </section>
    </div>
  );
}

function NoClosesState({ view, mode }: { view: CompanyDocumentsView; mode: DocumentsMode }) {
  if (view.company.reportingStartMonth === null) {
    return (
      <EmptyState
        icon={CalendarClockIcon}
        title={NOT_YET_REPORTING_META.label}
        description={
          mode === "company"
            ? "Quarter and half-year closes start once ScaleUp sets your reporting start month."
            : "This company has no reporting start month yet, so it has no monthly updates or period closes. Set one on the company page to start."
        }
        action={
          mode === "scaleup" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/companies/${view.company.id}`}>Open the company page</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  const today = todayMYT();
  const next = upcomingClose(view.company.reportingStartMonth, today);
  const description =
    view.company.status === "active" && next.opensOn > today
      ? `The first close, ${next.period.label} (${next.period.rangeLabel}), opens on ${formatDate(next.opensOn)}, together with the ${monthLabelLong(next.period.endMonth)} update.`
      : "A close opens once the last month of a quarter or half-year is open for reporting.";
  return <EmptyState icon={CalendarClockIcon} title="No period closes yet" description={description} />;
}

/** What still stands between an open close and its confirmation, e.g. "submit Sep 2026 (changes requested)". */
function missingSteps(close: CloseView): string[] {
  const steps: string[] = [];
  const months = close.months
    .filter((month) => month.counted && !month.submitted)
    .map((month) =>
      month.status === "changes_requested"
        ? `${monthLabel(month.month)} (${SUBMISSION_STATUS_META.changes_requested.label.toLowerCase()})`
        : monthLabel(month.month),
    );
  if (months.length > 0) steps.push(`submit ${months.join(", ")}`);
  if (close.managementAccounts.length === 0) steps.push("upload the management accounts");
  return steps;
}

function waitingText(close: CloseView, view: CompanyDocumentsView, mode: DocumentsMode, permissions: Permissions): string | null {
  if (close.status !== "open") return null;
  // Exited and written-off companies are read-only: confirm_period_close() refuses them.
  if (view.company.status !== "active") {
    return `Not confirmed. ${view.company.name} is no longer an active portfolio company (${COMPANY_STATUS_LABELS[view.company.status]}), so this close can no longer be confirmed.`;
  }
  const steps = missingSteps(close);
  if (steps.length > 0) {
    const text = steps.join(" and ");
    return `To confirm: ${text}.`;
  }
  if (permissions.canConfirm) return null;
  return mode === "company" ? "Ready for the company owner to confirm." : "Ready for the company to confirm.";
}

function CloseCard({
  close,
  view,
  mode,
  permissions,
  onBehalf,
  defaultOpen,
}: {
  close: CloseView;
  view: CompanyDocumentsView;
  mode: DocumentsMode;
  permissions: Permissions;
  onBehalf: boolean;
  defaultOpen: boolean;
}) {
  const meta = PERIOD_CLOSE_STATUS_META[close.status];
  const confirmed = close.status === "confirmed";
  // An open close of an exited or written-off company stays unconfirmed for good (read-only).
  const lockedOpen = !confirmed && view.company.status !== "active";
  const latestAccounts = close.managementAccounts[0] ?? null;
  const waitingId = `close-${close.id}-waiting`;
  const waiting = waitingText(close, view, mode, permissions);
  const documentCount = close.managementAccounts.length + close.supporting.length;
  // The pack holds every version of every file of the close; the export route refuses packs over
  // DOCUMENT_PACK_MAX_BYTES (module M9), so say so here instead of offering a link that fails.
  const packBytes = [...close.managementAccounts, ...close.supporting].reduce((sum, doc) => sum + (doc.sizeBytes ?? 0), 0);
  const packTooLarge = packBytes > DOCUMENT_PACK_MAX_BYTES;
  const { company } = view;

  const summary = (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-base font-semibold">{close.label}</h3>
        {lockedOpen ? (
          <ToneBadge tone="neutral" title="The company is no longer active, so this close can no longer be confirmed">
            <LockIcon className="size-3" aria-hidden="true" />
            Not confirmed
          </ToneBadge>
        ) : (
          <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>
        )}
        {confirmed && close.restatedTotals ? <ToneBadge tone="info">Restated</ToneBadge> : null}
        {!confirmed && close.readyToConfirm ? <ToneBadge tone="info">Ready to confirm</ToneBadge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {close.typeLabel} · {close.rangeLabel}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <CalendarCheckIcon className={cn("size-4", close.allSubmitted ? "text-success" : "text-muted-foreground")} aria-hidden="true" />
          {close.submittedMonths} of {close.countedMonths} {close.countedMonths === 1 ? "month" : "months"} submitted
        </li>
        <li className="flex items-center gap-1.5">
          {latestAccounts ? (
            <FileCheckIcon className="size-4 text-success" aria-hidden="true" />
          ) : (
            <FileXIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {latestAccounts ? `Management accounts: version ${latestAccounts.version}` : "No management accounts yet"}
        </li>
        {confirmed ? (
          <li className="flex items-center gap-1.5">
            <BadgeCheckIcon className="size-4 text-success" aria-hidden="true" />
            Confirmed {formatDateTime(close.confirmedAt)} by {close.confirmedBy}
          </li>
        ) : null}
      </ul>
      {waiting ? (
        <p id={waitingId} className="text-sm text-foreground/80">
          {waiting}
        </p>
      ) : null}
    </div>
  );

  const actions =
    !confirmed && permissions.canConfirm ? (
      <ConfirmCloseDialog
        companyId={company.id}
        companyName={company.name}
        closeId={close.id}
        label={close.label}
        rangeLabel={close.rangeLabel}
        currency={company.currency}
        liveTotals={close.liveTotals}
        countedMonths={close.countedMonths}
        previousRestatement={close.restatedTotals}
        previousReason={close.restatementReason}
        latestAccounts={latestAccounts ? { fileName: latestAccounts.fileName, version: latestAccounts.version } : null}
        ready={close.readyToConfirm}
        blockedDescriptionId={waiting ? waitingId : undefined}
        onBehalf={onBehalf}
      />
    ) : confirmed && permissions.canReopen ? (
      <ReopenCloseButton companyId={company.id} companyName={company.name} closeId={close.id} label={close.label} />
    ) : null;

  return (
    <CloseDisclosure id={`close-${close.id}`} label={close.label} defaultOpen={defaultOpen} summary={summary} actions={actions}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Months</h4>
          <CloseMonths months={close.months} mode={mode} companyId={company.id} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">{confirmed ? "Confirmed totals" : "Period totals"}</h4>
            {confirmed && close.computedTotals ? (
              <>
                <TotalsTable
                  totals={close.computedTotals}
                  restated={close.restatedTotals}
                  variant="confirmed"
                  currency={company.currency}
                  caption={`Confirmed totals of ${close.label}`}
                  comparison={close.revenueComparison}
                />
                <p className="text-xs text-muted-foreground">
                  Calculated from {close.computedTotals.months_count}{" "}
                  {close.computedTotals.months_count === 1 ? "month" : "months"} and stored when {close.label} was
                  confirmed.
                </p>
              </>
            ) : (
              <>
                <TotalsTable
                  totals={close.liveTotals}
                  variant="live"
                  currency={company.currency}
                  caption={`Live totals of ${close.label}`}
                  comparison={close.revenueComparison}
                />
                <p className="text-xs text-muted-foreground">
                  {close.liveTotals.months_count === 0
                    ? "No month of this period has been submitted yet."
                    : `Live totals from the ${close.liveTotals.months_count} submitted or approved ${close.liveTotals.months_count === 1 ? "month" : "months"}${close.liveTotals.months_count < close.countedMonths ? ` (of ${close.countedMonths})` : ""}. Revenue and profit are summed, cash and headcount are at period end, and burn is the monthly average.`}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {confirmed ? <ConfirmationDetails close={close} /> : <Checklist close={close} readOnly={lockedOpen} />}
            {!confirmed && close.restatedTotals ? <PreviousRestatement close={close} currency={company.currency} /> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Documents</h4>
            <div className="flex flex-wrap items-center gap-2">
              {permissions.canExport && documentCount > 0 ? (
                packTooLarge ? (
                  <span
                    className="text-xs text-muted-foreground"
                    title={documentPackTooLargeMessage(packBytes, close.label)}
                  >
                    Too large to download as one pack ({formatFileSize(packBytes)}): download the files one at a time
                  </span>
                ) : (
                  <Button asChild variant="ghost" size="sm">
                    <a href={documentPackHref(company.id, close.id)}>
                      <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                      Download all
                    </a>
                  </Button>
                )
              ) : null}
              {permissions.canUpload ? (
                <UploadDocumentDialog
                  companyId={company.id}
                  companyName={company.name}
                  periodCloseId={close.id}
                  closeLabel={close.label}
                  closeConfirmed={confirmed}
                  nextManagementAccountsVersion={(latestAccounts?.version ?? 0) + 1}
                  onBehalf={onBehalf}
                />
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <h5 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Management accounts</h5>
            <DocumentTable
              documents={close.managementAccounts}
              caption={`Management accounts of ${close.label}, newest version first`}
              emptyText={
                permissions.canUpload && !confirmed
                  ? "No management accounts uploaded yet. Upload the profit and loss, balance sheet and cash flow for the period."
                  : "No management accounts uploaded."
              }
              markLatest
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h5 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Supporting documents</h5>
            <DocumentTable
              documents={close.supporting}
              caption={`Supporting documents of ${close.label}, newest first`}
              emptyText="No supporting documents."
            />
          </div>
        </div>
      </div>
    </CloseDisclosure>
  );
}

/** What confirming needs, ticked off; for exited and written-off companies (`readOnly`) only what was received. */
function Checklist({ close, readOnly }: { close: CloseView; readOnly: boolean }) {
  const monthsDone = close.allSubmitted;
  const accountsDone = close.managementAccounts.length > 0;
  const items = [
    {
      done: monthsDone,
      title: "Every month submitted",
      detail: monthsDone
        ? `${close.countedMonths} of ${close.countedMonths} ${close.countedMonths === 1 ? "month" : "months"} submitted or approved.`
        : `${close.submittedMonths} of ${close.countedMonths} submitted. A month sent back for changes must be resubmitted.`,
    },
    {
      done: accountsDone,
      title: "Management accounts uploaded",
      detail: accountsDone
        ? `Version ${close.managementAccounts[0].version}: ${close.managementAccounts[0].fileName}`
        : "At least one management accounts file is needed.",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{readOnly ? "Checklist" : "Before confirming"}</h4>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5">
            {item.done ? (
              <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {item.title}
                <span className="sr-only">{item.done ? ": done" : ": not yet"}</span>
              </p>
              <p className="text-xs break-words text-muted-foreground">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmationDetails({ close }: { close: CloseView }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Confirmation</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border px-3 py-3 text-sm">
        <dt className="text-muted-foreground">Confirmed</dt>
        <dd className="tabular-nums">{formatDateTime(close.confirmedAt)}</dd>
        <dt className="text-muted-foreground">By</dt>
        <dd className="break-words">{close.confirmedBy}</dd>
        <dt className="text-muted-foreground">Restated</dt>
        <dd>{close.restatedTotals ? "Yes, to match the management accounts" : "No, the calculated totals were confirmed"}</dd>
        {close.restatedTotals ? (
          <>
            <dt className="text-muted-foreground">Reason</dt>
            <dd className="break-words whitespace-pre-line">{close.restatementReason ?? "—"}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function PreviousRestatement({ close, currency }: { close: CloseView; currency: string }) {
  const restated = close.restatedTotals ?? {};
  const figures = PERIOD_FIGURES.filter((figure) => Object.prototype.hasOwnProperty.call(restated, figure.key)).map(
    (figure) => `${figure.label} ${formatFigure(figure.kind, restated[figure.key] ?? null, currency)}`,
  );
  return (
    <Alert>
      <HistoryIcon aria-hidden="true" />
      <AlertTitle>Restated when last confirmed</AlertTitle>
      <AlertDescription>
        <p>{figures.join(" · ")}</p>
        {close.restatementReason ? <p>Reason: {close.restatementReason}</p> : null}
        <p>These figures are kept until {close.label} is confirmed again.</p>
      </AlertDescription>
    </Alert>
  );
}
