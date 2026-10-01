import { ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { CommentThreadsPanel } from "@/components/comments/comment-threads";
import { fetchCommentRows, memberRolesFrom } from "@/components/comments/load-threads";
import {
  buildCommentThreads,
  commentExcerpt,
  countThreadsByTarget,
  groupThreadsByTarget,
} from "@/components/comments/model";
import { buildTargetLabels, targetLabelFor } from "@/components/comments/target-labels";
import { buildComparisonSections, reviewTargetOptions } from "@/components/review/comparison";
import { ComparisonTable } from "@/components/review/comparison-table";
import { reviewFlags } from "@/components/review/flags";
import { FlagsPanel } from "@/components/review/flags-panel";
import { MonthNav, type MonthLink } from "@/components/review/month-nav";
import { buildNarrativeSections } from "@/components/review/narrative";
import { NarrativeComparison } from "@/components/review/narrative-comparison";
import { pendingAmendment } from "@/components/review/amendment";
import { PeriodCloseCard, type CoveringClose } from "@/components/review/period-close-card";
import { ReviewActions } from "@/components/review/review-actions";
import {
  approverState,
  reviewActions,
  reviewStatusSummary,
  sendBackDueDate,
  type ReviewPermissions,
} from "@/components/review/review-state";
import { ReviewSummary } from "@/components/review/review-summary";
import { ReviewTimeline } from "@/components/review/review-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canApprove,
  canComment,
  canEnterData,
  canExtendDueDate,
  canManagePlatform,
  canReopen,
  canReplyToComments,
  canRequestChanges,
  canResolveComments,
} from "@/lib/auth/permissions";
import { isUuid, requireScaleUp } from "@/lib/auth/session";
import { DEFAULT_BACKFILL_GRACE_DAYS, DEFAULT_MIN_RUNWAY_MONTHS, DEFAULT_REVENUE_SWING_PCT } from "@/lib/constants";
import {
  getCompanyInternal,
  getSubmissionBundle,
  getSubmissionValidation,
  listCompanySubmissions,
} from "@/lib/data";
import { toFiniteNumber } from "@/lib/format";
import { addMonths, dateToMonthKey, isQuarterEnd, monthLabel, monthLabelLong, todayMYT } from "@/lib/periods";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { ScaleupRole } from "@/lib/types/enums";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReviewPageProps = { params: Promise<{ submissionId: string }> };

type PersonRow = { id: string; full_name: string | null; email: string; scaleup_role: ScaleupRole | null };
type MetadataRow = { month: string; company: { name: string } | null };

function personName(person: PersonRow | undefined): string | null {
  if (!person) return null;
  return person.full_name?.trim() || person.email || null;
}

/** Profiles of the people who submitted and approved the month (ScaleUp staff read every profile). */
async function loadPeople(sb: SupabaseClient<Database>, ids: Array<string | null>): Promise<Map<string, PersonRow>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id !== "")));
  if (unique.length === 0) return new Map();
  const { data, error } = await sb.from("profiles").select("id, full_name, email, scaleup_role").in("id", unique);
  if (error) throw error;
  const rows: PersonRow[] = data ?? [];
  return new Map(rows.map((row) => [row.id, row]));
}

/** The company's quarter and half closes that cover the month (sending it back reopens confirmed ones). */
async function loadCoveringCloses(sb: SupabaseClient<Database>, companyId: string, month: string): Promise<CoveringClose[]> {
  const { data, error } = await sb
    .from("period_closes")
    .select("id, label, period_type, status, period_end, confirmed_at")
    .eq("company_id", companyId)
    .lte("period_start", month)
    .gte("period_end", month);
  if (error) throw error;
  const rows: CoveringClose[] = data ?? [];
  return rows;
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { submissionId } = await params;
  if (!isUuid(submissionId)) return { title: "Review" };
  await requireScaleUp();
  const sb = await createClient();
  const { data } = await sb
    .from("submissions")
    .select("month, company:companies!submissions_company_id_fkey(name)")
    .eq("id", submissionId)
    .maybeSingle();
  const row: MetadataRow | null = data;
  if (!row) return { title: "Review" };
  return { title: `Review ${row.company?.name ?? "update"} ${monthLabel(row.month)}` };
}

/**
 * /admin/review/[submissionId] — review one month of one company (BRD A7): status and key facts, auto-flags,
 * this month against the prior month and the same month last year, the narrative against last month,
 * comments (shared and internal), the timeline, and the actions: request changes, approve, reopen, extend the
 * deadline, edit on behalf.
 */
