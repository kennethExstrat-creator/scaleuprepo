// Server-render smoke tests: the review page and the comment components render to HTML with realistic data
// (no Next.js runtime, data access mocked), so runtime rendering errors and missing content are caught.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireScaleUp: vi.fn(),
  isUuid: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
}));
vi.mock("@/lib/data", () => ({
  getSubmissionBundle: vi.fn(),
  getSubmissionValidation: vi.fn(),
  getCompanyInternal: vi.fn(),
  listCompanySubmissions: vi.fn(),
  getStaffDisplayNames: vi.fn(),
}));
vi.mock("@/lib/actions/comments", () => ({
  listComments: vi.fn(),
  addComment: vi.fn(),
  setCommentResolved: vi.fn(),
  getCommentCounts: vi.fn(),
}));
vi.mock("@/app/admin/review/[submissionId]/actions", () => ({
  requestChangesAction: vi.fn(),
  approveSubmissionAction: vi.fn(),
  reopenSubmissionAction: vi.fn(),
  extendDueDateAction: vi.fn(),
}));

import ReviewPage from "@/app/admin/review/[submissionId]/page";
import { CommentThreadsPanel, FieldCommentButton } from "@/components/comments/comment-threads";
import {
  buildCommentThreads,
  countThreadsByTarget,
  groupThreadsByTarget,
  type CommentRowWithProfiles,
} from "@/components/comments/model";
import { buildNarrativeSections } from "@/components/review/narrative";
import { NarrativeComparison } from "@/components/review/narrative-comparison";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireScaleUp } from "@/lib/auth/session";
import { getCompanyInternal, getSubmissionBundle, getSubmissionValidation, listCompanySubmissions } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type {
  CompanyInternalWithPartner,
  PartnerProfile,
  PlatformSettingsRow,
  SubmissionBundle,
  SubmissionOverviewRow,
} from "@/lib/types/domain";
import type { ScaleupRole, SubmissionStatus } from "@/lib/types/enums";

import { IDS, TS, buildBundle } from "./fixtures";
import { fakeSupabase, scaleUpCtx, type RecordedQuery } from "./fake-supabase";

function html(element: ReactElement): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

const ROOT = "c1000000-0000-4000-8000-000000000001";
const INTERNAL_ROOT = "c1000000-0000-4000-8000-000000000002";