export default async function ReviewPage({ params }: ReviewPageProps) {
  const ctx = await requireScaleUp();
  const { submissionId } = await params;
  if (!isUuid(submissionId)) notFound();
  const sb = await createClient();

  const [bundle, validation, commentRows] = await Promise.all([
    getSubmissionBundle(sb, submissionId),
    // Shown as "could not be loaded" rather than failing the whole page.
    getSubmissionValidation(sb, submissionId).catch((error: unknown) => {
      console.error("[review] validation could not be loaded", error);
      return null;
    }),
    fetchCommentRows(sb, submissionId),
  ]);
  if (!bundle) notFound();

  const { submission, company } = bundle;
  const monthKey = dateToMonthKey(submission.month);
  const [internal, overview, people, closes] = await Promise.all([
    getCompanyInternal(sb, company.id),
    listCompanySubmissions(sb, company.id),
    loadPeople(sb, [submission.submitted_by, submission.approved_by]),
    loadCoveringCloses(sb, company.id, submission.month),
  ]);

  // Figures and flags (docs/ARCHITECTURE.md §6 "Review"; BRD B30: the company's revenue segments and
  // ScaleUp's revenue lines are compared separately, each matched across the months by segment).
  const currency = company.reporting_currency.trim();
  const flags = reviewFlags(bundle, validation?.errors ?? []);
  const sections = buildComparisonSections(bundle);
  const narrative = buildNarrativeSections(bundle);
  const targetLabels = buildTargetLabels(bundle);
  const targetOptions = reviewTargetOptions(sections, narrative);

  // Comments.
  const memberRoles = memberRolesFrom(bundle.config.members);
  const threads = buildCommentThreads(commentRows, {
    userId: ctx.userId,
    audience: "scaleup",
    memberRoles,
    canReply: canReplyToComments(ctx, company.id),
    canResolve: canResolveComments(ctx, company.id),
  });
  const threadsByTarget = groupThreadsByTarget(threads);
  const counts = countThreadsByTarget(threads);
  const canStartThreads = canComment(ctx);
  const openThreads = threads.filter((thread) => !thread.resolved);
  const commentsInfo = { submissionId: submission.id, canStartThreads, threadsByTarget, counts };

  // Months of the company for navigation (newest first) and the overdue state of this one.
  const index = overview.findIndex((row) => row.id === submission.id);
  const overviewRow = index >= 0 ? overview[index] : null;
  const link = (i: number): MonthLink | null => {
    const row = i >= 0 ? overview[i] : undefined;
    return row ? { id: row.id, month: row.month, status: row.status } : null;
  };
  const previousMonth = index >= 0 ? link(index + 1) : null;
  const nextMonth = index >= 0 ? link(index - 1) : null;

  // Who may do what (docs/ARCHITECTURE.md §6: exited / written-off companies — approve yes; send back no).
  // The partner-in-charge approves only while they are an active Partner; the summary and the Approve note
  // both say so when they cannot.
  const approver = approverState(internal?.partner ?? null);
  const permissions: ReviewPermissions = {
    canRequestChanges: canRequestChanges(ctx, company.status),
    canApprove: canApprove(ctx, internal),
    canReopen: canReopen(ctx, internal, company.status),
    canExtendDueDate: canExtendDueDate(ctx, company.status),
    canEditOnBehalf: canEnterData(ctx, company.id, company.status),
  };
  const actions = reviewActions(submission.status, permissions, approver);
  // An owner's amendment request on this approved month that nobody has answered yet (BRD B8).
  const amendment = pendingAmendment({ status: submission.status, approvedAt: submission.approved_at }, threads);
  const statusSummary = reviewStatusSummary(submission.status, {
    companyName: company.name,
    monthLabel: monthLabelLong(submission.month),
    companyActive: company.status === "active",
    amendment,
  });
  const today = todayMYT();
  const graceDays = toFiniteNumber(bundle.settings?.backfill_grace_days) ?? DEFAULT_BACKFILL_GRACE_DAYS;
  const actionProps = {
    submissionId: submission.id,
    companyName: company.name,
    monthLabel: monthLabelLong(submission.month),
    monthShort: monthLabel(submission.month),
    statusSummary,
    actions,
    dueDate: submission.due_date,
    originalDueDate: submission.original_due_date,
    today,
    daysOverdue: overviewRow?.is_overdue ? overviewRow.days_overdue : 0,
    sendBackDueDate: sendBackDueDate(submission.due_date, today, graceDays),
    confirmedCloses: closes.filter((close) => close.status === "confirmed").map((close) => close.label),
    openSharedThreads: openThreads
      .filter((thread) => thread.visibility === "shared")
      .map((thread) => ({
        id: thread.id,
        targetLabel: targetLabelFor(thread.target, targetLabels),
        excerpt: commentExcerpt(thread.root.body),
        replies: thread.replies.length,
      })),
    openThreadCount: openThreads.length,
    flagSummary: {
      critical: flags.filter((flag) => flag.severity === "critical").length,
      warning: flags.filter((flag) => flag.severity === "warning").length,
    },
    validationIssueCount: validation ? validation.errors.length : null,
    editOnBehalfHref: `/admin/companies/${company.id}/updates/${monthKey}`,
  };

  const lastYearKey = addMonths(monthKey, -12);
  const previousKey = addMonths(monthKey, -1);

  // Two columns once the page itself is at least 64rem wide (a container query, so an expanded or
  // collapsed sidebar is taken into account); below that, one column with a sticky action bar.
  return (
    <div className="@container flex flex-col gap-6">
      <PageHeader
        className="mb-0"
        breadcrumbs={[
          { label: "Tracker", href: "/admin/tracker" },
          { label: company.name, href: `/admin/companies/${company.id}` },
          { label: monthLabel(submission.month) },
        ]}
        title={
          <>
            {company.name} <span className="font-normal text-muted-foreground">· {monthLabelLong(submission.month)}</span>
          </>
        }
        description="Monthly update review"
        actions={
          <>
            <MonthNav previous={previousMonth} next={nextMonth} />
            <Button asChild variant="ghost" size="sm">
              <Link href={`/admin/companies/${company.id}`}>
                Company
                <ExternalLinkIcon data-icon="inline-end" />
              </Link>
            </Button>
          </>
        }
      />

      <ReviewSummary
        status={submission.status}
        overdue={overviewRow?.is_overdue ?? false}
        daysOverdue={overviewRow?.days_overdue ?? 0}
        dueDate={submission.due_date}
        originalDueDate={submission.original_due_date}
        extensionReason={submission.extension_reason}
        revision={submission.revision}
        submittedAt={submission.submitted_at}
        submittedBy={personName(people.get(submission.submitted_by ?? ""))}
        approvedAt={submission.approved_at}
        approvedBy={personName(people.get(submission.approved_by ?? ""))}
        partnerInCharge={approver}
        currency={currency}
        companyStatus={company.status}
        lastSavedAt={submission.last_saved_at}
        amendmentRequestedAt={amendment?.requestedAt ?? null}
      />

      <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start @7xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <FlagsPanel
            flags={flags}
            validationIssues={validation ? validation.errors : null}
            thresholds={{
              revenueSwingPct: toFiniteNumber(bundle.settings?.revenue_swing_pct) ?? DEFAULT_REVENUE_SWING_PCT,
              minRunwayMonths: toFiniteNumber(bundle.settings?.min_runway_months) ?? DEFAULT_MIN_RUNWAY_MONTHS,
            }}
            targetLabels={targetLabels}
            canEditThresholds={canManagePlatform(ctx)}
            checksRevenueLines={sections.some((section) => section.key === "scaleup_lines")}
          />

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                <h2>Numbers</h2>
              </CardTitle>
              <CardDescription>
                {monthLabel(submission.month)} against the prior month and the same month last year
                {currency !== "MYR" ? `, in ${currency}` : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-(--card-spacing)">
              <ComparisonTable
                sections={sections}
                currency={currency}
                columns={{
                  current: { label: monthLabel(submission.month), status: submission.status },
                  previous: { label: monthLabel(previousKey), status: bundle.previous?.submission.status ?? null },
                  lastYear: { label: monthLabel(lastYearKey), status: bundle.lastYear?.submission.status ?? null },
                }}
                comments={commentsInfo}
              />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                <h2>Narrative</h2>
              </CardTitle>
              <CardDescription>
                The C4 categories and founder pulse, next to last month&apos;s entries. Narrative is optional.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NarrativeComparison
                sections={narrative}
                currentLabel={monthLabel(submission.month)}
                previousLabel={monthLabel(previousKey)}
                hasPrevious={bundle.previous !== null}
                comments={commentsInfo}
              />
            </CardContent>
          </Card>
        </div>

        <aside aria-label="Review actions, comments and timeline" className="flex min-w-0 flex-col gap-6">
          <Card className="hidden @5xl:flex">
            <CardHeader>
              <CardTitle>
                <h2>Review</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewActions variant="panel" {...actionProps} />
            </CardContent>
          </Card>

          {isQuarterEnd(monthKey) ? <PeriodCloseCard companyId={company.id} month={submission.month} closes={closes} /> : null}

          <Card>
            <CardContent>
              <CommentThreadsPanel
                submissionId={submission.id}
                mode="scaleup"
                canStartThreads={canStartThreads}
                targetLabels={targetLabels}
                targetOptions={targetOptions}
                threads={threads}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Timeline</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReviewTimeline
                events={bundle.events}
                memberRoles={memberRoles}
                opened={{ at: submission.created_at, dueDate: submission.original_due_date ?? submission.due_date }}
              />
            </CardContent>
          </Card>
        </aside>
      </div>

      <ReviewActions variant="bar" className="@5xl:hidden" {...actionProps} />
    </div>
  );
}