const COMMENT_ROWS: CommentRowWithProfiles[] = [
  {
    id: ROOT,
    submission_id: IDS.sep,
    parent_id: null,
    target: "field:gross_profit",
    visibility: "shared",
    body: "Why did gross profit drop?",
    created_at: "2026-10-01T01:00:00+00:00",
    resolved_at: null,
    resolved_by: null,
    author_id: IDS.partner,
    author: { id: IDS.partner, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner" },
    resolver: null,
  },
  {
    id: "c1000000-0000-4000-8000-000000000011",
    submission_id: IDS.sep,
    parent_id: ROOT,
    target: "field:gross_profit",
    visibility: "shared",
    body: "Seasonal discounting.",
    created_at: "2026-10-01T02:00:00+00:00",
    resolved_at: null,
    resolved_by: null,
    author_id: IDS.owner,
    author: { id: IDS.owner, full_name: "Aisha Rahman", email: "aisha@batik.test", scaleup_role: null },
    resolver: null,
  },
  {
    id: INTERNAL_ROOT,
    submission_id: IDS.sep,
    parent_id: null,
    target: `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`,
    visibility: "internal",
    body: "Internal: The Row looks weak.",
    created_at: "2026-10-02T01:00:00+00:00",
    resolved_at: null,
    resolved_by: null,
    author_id: IDS.partner,
    author: { id: IDS.partner, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner" },
    resolver: null,
  },
];

const SETTINGS: PlatformSettingsRow = {
  id: 1,
  due_day: 15,
  escalation_days: 14,
  backfill_grace_days: 14,
  revenue_swing_pct: 30,
  min_runway_months: 6,
  require_mfa: true,
  default_reporting_start: "2026-07-01",
  declaration_text: "I confirm.",
  terms_version: "2026-09",
  owner_contributor_limit: 4,
  created_at: TS,
  updated_at: TS,
  updated_by: null,
};

function internal(partnerId: string | null, partner: Partial<PartnerProfile> = {}): CompanyInternalWithPartner {
  return {
    company_id: IDS.company,
    partner_in_charge_id: partnerId,
    internal_rating: null,
    exit_strategy_status: null,
    exit_strategy_notes: null,
    notes: null,
    updated_by: null,
    created_at: TS,
    updated_at: TS,
    partner: partnerId
      ? { id: partnerId, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner", is_active: true, ...partner }
      : null,
  };
}

function overviewRow(id: string, month: string, status: SubmissionStatus, extra: Partial<SubmissionOverviewRow> = {}): SubmissionOverviewRow {
  return {
    id,
    company_id: IDS.company,
    month,
    status,
    due_date: "2026-10-15",
    original_due_date: null,
    submitted_at: null,
    approved_at: null,
    revision: 0,
    last_saved_at: null,
    is_overdue: false,
    days_overdue: 0,
    has_narrative: true,
    open_threads: 0,
    ...extra,
  };
}

function setUpPage(opts: {
  role: ScaleupRole;
  userId?: string;
  bundle?: SubmissionBundle | null;
  partnerId?: string | null;
  /** Changes to the partner-in-charge's profile (e.g. deactivated). */
  partner?: Partial<PartnerProfile>;
}) {
  vi.mocked(requireScaleUp).mockResolvedValue(scaleUpCtx(opts.role, opts.userId ?? `user-${opts.role}`));
  const bundle = opts.bundle === undefined ? { ...buildBundle(), settings: SETTINGS } : opts.bundle;
  vi.mocked(getSubmissionBundle).mockResolvedValue(bundle);
  vi.mocked(getSubmissionValidation).mockResolvedValue({
    ok: false,
    errors: [{ target: "field:headcount_pt", code: "required", message: "Part-time headcount is required." }],
  });
  vi.mocked(getCompanyInternal).mockResolvedValue(
    internal(opts.partnerId === undefined ? IDS.partner : opts.partnerId, opts.partner),
  );
  vi.mocked(listCompanySubmissions).mockResolvedValue([
    overviewRow("90000000-0000-4000-8000-000000000010", "2026-10-01", "draft"),
    overviewRow(IDS.sep, "2026-09-01", "submitted", { is_overdue: false }),
    overviewRow(IDS.aug, "2026-08-01", "approved"),
  ]);
  const db = fakeSupabase((query: RecordedQuery) => {
    if (query.table === "comments") return { data: COMMENT_ROWS, error: null };
    if (query.table === "profiles") {
      return { data: [{ id: IDS.owner, full_name: "Aisha Rahman", email: "aisha@batik.test", scaleup_role: null }], error: null };
    }
    if (query.table === "period_closes") {
      return {
        data: [{ id: "p1", label: "Q3 2026", period_type: "quarter", status: "confirmed", period_end: "2026-09-30", confirmed_at: TS }],
        error: null,
      };
    }
    throw new Error(`unexpected query on ${query.table}`);
  });
  vi.mocked(createClient).mockResolvedValue(db.client as never);
  return db;
}

async function renderPage(): Promise<string> {
  const element = await ReviewPage({ params: Promise.resolve({ submissionId: IDS.sep }) });
  return html(element);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("review page", () => {
  it("renders the summary, flags, numbers, narrative, comments, timeline and actions", async () => {
    setUpPage({ role: "partner", userId: IDS.partner });
    const page = await renderPage();
    // Header and navigation
    expect(page).toContain("Batik Boutique");
    expect(page).toContain("September 2026");
    expect(page).toContain('href="/admin/review/90000000-0000-4000-8000-000000000008"');
    expect(page).toContain('href="/admin/review/90000000-0000-4000-8000-000000000010"');
    // Summary
    expect(page).toContain("Partner-in-charge");
    expect(page).toContain("Renuka Sena");
    // Flags: missing required value (critical) and revenue swing of +50 % (warning)
    expect(page).toContain("Missing required values");
    expect(page).toContain("Revenue swing");
    expect(page).toContain("Part-time headcount is required.");
    // Numbers
    expect(page).toContain("RM 150,000");
    expect(page).toContain("+50.0%");
    expect(page).toContain("-5.0 pp");
    expect(page).toContain("Cash-flow positive");
    expect(page).toContain("Revenue per outlet");
    // Both revenue breakdowns (BRD B30): the company's segments add up to total revenue, ScaleUp's lines need not.
    expect(page).toContain("Revenue segments defined by the company. They add up to total revenue.");
    expect(page).toContain("ScaleUp revenue lines");
    expect(page).toContain("Corporate gifting");
    expect(page).toContain("No longer used");
    expect(page).toContain("ScaleUp revenue lines above total revenue");
    expect(page).toContain("Same month last year");
    // KPI units appear once, in the label cell (and not when the label already says them).
    expect(page).toContain("App downloads");
    expect(page).toContain(">1,200<");
    expect(page).not.toContain("1,200 downloads");
    // Narrative (the blank Compliance section's fields stay collapsed: no thread on them)
    expect(page).toContain("Opened a new outlet in Mont Kiara.");
    expect(page).toContain("No narrative in either month");
    expect(page).toContain("Show fields (1)");
    // Comments: both threads for ScaleUp, with names
    expect(page).toContain("Why did gross profit drop?");
    expect(page).toContain("ScaleUp only");
    // Q3 close (quarter end) with the documents link
    expect(page).toContain("Q3 2026 close");
    expect(page).toContain(`href="/admin/documents?company=${IDS.company}"`);
    // Actions for the partner-in-charge on a submitted month
    expect(page).toContain("Approve Sep 2026");
    expect(page).toContain("Request changes");
    expect(page).not.toContain("Only Renuka Sena (partner-in-charge)");
  });

  it("explains who can approve to reviewers who cannot, and offers Fund Admins the deadline", async () => {
    setUpPage({ role: "fund_admin", userId: IDS.fundAdmin });
    const page = await renderPage();
    expect(page).toContain("Only Renuka Sena (partner-in-charge) or a Super Admin can approve this update.");
    expect(page).toContain("Extend deadline");
    // Only Super Admins manage the flag thresholds (Settings).
    expect(page).not.toContain("Change thresholds");
  });

  it("says why only a Super Admin can approve when the partner-in-charge is assigned but inactive or not a Partner", async () => {
    setUpPage({ role: "fund_admin", userId: IDS.fundAdmin, partner: { is_active: false } });
    let page = await renderPage();
    expect(page).toContain("Renuka Sena (inactive): only a Super Admin can approve");
    expect(page).toContain(" (inactive)");
    expect(page).toContain("Renuka Sena, the partner-in-charge, is no longer active, so only a Super Admin can approve this update.");
    expect(page).not.toContain("No partner-in-charge is assigned");

    setUpPage({ role: "partner", userId: "a1000000-0000-4000-8000-000000000099", partner: { scaleup_role: "fund_admin" } });
    page = await renderPage();
    expect(page).toContain(" (not a Partner)");
    expect(page).toContain("Renuka Sena, the partner-in-charge, is not a Partner, so only a Super Admin can approve this update.");
    expect(page).not.toContain("No partner-in-charge is assigned");

    setUpPage({ role: "fund_admin", userId: IDS.fundAdmin, partnerId: null });
    page = await renderPage();
    expect(page).toContain("Not assigned");
    expect(page).toContain("No partner-in-charge is assigned, so only a Super Admin can approve this update.");
  });

  it("renders read-only for viewers and 404s unknown months", async () => {
    setUpPage({ role: "viewer" });
    const page = await renderPage();
    expect(page).not.toContain("New thread");
    expect(page).not.toContain("Request changes");
    setUpPage({ role: "partner", bundle: null });
    await expect(ReviewPage({ params: Promise.resolve({ submissionId: IDS.sep }) })).rejects.toThrow();
  });
});

describe("comment components", () => {
  // As a company user loads them: RLS hides internal comments and ScaleUp profiles; staff_display_names
  // names the partner (BRD B28).
  const threads = buildCommentThreads(
    COMMENT_ROWS.filter((row) => row.visibility === "shared").map((row) => (row.author?.scaleup_role ? { ...row, author: null } : row)),
    {
      userId: IDS.owner,
      audience: "company",
      staffNames: { [IDS.partner]: "Renuka Sena (ScaleUp)" },
      canReply: true,
      canResolve: true,
    },
  );

  it("renders the panel for company users with ScaleUp people as '<name> (ScaleUp)' and no internal threads", () => {
    const panel = html(
      createElement(CommentThreadsPanel, { submissionId: IDS.sep, mode: "company", canStartThreads: false, threads }),
    );
    expect(panel).toContain("Why did gross profit drop?");
    expect(panel).toContain("Renuka Sena (ScaleUp)");
    expect(panel).toContain(">RS<");
    expect(panel).not.toContain("renuka@scaleup.test");
    expect(panel).not.toContain(">Partner<");
    expect(panel).not.toContain("The Row looks weak");
    expect(panel).not.toContain("ScaleUp only");
    expect(panel).not.toContain("New thread");
    expect(panel).toContain("Resolve");
    expect(panel).toContain("Gross profit");
  });

  it("renders the ScaleUp panel with names, roles, visibility badges and the new-thread button", () => {
    const scaleUpThreads = buildCommentThreads(COMMENT_ROWS, {
      userId: IDS.fundAdmin,
      audience: "scaleup",
      memberRoles: { [IDS.owner]: "owner" },
      canReply: true,
      canResolve: true,
    });
    const panel = html(
      createElement(CommentThreadsPanel, {
        submissionId: IDS.sep,
        mode: "scaleup",
        canStartThreads: true,
        threads: scaleUpThreads,
        targetLabels: { general: "General", "field:gross_profit": "Gross profit" },
      }),
    );
    expect(panel).toContain("Renuka Sena");
    expect(panel).not.toContain("Renuka Sena (ScaleUp)");
    expect(panel).toContain("Partner");
    expect(panel).toContain("Company Owner");
    expect(panel).toContain("ScaleUp only");
    expect(panel).toContain("Shared");
    expect(panel).toContain("New thread");
    // An unknown KPI cell target falls back to a generic label.
    expect(panel).toContain("Company KPI");
  });

  it("renders the field button with the unresolved count, and nothing for company users without threads", () => {
    const button = html(
      createElement(FieldCommentButton, {
        submissionId: IDS.sep,
        target: "field:gross_profit",
        mode: "company",
        canStartThreads: false,
        threads,
        targetLabel: "Gross profit",
      }),
    );
    expect(button).toContain("Gross profit: 1 comment thread, 1 unresolved");
    const empty = html(
      createElement(FieldCommentButton, { submissionId: IDS.sep, target: "field:net_profit", mode: "company", canStartThreads: false, count: 0 }),
    );
    expect(empty).toBe("");
    const counted = html(
      createElement(FieldCommentButton, { submissionId: IDS.sep, target: "field:net_profit", mode: "company", canStartThreads: false, count: 2, unresolved: 0 }),
    );
    expect(counted).toContain("2 comment threads, all resolved");
  });
});

describe("narrative comparison", () => {
  const sections = buildNarrativeSections(buildBundle());
  const base = { sections, currentLabel: "Sep 2026", previousLabel: "Aug 2026", hasPrevious: true };

  function commentsFor(rows: CommentRowWithProfiles[], canStartThreads = true) {
    const threads = buildCommentThreads(rows, {
      userId: IDS.partner,
      audience: "scaleup",
      memberRoles: { [IDS.owner]: "owner" },
      canReply: true,
      canResolve: true,
    });
    return {
      submissionId: IDS.sep,
      canStartThreads,
      threadsByTarget: groupThreadsByTarget(threads),
      counts: countThreadsByTarget(threads),
    };
  }

  it("lists the fields of sections blank in both months collapsed, each with a comment button once opened", () => {
    const closed = html(createElement(NarrativeComparison, { ...base, comments: commentsFor([]) }));
    expect(closed).toContain("No narrative in either month");
    expect(closed).toContain("Compliance and Regulation");
    expect(closed).toContain("Show fields (1)");
    expect(closed).not.toContain('aria-expanded="true"');
    expect(closed).not.toContain('data-target="field:compliance_updates"');
    // Filled sections keep their per-field buttons.
    expect(closed).toContain('data-target="field:key_milestones"');
  });

  it("opens the blank fields when one of them has a comment thread, so the thread is never hidden", () => {
    const row: CommentRowWithProfiles = {
      ...COMMENT_ROWS[0],
      id: "c1000000-0000-4000-8000-000000000021",
      target: "field:compliance_updates",
      body: "Please add the licence renewal.",
    };
    const open = html(createElement(NarrativeComparison, { ...base, comments: commentsFor([row]) }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("1 comment thread on these fields, 1 unresolved");
    expect(open).toContain("Licences and regulatory matters");
    expect(open).toContain('data-target="field:compliance_updates"');
    expect(open).toContain("Licences and regulatory matters: 1 comment thread, 1 unresolved");

    // Resolved threads open the list too, without the warning.
    const resolved = html(
      createElement(NarrativeComparison, {
        ...base,
        comments: commentsFor([{ ...row, resolved_at: TS, resolved_by: IDS.partner }]),
      }),
    );
    expect(resolved).toContain("1 comment thread on these fields, all resolved");
    expect(resolved).toContain('data-target="field:compliance_updates"');
  });
});
