export const meta = {
  name: 'features-finish',
  description: 'Finish Phase 1: revenue segments (B30), finish M4/M6/M7/M9 with reviews, segments UI, integrate, BRD completeness',
  phases: [
    { title: 'Segments core', detail: 'B30 in the database, validation and data layer (new migration)' },
    { title: 'Build', detail: 'finish M4, M6, M7, M9 and build the segments UI; at most 3 agents at once' },
    { title: 'Review', detail: 'per-module review: authorization, BRD conformance, correctness' },
    { title: 'Fix', detail: 'module owner fixes verified findings' },
    { title: 'Integrate', detail: 'cross-module wiring, typegen, typecheck, tests, lint, build' },
    { title: 'Completeness', detail: 'BRD Phase 1 critic, then gap fixes and final verification' },
  ],
}

const ROOT = '/Users/kenneth-personal/Documents/ScaleUp Reporting Platform'

const PREAMBLE = [
  'You are part of a small team (at most three agents run at the same time) building the nine Phase 1 feature modules of the ScaleUp Portfolio Reporting Platform (Phase 1 MVP) in: ' + ROOT,
  'RESOURCE RULES (critical - the previous run failed because the 16 GB machine ran out of memory and every agent stalled): run a full "npx tsc --noEmit" at most TWICE in your whole session (near the end); never run "npm test", "npm run build", "next build", "next dev", "next start" or any watcher/background process; run only targeted tests (npx vitest run tests/features/<key>) and targeted lint (npx eslint <your paths>); never run several heavy commands at once; if a command seems slow, wait for it rather than starting another. Keep each command under about 2 minutes.',
  'The foundation is complete, tested and deployed to the Supabase project (Postgres 17): database with RLS and RPCs, auth + shell (login, TOTP 2FA, terms, 30-min idle timeout), core libs, typed data layer. 501 tests pass.',
  'READ FIRST: CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md (THE contract - sections 1, 2.2-2.8, 4, 5 and 6 especially; "(updated)" items and the section 7 change log are authoritative), and the BRD "ScaleUp Portfolio Reporting Platform - BRD.md" (the sections named in your brief, plus section 13 Build decisions B1-B29 and Appendix A). Study existing foundation code before writing your own: src/lib/** (data layer, auth/session, permissions, periods, metrics, validation, format, constants, targets), src/components/app/**, src/components/shell/**, src/app/(auth)/** for patterns and conventions. Most feature modules already exist on disk (built in an earlier, interrupted run) - read neighbouring modules\' code for consistency, but only edit your own paths. Today is 2026-10-01 (Asia/Kuala_Lumpur).',
  'RULES',
  '- Only create/edit files in YOUR ownership list. Everything else is read-only. If you need a change elsewhere (shared helper, DB change, nav link, public route), do NOT make it: describe it precisely in notesForOtherModules.',
  '- No new npm dependencies. Never edit src/components/ui/* (shadcn-generated; you may use every component there), package*.json, config files, supabase/**, tests/db/**, tests/unit/**, tests/data/**. Never touch .env.local or print secrets.',
  '- Data access: const sb = await createClient() from @/lib/supabase/server, functions from @/lib/data (server-only), RPCs via sb.rpc(...). The service-role client (createAdminClient) ONLY where the contract allows it (Supabase Auth admin APIs, storage signing, access_links for M2). Assign query results to typed variables (no "as" casts) so tsc checks select strings against the generated types.',
  '- Every page calls its own guard (requireScaleUp / requireCompanyAccess / requireUser). Every Server Action and route handler: try { const ctx = await assertX(...); validate input with zod v4; ...; revalidatePath(...); return ok(data) } catch (e) { return toActionError(e) }. Show/hide UI with src/lib/auth/permissions.ts helpers (the DB enforces anyway). On company-side screens ScaleUp staff are shown as "<full name> (ScaleUp)" (BRD B28, decided 2026-10-01), resolved with the data-layer helper getStaffDisplayNames / the staff_display_names RPC (added by the decisions step - see docs/ARCHITECTURE.md); never show their email, role or the partner-in-charge assignment to company users.',
  '- Next.js 16: params/searchParams are Promises. Type page props explicitly, e.g. export default async function Page({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }). Do NOT run "next build" or "next typegen" (the integrator does); use "npx tsc --noEmit".',
  '- UI quality bar: professional, clean, information-dense but readable business UI built from shadcn components (@/components/ui/*) and the shared components (@/components/app/*: PageHeader, StatusBadge, ToneBadge, Money, EmptyState, ConfirmDialog, SubmitButton, FormError); lucide-react icons; sonner toasts. Desktop-first and usable on a phone (review/approval flows especially). British English copy. Loading states (loading.tsx / Suspense skeletons), empty states, friendly errors, confirmation for destructive actions, accessible forms (labels, aria-describedby errors, keyboard). Money via Money/formatMoney, right-aligned tabular-nums; dates via formatDate/formatDateTime; months via monthLabel/monthLabelLong. Pages render inside the shell padding (no outer padding).',
  '- The folder is synced by iCloud Drive: never create files or folders with spaces in their names.',
  '- REVENUE SEGMENTS (BRD B30, decided 2026-10-01 - read BRD section 6.1 and B30): two breakdowns per company. (1) Company revenue segments (revenue_segments.kind = company): defined by the company OWNER in the portal page /portal/[companyId]/segments, they add up to total revenue (revenue_total is calculated from them when they exist), carry over every month, and changes warn about comparability; submitted months keep their segment names and figures. (2) ScaleUp revenue lines (kind = scaleup): defined by ScaleUp admins per company, required each month, they do NOT have to add up to total revenue. The database/validation/data-layer side is implemented by the "segments core" step first - follow docs/ARCHITECTURE.md as it stands when you start.',
  '- The internet connection here can drop for a few minutes: if a command or request fails with a network error, wait briefly and retry rather than giving up.',
  '- Other agents run "npx tsc --noEmit" at the same time: errors in files you do not own are their work in progress - ignore them unless they block you.',
  'VERIFY before reporting: npx tsc --noEmit shows no errors in your files; npx eslint <your paths> is clean; pure helpers you add are unit-tested in tests/features/<your module key, lower-case>/*.test.ts (you own that folder; add vi.mock("server-only", () => ({})) when importing server-only code) and pass with npx vitest run tests/features/<key>.',
  'REPORT (structured): summary, files, deviations from the contract, verification (commands + results), openQuestions, notesForOtherModules (exact routes you expose, anything another module or the integrator must do).',
].join('\n')

const BUILD_REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    notesForOtherModules: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files', 'deviations', 'verification', 'openQuestions', 'notesForOtherModules'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      title: { type: 'string' }, location: { type: 'string' }, evidence: { type: 'string' }, recommendation: { type: 'string' },
    }, required: ['severity', 'title', 'location', 'evidence', 'recommendation'] } },
  },
  required: ['summary', 'findings'],
}
const FIX_REPORT = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    notFixed: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'] } },
    verification: { type: 'string' },
    notesForOtherModules: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'notFixed', 'verification', 'notesForOtherModules'],
}
const GAPS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    gaps: { type: 'array', items: { type: 'object', properties: {
      requirement: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      status: { type: 'string', enum: ['missing', 'partial', 'broken'] }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['requirement', 'severity', 'status', 'evidence', 'fix'] } },
  },
  required: ['summary', 'gaps'],
}

const MODULES = [
  {
    key: 'M5', title: 'Monthly update form (C3, C6, on-behalf entry)',
    owns: 'src/components/submission-form/** (replace the stub, keep exported names and props), src/app/portal/[companyId]/updates/**, src/app/admin/companies/[companyId]/updates/**, src/lib/actions/submission.ts, tests/features/m5/**',
    brief: [
      'BRD: sections 6.1 (quantitative mandatory, qualitative optional, C4 categories, founder pulse, missing/late rules), C3, C6, B5, B19, B21, B28. ARCHITECTURE: section 6 "Monthly form" (updated), 2.4 (save_submission_values input rules, get_submission_validation, submit_submission, request_amendment), 2.6 validation, 5.4, 5.5, 5.7.',
      '1. /portal/[companyId]/updates: every month of the company (listCompanySubmissions): month, StatusBadge (overdue variant), due date, narrative filled/skipped, open threads; primary CTA for the earliest month needing action; note that months are submitted in order (B5); "Not yet reporting" empty state when the company has no reporting start month.',
      '2. /portal/[companyId]/updates/[month] (month = YYYY-MM; parseMonthKey or notFound): getSubmissionBundleByMonth (null -> notFound). Mode "company" when canEnterData(ctx, companyId, company.status) and status is draft or changes_requested, otherwise "readonly". canSubmit from canSubmit(ctx, companyId). Company side: ScaleUp actors show as "<name> (ScaleUp)" (B28; bundle events carry actor_name already resolved - see ARCHITECTURE).',
      '3. /admin/companies/[companyId]/updates/[month]: ScaleUp page; mode "on_behalf" for fund_admin when editable (canEnterData with company status), else "readonly"; banner "You are entering data on behalf of <Company>. Changes are logged."; link back to the review page /admin/review/<submissionId>. Submit is owner-only (never shown on-behalf).',
      '4. SubmissionForm (client): status banner (changes requested -> latest changes_requested event message; submitted -> awaiting review; approved -> locked, with "Request amendment" for owners: ConfirmDialog requireReason -> request_amendment); sticky header with month, due date, save indicator ("Saving...", "Saved 14:05" via formatTime, "Couldn\'t save - Retry"), and "Review and submit".',
      '   Sections in template order: financials (revenue per active segment with a live read-only total when segments exist, otherwise a revenue_total input; gross profit, net profit, cash in bank, burn rate with its help text "Enter 0 if cash-flow positive"); live metrics panel (GP%, NP%, runway via formatRunway, month-on-month revenue change vs bundle.previous); headcount; KPI grid from kpiCellsForMonth(toValidationInput(bundle)) with inputs per value type (boolean Yes/No, integer/number/currency/percent numeric, text); custom_numbers sections; narrative accordions per C4 section, each field with a collapsible "Last month" showing bundle.previous values and a "Copy last month" button; picklist Select; tags as toggle chips; pulse section with morale 1-5 segmented buttons (labels from the field options), goals, help needed and help tags.',
      '   Number inputs: text inputs with inputMode="decimal", parseNumberInput / formatNumberInput on blur, currency symbol prefix from the company reporting currency.',
      '   Autosave: track dirty entries, debounce about 1200 ms, serialise saves through the saveSubmissionValues server action (rpc save_submission_values with only the changed entries; empty value deletes), keep dirty state and offer retry on failure, warn on unload with unsaved changes.',
      '   Validation: live validateSubmissionDraft(toValidationInput(bundle, liveValues)) -> inline errors (after a field is touched or after the first submit attempt) plus a summary panel with jump links. "Review and submit" dialog: flush pending saves, call get_submission_validation (includes prior_months: list those months with links), then show the declaration text from bundle.clientSettings.declaration_text with a checkbox, then submit_submission; toast, router.refresh and go to /portal/[companyId]/updates. Contributors see "Only your company owner can submit this month" instead of Submit.',
      '   Comments: when commentMode is not null, render FieldCommentButton (from @/components/comments/comment-threads, implemented by M6 in parallel - keep to its contract props) next to each field / segment / KPI cell target (targets from src/lib/targets.ts), and a "Comments" button opening CommentThreadsPanel in a Sheet with the unresolved count. commentCounts is computed on the server page from the comments visible to the viewer (group by target).',
      '   Readonly mode renders values as text (no inputs). Accessibility: labels, aria-describedby errors, keyboard.',
      '5. src/lib/actions/submission.ts ("use server"): saveSubmissionValues, getSubmissionValidationAction, submitSubmission(submissionId, declarationAccepted), requestAmendment(submissionId, reason) - each asserts access (company member or fund_admin for save; owner for submit and amendment), zod-validates, maps errors, revalidates the form, list, portal home and /admin/tracker paths.',
    ].join('\n'),
  },
  {
    key: 'M6', title: 'Review & comments (A7, C7)',
    owns: 'src/app/admin/review/**, src/components/comments/** (replace the stub, keep exported names and props; you may add optional props), src/lib/actions/comments.ts, src/components/review/**, tests/features/m6/**',
    brief: [
      'BRD: A7, C7, section 7 workflow, B7, B8, B9, B19, B21, B24, B28. ARCHITECTURE: section 6 "Review" (updated), 2.4 (request_changes, approve_submission, reopen_submission, extend_due_date, resolve_comment), 2.7 comments RLS, 5.7.',
      '1. Comments server actions (src/lib/actions/comments.ts, "use server"): listComments(submissionId) -> threads (root + replies, oldest first) with author display (ScaleUp viewers: staff full name + role label; company viewers: staff as "<name> (ScaleUp)" via getStaffDisplayNames (B28), company people by name; never staff email or role to company viewers), visibility, target, resolved state; addComment({ submissionId, target, body, visibility, parentId? }) (company users: replies to shared roots only; ScaleUp non-viewers: new threads with Shared/Internal visibility); setCommentResolved(commentId, resolved) -> rpc resolve_comment. Guards: assertCanViewCompany for reads; writes checked with canComment / canReplyToComments / canResolveComments.',
      '2. CommentThreadsPanel: threads for the submission (optional target filter), grouped Open / Resolved; each thread shows its target label (add an optional prop targetLabels?: Record<string, string> and fall back to parseTarget), a visibility badge (Internal = "ScaleUp only"), messages with author and relative time (client-rendered), reply composer, resolve/reopen; a new-thread composer when canStartThreads (target select from targetLabels plus General, visibility toggle defaulting to Shared). FieldCommentButton: icon button with a count badge (unresolved highlighted) opening a Popover with that target\'s threads plus a composer. Refresh after mutations.',
      '3. /admin/review/[submissionId]: requireScaleUp(); getSubmissionBundle (null -> notFound); getCompanyInternal for partner-in-charge. Header: company, month, StatusBadge (+overdue), due date (and original if extended), revision, submitted by/at, approved by/at, partner-in-charge. Flags panel: computeFlags exactly as in ARCHITECTURE section 6 (FLAG_CODE_LABELS, FLAG_SEVERITY_META). Comparison table: rows for each revenue segment, total revenue, gross profit, GP%, net profit, NP%, cash, burn, runway, headcount FT/PT, each KPI (per dimension member) and custom numbers; columns This month | Prior month | change % | Same month last year | YoY %; a FieldCommentButton per row (scaleup mode, canStartThreads = canComment(ctx)). Narrative: each narrative and pulse field this month vs last month, with "No narrative this month" where empty. Timeline from bundle.events (SUBMISSION_EVENT_LABELS). Comments panel. Link to /admin/documents?company=<id> at quarter/half ends.',
      '4. Actions (src/app/admin/review/[submissionId]/actions.ts + components in src/components/review/): Request changes (message required; list unresolved shared threads as a reminder), Approve (optional message; only when canApprove(ctx, internal), else disabled with a tooltip explaining who can approve), Reopen approved month (reason; canReopen), Extend deadline (new later date + reason; canExtendDueDate), "Edit on behalf" link for fund admins when editable -> /admin/companies/[companyId]/updates/[YYYY-MM] (built by M5). Previous/next month navigation for the same company. Mobile: stacked layout with a sticky action bar.',
      '5. Revenue segments (B30): the comparison table shows two groups - company revenue segments (their sum is total revenue) and ScaleUp revenue lines (no sum rule) - each row matched across months by segment id (a renamed or new segment shows a dash in months where it did not exist; retired segments appear only in months that have values for them). Use the data-layer helpers added by the segments core step.',
    ].join('\n'),
  },
  {
    key: 'M2', title: 'Users, team & access links (A2, C1, B14, B22, B23, B29)',
    owns: 'src/app/admin/users/**, src/app/portal/[companyId]/team/**, src/lib/auth-admin/**, src/app/access/**, scripts/create-user.ts, tests/features/m2/**',
    brief: [
      'BRD: section 5, A2, C1, B11, B14, B22, B23, B28, B29. ARCHITECTURE: section 1 (invite rules), 2.2 access_links + guard, 2.4 claim_access_link and admin_update_profile, 4 (/access route), 5.1-5.2.',
      '1. src/lib/auth-admin/ (import "server-only"; service-role client): createAccessLink({ userId, purpose: "invite" | "signin", createdBy }) -> { url, expiresAt } (token = 32 random bytes base64url; store the sha256 hex; invite 7 days, signin 24 hours; revoke earlier unused links of the same user and purpose; the DB guard enforces who may issue for whom - map its 42501 message); revokeAccessLink(id); listPendingAccessLinks(filter); ensureAuthUser({ email, fullName }) (admin.auth.admin.createUser with email_confirm true and no password, or return the existing user); setUserBanned(userId, banned) (ban_duration "876000h" / "none"); resetUserMfa(userId) (list and delete factors); listAuthUsers() for last sign-in and 2FA status (paginate admin.listUsers). Never log tokens.',
      '2. /access/[token] (public; the proxy already allows /access): GET renders a card with the ScaleUp logo, who the link is for (look up via the service role WITHOUT claiming it) and an "Accept invitation" / "Sign in" button; it NEVER signs in on GET. The Server Action: rate-limit per IP (src/lib/auth/rate-limit), claim atomically via admin.rpc("claim_access_link", { p_token_hash }) (no row -> friendly "This link has expired or was already used - ask ScaleUp (or your company owner) for a new one"), then admin.auth.admin.generateLink({ type: "magiclink", email }) and verifyOtp on the cookie-based server client with the returned hashed_token (check the supabase-js EmailOtpType), startIdleClock(), redirect to /set-password (invite) or /mfa (signin). Follow ARCHITECTURE line "/access/[token]" exactly.',
      '3. /admin/users (requireScaleUp(["super_admin"])): tabs ScaleUp team / Company users / Pending invitations. Columns: name, email, role or company memberships, status, 2FA enrolled, last sign-in. Actions: invite a ScaleUp user (email, name, job title, role) -> ensureAuthUser, rpc admin_update_profile as the caller, createAccessLink(invite), dialog with the link, a Copy button, expiry and "send it to them by email or chat", log_audit_event("invite"); invite a company user (company, owner or contributor, email, name) -> ensureAuthUser, insert company_members as the caller, link; change ScaleUp role; change company role or deactivate a membership; deactivate / reactivate a user (admin_update_profile is_active + ban/unban); reset 2FA (log mfa_reset); issue a new sign-in link (log sign_in_link); revoke a pending invite (log invite_revoke). No hard delete (B22). ?company=<id> pre-filters company users (M1 links here). Refuse mixing roles (a company email as ScaleUp staff and vice versa) with clear messages.',
      '4. /portal/[companyId]/team (C1): requireCompanyAccess; member list (name, email, role, status, pending invite). Contributor limit (B29, decided 2026-10-01): an owner may have at most getClientSettings().owner_contributor_limit (default 4) ACTIVE contributors, pending invitations included; show "n of 4 contributors", disable inviting at the limit with the reason, and surface the database refusal (P0001) if hit; ScaleUp admins on /admin/users are not limited. Owners (canManageCompanyTeam) invite contributors (email + name) with the same flow (company_members insert as the owner; access link only when the DB guard allows it, B29 - otherwise explain that the person already has an account and can sign in, or ScaleUp can send them a link), revoke pending invites of their company, deactivate/reactivate contributors. Contributors see a read-only list; exited/written-off companies are read-only.',
      '5. scripts/create-user.ts: without --password, print a one-time /access invite link (7 days) instead of a password; keep --password for automated test users; reuse src/lib/auth-admin where practical.',
    ].join('\n'),
  },
  {
    key: 'M1', title: 'Funds & companies (A1, A4)',
    owns: 'src/app/admin/funds/**, src/app/admin/companies/page.tsx, src/app/admin/companies/loading.tsx, src/app/admin/companies/_components/**, src/app/admin/companies/new/**, src/app/admin/companies/[companyId]/page.tsx, src/app/admin/companies/[companyId]/loading.tsx, src/app/admin/companies/[companyId]/_components/**, src/app/admin/companies/actions.ts, tests/features/m1/**',
    brief: [
      'BRD: A1, A4, section 6.2, 6.3, B2, B3, B10, B15, B16, B18, B22, B24, Appendix A. ARCHITECTURE: 2.2 (companies, fund_investments, company_internal incl. partner_in_charge_id, revenue_segments, kpi_dimensions, kpi_dimension_members, company_kpis), 2.4 (set_company_status, delete_company, open_due_periods), 2.7, 5.5 (getCompanyConfig, getCompanyInternal).',
      '1. /admin/funds (all ScaleUp view; super_admin manages): funds with code, name, legal name, active, company counts; create/edit (code unique upper-case, name, legal name, description, active).',
      '2. /admin/companies: all companies with name, funds (codes), sector, status (COMPANY_STATUS_META), reporting (start month or "Not yet reporting"), latest month status (v_submission_overview), partner-in-charge (company_internal); filters fund, status, partner, reporting / not yet; name search; "Add company" for super_admin.',
      '3. /admin/companies/new (super_admin): name, legal name, registration no, sector, country, website, description, reporting currency (3 letters, default MYR), reporting start month (optional; empty = not yet reporting), partner-in-charge (active partners and super admins; saved to company_internal), fund mappings (fund, investment date, instrument, ownership %). After saving with a start month, call open_due_periods() so months open immediately.',
      '4. /admin/companies/[companyId] with tabs via ?tab=: Overview (profile edit for super_admin, read-only otherwise; reporting start month with an explanation; status actions: mark exited / written off with reason via set_company_status, and back to active; delete for super_admin via delete_company with a reason and a type-the-name confirmation, then remove the company\'s storage folder "<company_id>/" in bucket company-documents with the service-role storage API (list + remove); history is otherwise kept per B22); Funds & investment (fund_investments CRUD, super_admin); Revenue lines (segments add/rename/reorder/deactivate; used ones cannot be deleted; super_admin and fund_admin); KPIs (dimensions + members add/rename/reorder/deactivate, KPIs with name, description, unit, value type, frequency, dimension, required, active, order; super_admin and fund_admin); Team (read-only members list + link "Manage users" -> /admin/users?company=<id>); Internal (ScaleUp only: partner-in-charge - super_admin changes it; internal rating, exit strategy status, exit strategy notes, notes - canEditInternal); Monthly updates (listCompanySubmissions with status, overdue, narrative, threads; links to /admin/review/<id> and, for fund admins, "Edit on behalf" -> /admin/companies/<id>/updates/<YYYY-MM>).',
    ].join('\n'),
  },
  {
    key: 'M9', title: 'Exports & audit log (A13, A14)',
    owns: 'src/app/admin/exports/**, src/app/admin/audit/**, src/app/api/exports/**, src/lib/exports/**, tests/features/m9/**',
    brief: [
      'BRD: A13, A14, section 10 outputs, 11 (audit, performance), B17 (layout follows BRD field lists), B18, B22. ARCHITECTURE: section 6 "C4 export" (updated), 2.2 audit_log, 2.4 log_audit_event (allowlisted actions), 2.8 storage.',
      '1. src/lib/exports/c4-workbook.ts: pure builder (loaded data in, ExcelJS workbook out; unit-test it with fixture data). Sheets: "C4" (company and Last Updated rows; columns Category | one column per half-year from the first reported half to the current one | "Input Here" for the half in progress; rows = the narrative sections in template order (C4 categories) plus Founder pulse; cell = monthly entries "Jul 2026: ..." from approved months, other months marked "(not yet approved)" when included; months with no narrative stated as "No update: Aug 2026", never filled); "Revenue Lines" (rows per revenue segment, total revenue, gross profit, GP %, net profit, NP %, cash in bank, monthly burn, runway, headcount FT, headcount PT, revenue YoY %; monthly columns plus half totals via periodTotals; for non-MYR companies an extra RM block using fx_rate_to_myr, blank where no rate); "KPIs" (KPI x member rows, monthly columns); "Monthly Grid" (one row per month with status, all numbers, derived metrics and KPIs). Brand header fill #E2743A with white bold text, frozen panes, number formats, widths, wrapped narrative, landscape print setup.',
      '2. src/lib/exports/portfolio.ts: rows company, funds, month, status, currency, fx rate, revenue, GP, GP%, NP, NP%, cash, burn, runway, headcount FT/PT, and RM columns -> xlsx and CSV (RFC 4180, UTF-8 BOM, CRLF). src/lib/exports/documents-zip.ts: jszip of a company\'s documents (all or one period close) downloaded with the RLS storage client.',
      '3. Route handlers (assert access first, canExport, load with the RLS client, build, log_audit_event("export", ...), Content-Disposition attachment, JSON 403/404 errors): GET /api/exports/c4/[companyId]?include=approved|all (ScaleUp any role; owners of that company); GET /api/exports/portfolio?format=xlsx|csv&fund=&from=YYYY-MM&to=YYYY-MM&status=approved|all (ScaleUp); GET /api/exports/documents/[companyId]?closeId= (ScaleUp; owners of that company); GET /api/exports/audit?<filters> (CSV of the filtered audit log; audit viewers only). A full-fund export should finish well under 60 s.',
      '3b. Revenue segments (B30) in the C4 workbook and extracts: the Revenue Lines sheet has a "Company revenue segments" block (each segment by id over time, retired ones only where they have values, summing to Total revenue) followed by Total revenue, then a "ScaleUp revenue lines" block (no sum rule); the Monthly Grid has a column per segment of each kind (name at the time; retired segments labelled). Use the data-layer helpers added by the segments core step.',
      '4. /admin/exports: cards for the C4 workbook (company select; not-yet-reporting companies disabled; include toggle), portfolio data extract (fund, from/to months, format, approved only) and document pack (company + period close).',
      '5. /admin/audit (requireScaleUp(["super_admin", "fund_admin", "partner"])): filters in searchParams (company, actor email, action, entity, date range); paginated table (50 per page) with time (formatDateTime), actor (email + role, "System" when null), on-behalf badge, action, entity + id, company, summary; expandable row with changed fields old -> new; "Export CSV" link to the audit export route.',
    ].join('\n'),
  },
  {
    key: 'M8', title: 'Documents & period close (C4)',
    owns: 'src/app/portal/[companyId]/documents/**, src/app/admin/documents/**, src/app/api/documents/**, src/components/documents/**, src/lib/actions/documents.ts, tests/features/m8/**',
    brief: [
      'BRD: section 6.1 period close, C4, A13 (document pack is M9), B6, B13, B20, B21. ARCHITECTURE: 2.2 period_closes and documents (path rules, version trigger), 2.4 confirm_period_close / reopen_period_close, 2.8 storage, section 6 "Period close" (updated).',
      '1. A shared PeriodClosePanel (src/components/documents/) used by the portal and admin pages.',
      '2. /portal/[companyId]/documents: period closes newest first (label, type, range, PERIOD_CLOSE_STATUS_META); per close: the months in the period with their statuses, live totals (periodTotals over submitted/approved months from greatest(period_start, reporting_start_month)): revenue, GP, GP%, NP, NP%, cash at end, average burn, headcount; management accounts and supporting files with versions (file name, version, size, uploaded by - "<name> (ScaleUp)" for staff on the company side (B28) - and when, Download). Upload when canEnterData: file picker (DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES) and type -> server action creates a signed upload target (exact path rules of section 2.8) -> browser uploadToSignedUrl -> server action inserts the documents row (the DB validates path and object). Confirm when canConfirmPeriodClose: dialog with computed totals, optional restatement fields and a reason required when restating -> confirm_period_close. Confirmed state shows who/when, restated vs computed, reason. An "Other documents" area for supporting files not tied to a close. Exited companies read-only.',
      '3. GET /api/documents/[documentId]/download: read the document row with the RLS client (not visible -> 404), assertCanViewCompany, create a 60-second signed URL with the RLS storage client, log_audit_event("download", "document", id, company_id, file name), redirect.',
      '4. /admin/documents: ScaleUp portfolio view with a period selector (Q3 2026, H2 2026, ...): company, close status, months submitted x of y, management accounts count, restated?; ?company=<id> shows that company\'s PeriodClosePanel in ScaleUp mode (fund_admin can upload and confirm on behalf; super_admin and fund_admin can reopen a confirmed close with a reason via reopen_period_close).',
    ].join('\n'),
  },
  {
    key: 'M7', title: 'Tracker & company home (A6, C2, history)',
    owns: 'src/app/admin/tracker/**, src/app/portal/[companyId]/page.tsx, src/app/portal/[companyId]/loading.tsx, src/app/portal/[companyId]/_components/**, src/app/portal/[companyId]/history/**, tests/features/m7/**',
    brief: [
      'BRD: A6, C2, section 6.1 missing/late rules, O3, O7, B4, B5, B16, B19, B21, B28. ARCHITECTURE: section 6 "Tracker" and "Company home" (updated), 2.3 v_submission_overview, 2.4 open_due_periods.',
      '1. /admin/tracker (every ScaleUp role): call rpc open_due_periods() on load; load companies with fund codes and partner-in-charge (company_internal), v_submission_overview for the last 6 months (toggle 12) and settings.escalation_days. Grid: sticky company column (name, funds, partner initials), month columns oldest to newest; cell = status chip (SUBMISSION_STATUS_META tones; overdue red with days; ESCALATED_META when days_overdue > escalation_days), narrative dot (has_narrative), open thread count; cells link to /admin/review/<id>; "-" for months outside the reporting range; companies not yet reporting grouped at the bottom collapsed ("Not yet reporting (15)"); exited/written-off muted. Filters in searchParams: fund, partner, status (including "Needs attention": overdue, changes requested, awaiting review), search. Summary cards for the latest opened month: not submitted, overdue, awaiting review, changes requested, approved, narrative coverage %. Legend. Horizontal scroll on small screens.',
      '2. /portal/[companyId] home (C2): requireCompanyAccess; rpc open_due_periods(); focus card for the earliest month needing action with due date, status and "Continue update" -> /portal/<id>/updates/<YYYY-MM>; red "Missing numbers" list (overdue months); "Changes requested" list with the latest message (author shown as "<name> (ScaleUp)", B28); unresolved shared threads count; last submitted figures (latest submitted/approved month via getFinancialSeries: revenue, GP%, NP%, cash, runway, headcount); upcoming quarter/half close with management accounts status -> /portal/<id>/documents; not-yet-reporting state ("ScaleUp will let you know when monthly reporting starts"); exited companies read-only notice.',
      '3. /portal/[companyId]/history: every month with status, submitted at, approved at, revision, revenue, net profit, cash; link to the read-only form view; for owners (canExport) "Download my data (Excel)" -> /api/exports/c4/<companyId> (built by M9).',
    ].join('\n'),
  },
  {
    key: 'M3', title: 'Template builder (A3)',
    owns: 'src/app/admin/templates/**, tests/features/m3/**',
    brief: [
      'BRD: A3, section 6.1 (C4 categories and fields), 11 (template versioning), B26. ARCHITECTURE: 2.2 templates / template_versions / template_sections / template_fields (system-field rules, default-template rules), 2.4 create_template_draft / publish_template_version, section 3 (seeded template).',
      '1. /admin/templates (super_admin, fund_admin): templates (default "Portfolio Update") with versions: version, TEMPLATE_STATUS_META, published at/by, notes, section and field counts; "Create draft from current" (create_template_draft) or "Continue draft"; view any version read-only.',
      '2. /admin/templates/[versionId]: editor for drafts, read-only otherwise. Sections: reorder (up/down), add (kinds narrative, custom_numbers, pulse), rename, description, delete non-system sections (confirm). Fields per section: reorder; add (label -> auto key slug, editable, unique in the version, [a-z0-9_]; type allowed per section kind: narrative -> long_text, text, picklist, tags, boolean, rating; custom_numbers -> currency, number, integer, percent; pulse -> rating, long_text, tags, picklist); required; help text; options for picklist/tags (one per line); rating min/max/labels; validation (allow_negative, min, max, max_length); system fields editable only in label, help and order (lock icon with tooltip "System field - used in calculations"). "Publish" (publish_template_version) with notes and a ConfirmDialog explaining that months opened from now on use this version while months already opened keep theirs. A live read-only preview of the form layout. Surface DB rule errors via toActionError.',
    ].join('\n'),
  },
  {
    key: 'M4', title: 'Cycles, deadlines, FX & settings (A5)',
    owns: 'src/app/admin/cycles/**, src/app/admin/settings/**, tests/features/m4/**',
    brief: [
      'BRD: A5, section 6.1 due dates and escalation, 12 FX assumption, B4, B11, B12, B18, B19, B25, B27. ARCHITECTURE: 2.2 platform_settings, reporting_periods, fx_rates; 2.4 open_due_periods, open_period, extend_due_date.',
      '1. /admin/cycles (super_admin, fund_admin): rpc open_due_periods() on load. Reporting months table: month, opened (automatic or by whom) and when, due date, template version, companies expected, submitted, approved, overdue (from v_submission_overview grouped by month). "Open current month early" (open_period for the current MYT month) with confirmation. Deadline extensions: submissions with original_due_date (company, month, original -> new, reason) and an "Extend a deadline" dialog (reporting companies, their non-approved months, a later date, reason -> extend_due_date). Upcoming quarter/half closes. FX rates tab: rates by currency and month for the non-MYR currencies companies use (e.g. USD for i-Motorbike), add/edit/delete (rate_to_myr > 0), highlighting months with no rate.',
      '2. /admin/settings (super_admin): platform settings form - due_day (1-28), escalation_days, backfill_grace_days, revenue_swing_pct, min_runway_months, require_mfa (Switch with a warning), default_reporting_start (month), declaration_text, terms_version (explain that changing it makes everyone accept the terms again), owner_contributor_limit ("Maximum contributors a company owner can invite", default 4, B29) -> update platform_settings (RLS: super_admin). Show defaults and last updated.',
    ].join('\n'),
  },
]

function buildPrompt(m) {
  return '\nMODULE ' + m.key + ': ' + m.title + '\nOWNERSHIP (only these paths): ' + m.owns + '\nBRIEF:\n' + m.brief + '\n'
}

function reviewPrompt(m, build) {
  return [
    '',
    'ROLE: Reviewer for module ' + m.key + ' (' + m.title + '). Review ONLY that module\'s files (' + m.owns + ') for:',
    '1. Authorization and data exposure: every page calls its guard; every Server Action and route handler asserts access before anything else; the service-role client only where the contract allows; company users can never see other companies\' data or ScaleUp-internal data (internal comments, company_internal / partner-in-charge, fund_investments, audit log, full platform settings, ScaleUp staff identities - B28); no secrets or internal error text reach the client; inputs zod-validated; no open redirects; downloads/exports gated and audit-logged.',
    '2. Contract and BRD conformance against the brief below, docs/ARCHITECTURE.md and the BRD sections it names: missing features or wrong behaviour.',
    '3. Correctness: real bugs and broken edge cases (empty data, not-yet-reporting companies, exited/written-off companies, non-MYR currency, months without narrative, zero revenue or burn, half-yearly KPIs), Next.js 16 / React mistakes (async params, server/client boundaries, hydration mismatches, stale UI after mutations, missing revalidatePath), accessibility and UX gaps (labels, errors, loading/empty states, mobile for review/approval flows).',
    'Mostly READ code. Run npx tsc --noEmit ONCE (look at errors in this module\'s files), npx eslint on the module paths, and the module tests (npx vitest run tests/features/' + m.key.toLowerCase() + '). Do NOT edit any file. Report only verified, concrete findings with file:line evidence and a concrete fix; no style nits.',
    'MODULE BRIEF:\n' + m.brief,
    'BUILDER REPORT: ' + JSON.stringify(build),
  ].join('\n')
}

function fixPrompt(m, findings, build) {
  return [
    '',
    'MODULE ' + m.key + ' (second pass): fix the verified review findings below in your own files.',
    'OWNERSHIP (only these paths): ' + m.owns,
    'FINDINGS: ' + JSON.stringify(findings),
    'YOUR EARLIER REPORT: ' + JSON.stringify(build),
    'Then re-run npx tsc --noEmit (your files clean), npx eslint on your paths and your module tests. Report fixed, notFixed (with reason), verification and notesForOtherModules.',
  ].join('\n')
}

function integratePrompt(results) {
  return [
    '',
    'ROLE: Feature integrator. All nine modules are built, reviewed and fixed. Their reports follow. You may now edit ANY file under src/, tests/, scripts/ and docs/ARCHITECTURE.md (not src/components/ui/*, package*.json or config files). DATABASE RULE: the migrations are DEPLOYED to Supabase - never edit an existing file in supabase/migrations; if a DB change is truly required, add a NEW migration supabase/migrations/20261001NNNNNN_<name>.sql with PGlite tests in tests/db/, run npm run db:types, and list it in your report (the lead will push it).',
    'TASKS',
    '1. Apply every cross-module request in the modules\' notesForOtherModules and deviations unless unsafe (then explain).',
    '2. Wire-up check: every admin and portal sidebar link resolves to a real page; every cross-module link (tracker -> review, review -> on-behalf form, company -> users?company=, history -> C4 export, home -> documents and updates, review -> documents, exports) uses real routes and correct params. Remove the "STUB" markers left in comment-threads.tsx and submission-form.tsx if implementations replaced them.',
    '3. Run npx next typegen, then npm run typecheck, npm test, npx eslint src tests scripts, npm run build - ONE AT A TIME (you are the only agent running now; the RESOURCE RULES limits on tsc/test/build do not apply to you, but never run two heavy commands at once). A command that may take more than about 2 minutes (npm run build, npm test) must be started with the Bash tool\'s run_in_background option; then keep working (read code) and check its output file with short commands until it finishes - never block on one command for more than about 2 minutes, or you will be killed as stalled. Fix everything until all pass. Delete any "<name> 2.<ext>" iCloud conflict copies in .next if they appear.',
    '4. Update docs/ARCHITECTURE.md (routes and modules as built; mark "(updated)") and add a section 7 change-log entry.',
    'REPORT (structured): summary, files, deviations, verification (exact command results and test counts), openQuestions, notesForOtherModules (anything the lead must do, e.g. push a new migration).',
    'MODULE RESULTS: ' + JSON.stringify(results),
  ].join('\n')
}

function criticPrompt(integration) {
  return [
    '',
    'ROLE: Completeness critic. Audit the BUILT application against every Phase 1 requirement of the BRD: sections 4 (Phase 1 scope), 5 (roles and permissions matrix), 6.1-6.3, 7 (workflow), 8 modules marked Phase 1 (A1, A2, A3, A4, A5, A6, A7, A13, A14), 9 modules marked Phase 1 (C1, C2, C3, C4, C6, C7), 10 outputs that are Phase 1 (C4 workbook export, data extract), 11 non-functional requirements, and every decision B1-B29 in section 13. For each requirement decide: present, partial, missing or broken - by reading the actual code paths (pages, actions, route handlers, SQL), not the reports. Also check that every page in the admin and portal navigation renders for the roles that can see it (guards match nav visibility).',
    'Report ONLY gaps (partial/missing/broken) with severity blocker (a Phase 1 flow cannot be completed), major (a stated requirement is not met) or minor, the evidence (file paths / code) and a concrete fix. Do not edit files. Do not report Phase 2/3 items (reminders, dashboards, AI reports, bulk import, help requests).',
    'INTEGRATION REPORT: ' + JSON.stringify(integration),
  ].join('\n')
}

function gapFixPrompt(gaps, integration) {
  return [
    '',
    'ROLE: Gap fixer. Close the verified completeness gaps below. You may edit any file under src/, tests/, scripts/ and docs/ (not src/components/ui/*, package*.json, config files; never edit deployed migrations - add a NEW migration file if the database must change, with PGlite tests, and run npm run db:types). Prioritise blockers, then majors, then minors.',
    'GAPS: ' + JSON.stringify(gaps),
    'INTEGRATION REPORT: ' + JSON.stringify(integration),
    'Finish with: npx next typegen; npm run typecheck; npm test; npx eslint src tests scripts; npm run build - all must pass, run ONE AT A TIME; start npm test and npm run build with the Bash tool\'s run_in_background option and poll their output files with short commands (never block on one command for more than about 2 minutes). Update docs/ARCHITECTURE.md for any behaviour you add. REPORT: fixed, notFixed (with reason), verification, notesForOtherModules (anything for the lead, e.g. a new migration to push).',
  ].join('\n')
}


const SEG_MODULE = {
  key: 'SEG', title: 'Revenue segments UI (B30): portal segments page, monthly form, admin company tab',
  owns: 'src/app/portal/[companyId]/segments/**, src/components/submission-form/** (M5 form - only the financials/revenue part and what it needs), src/app/portal/[companyId]/updates/** (only if the revenue changes require it), src/app/admin/companies/[companyId]/_components/** (only the revenue lines tab: relabel and the read-only company segments view), src/components/shell/portal-sidebar.tsx (one new nav item), tests/features/seg/**',
  brief: [
    'BRD: section 6.1 (revenue), B30, B5, B21, C3. ARCHITECTURE: revenue_segments (kind company | scaleup), the set_company_revenue_segments RPC, validation rules and the data-layer helpers added by the segments core step - read them first.',
    '1. New portal page /portal/[companyId]/segments ("Revenue segments"): requireCompanyAccess; lists the company\'s active segments (and, collapsed, retired ones with the month they stopped). Owners (canSubmit-level: company owner of an active company) can add, rename, reorder (up/down) and remove segments, then Save; contributors and exited companies see it read-only. First-time setup (no segments yet): a short explanation that segments must add up to total revenue and are reused every month. When segments already exist and the owner saves changes: a ConfirmDialog warning "Changing your revenue segments may affect reporting standards and comparability with previous months. Months you have already submitted keep their segment names and figures; months not yet submitted will use the new segments." Save calls the RPC through a server action (assertCompanyAccess owner; zod; revalidate the segments page, the updates pages and portal home). Show the friendly DB errors (duplicate names etc.).',
    '2. Add "Revenue segments" to PortalSidebar (owners and contributors; between Monthly updates and Documents).',
    '3. Monthly form financials (src/components/submission-form/**): a "Revenue" area with (a) company revenue segments when the company has any: one input per active segment, a live read-only Total revenue that is their sum (saved as revenue_total), and a "Manage segments" link for owners -> /portal/<id>/segments; when the company has none: a Total revenue input plus, for owners, a hint linking to set up segments; (b) a separate "ScaleUp revenue lines" block when ScaleUp has defined any: one required input per active line, with the note "These lines are set by ScaleUp and don\'t need to add up to total revenue". Read-only/past months show exactly the segments and lines that have values in that month (including retired ones, with their names at the time). Inline validation errors must appear only after a field is touched or after a submit attempt (not on first load). Keep everything else in the form as it is.',
    '4. Admin company page, revenue tab (src/app/admin/companies/[companyId]/_components/**): rename it "ScaleUp revenue lines" with the explanation that they need not add up to total revenue (super_admin/fund_admin manage them as before, kind scaleup only), and add a read-only "Company revenue segments" panel (active + retired with dates) so ScaleUp can see the company\'s own breakdown.',
  ].join('\n'),
}

const SEG_CORE = [
  '',
  'ROLE: Segments core engineer (BRD B30). You run first; the UI agents build on your contract. The RESOURCE RULES limits on tsc/test do not apply to you, but run heavy commands one at a time and start npm test with the Bash tool\'s run_in_background option, polling its output file with short commands (never block on one command for more than about 2 minutes).',
  'OWNERSHIP: supabase/** (NEW migration files only - every existing migration is DEPLOYED and must never be edited), tests/db/**, tests/unit/**, tests/data/**, scripts/db-verify.ts, scripts/gen-db-types.ts, src/lib/supabase/database.types.ts, src/lib/data/**, src/lib/types/domain.ts, src/lib/validation.ts, src/lib/metrics.ts, src/lib/constants.ts, docs/ARCHITECTURE.md, docs/build-notes/pending-contract-changes.md. Do not edit feature modules (src/app/**, src/components/**): list the changes they need in notesForOtherModules; keep the data-layer changes backward compatible so existing feature code still compiles (add fields, do not remove them).',
  'READ: BRD section 6.1 (revenue paragraph and quantitative table) and B30; docs/ARCHITECTURE.md revenue_segments, save_submission_values, validation (section 2.6) and the data layer; the migrations for revenue_segments, validate_submission, save_submission_values and their RLS/grants; tests/db/mirror-parity.test.ts and permissions-parity.test.ts.',
  'IMPLEMENT (new migration supabase/migrations/20261001000200_revenue_segments_b30.sql):',
  '1. revenue_segments.kind text not null default \'scaleup\' check (kind in (\'scaleup\', \'company\')) - every existing row is a ScaleUp line; add retired_at timestamptz. Replace the unique (company_id, name) constraint with a partial unique index on (company_id, kind, lower(name)) where is_active (a retired name can be reused). Keep RLS SELECT as is. Direct INSERT/UPDATE/DELETE stay for super_admin/fund_admin but only for kind = \'scaleup\' rows; kind = \'company\' rows change only through the RPC below.',
  '2. public.set_company_revenue_segments(p_company_id uuid, p_segments jsonb) returns setof revenue_segments (security definer, search_path \'\'): caller must be the OWNER of an ACTIVE company (B21) or a super_admin/fund_admin (on behalf; audited as usual). p_segments = ordered array of { id?: uuid, name: text } - the complete desired list of ACTIVE company segments. For each item: an existing active company segment of this company whose name is unchanged keeps its id (sort_order updated); a renamed one is renamed in place ONLY if it has no values in any submitted or approved month - otherwise the old row is retired (is_active false, retired_at now) and a new row is created with the new name, and values in the company\'s editable months (draft, changes_requested) move to the new row; items without id are inserted; active company segments missing from the list are retired and their values in editable months are deleted. Submitted and approved months are never changed. Validate: 0-50 items, names trimmed, 1-80 chars, unique case-insensitively. Friendly P0001/42501 messages. Grant execute to authenticated only.',
  '3. save_submission_values: segment values must reference an ACTIVE segment of the submission\'s company (either kind); refuse retired ones with a friendly message.',
  '4. Validation (private.validate_submission AND its TS mirror src/lib/validation.ts - keep tests/db/mirror-parity green, extend it): every active ScaleUp line and every active company segment needs an amount (code required, target segment:<id>; message "Revenue for <name> is required."), both non-negative; when the company has active company segments, revenue_total must equal their sum (sum_mismatch, tolerance 0.01; message "Total revenue (<x>) must equal the sum of your revenue segments (<y>)."); ScaleUp lines have no sum rule. revenue_total stays required. ValidationInput segments gain kind.',
  '5. Data layer: CompanyConfig keeps segments (all, now with kind) and gains companySegments and scaleupSegments (active, sorted) plus retired company segments with retired_at; add a pure helper (client-safe, in @/lib/types/domain) segmentsForMonth(config, values, editable) returning the company segments and ScaleUp lines to show for a month (editable months: the active ones; read-only months: exactly those with values, including retired ones, ordered by sort_order); toValidationInput includes kind. Add an optional review flag in src/lib/metrics.ts computeFlags: warning segments_exceed_total when the ScaleUp lines add up to more than total revenue (non-blocking; label in constants).',
  '6. PGlite tests (new tests/db/revenue-segments-b30.test.ts + parity updates): RPC permissions (owner yes, contributor no, other company no, exited company no, fund_admin yes, viewer no), rename-in-place vs retire+create, values moved for editable months only, retired values deleted from editable months only, submitted/approved months untouched, unique names, save_submission_values refuses retired segments, validation codes and messages for both kinds, kind scaleup direct writes still work for admins and kind company direct writes are refused. Update existing tests that assumed the old rule (all segments sum to total).',
  '7. npm run db:types; npm run db:verify (rolled back on the real Postgres 17); docs/ARCHITECTURE.md updated (2.2, 2.4, 2.6, 2.7, 5.4, 5.5, 6, change log); mark the migration "to push" in the build notes. Do NOT push it.',
  'VERIFY: npm run typecheck (no errors in your files; list errors your change causes in feature files under notesForOtherModules); npm test (background, polled); npx eslint src tests scripts; types check; db:verify. REPORT: summary, files, deviations, verification, openQuestions, notesForOtherModules (exact new API names/signatures and what each feature module must change).',
].join('\n')

// ---- Orchestration with a global limit on concurrent agents (16 GB machine) ----
const LIMIT = (args && args.concurrency) ? args.concurrency : 3
let activeAgents = 0
const waiting = []
async function acquireSlot() {
  if (activeAgents < LIMIT) { activeAgents += 1; return }
  await new Promise((resolve) => waiting.push(resolve))
  activeAgents += 1
}
function releaseSlot() {
  activeAgents -= 1
  const next = waiting.shift()
  if (next) next()
}
async function run(prompt, opts) {
  await acquireSlot()
  try { return await agent(prompt, opts) } finally { releaseSlot() }
}

function completePrompt(m) {
  return '\nMODULE ' + m.key + ': ' + m.title + ' - RESUME. Earlier builds of this module were interrupted (out of memory, then a network outage) after writing part or most of its files. Read every existing file in your ownership list, compare it with the brief, then complete what is missing, fix what is broken and verify. Do not start over and do not delete working code.\nOWNERSHIP (only these paths): ' + m.owns + '\nBRIEF:\n' + m.brief + '\n'
}

async function moduleChain(m, mode, after) {
  if (after) {
    const dep = await after
    if (!dep && m.key === 'SEG') { log('Segments core failed - skipping the segments UI'); return { key: 'SEG', build: null } }
  }
  const prompt = mode === 'complete' ? completePrompt(m) : buildPrompt(m)
  const build = await run(PREAMBLE + prompt, { label: m.key + (mode === 'complete' ? ' complete' : ' build'), phase: 'Build', schema: BUILD_REPORT })
  if (!build) return { key: m.key, build: null }
  const review = await run(PREAMBLE + reviewPrompt(m, build), { label: m.key + ' review', phase: 'Review', schema: FINDINGS })
  const findings = review && review.findings ? review.findings : []
  let fix = null
  if (findings.length) fix = await run(PREAMBLE + fixPrompt(m, findings, build), { label: m.key + ' fix', phase: 'Fix', schema: FIX_REPORT })
  return { key: m.key, build, review, fix }
}

const byKey = (k) => MODULES.find((m) => m.key === k)
phase('Segments core')
const segCoreP = run(PREAMBLE + SEG_CORE, { label: 'Segments core (B30)', phase: 'Segments core', schema: BUILD_REPORT })
const chains = [
  () => segCoreP.then((r) => ({ key: 'SEG-CORE', build: r })),
  () => moduleChain(byKey('M4'), 'complete', null),
  () => moduleChain(byKey('M7'), 'complete', null),
  () => moduleChain(SEG_MODULE, 'build', segCoreP),
  () => moduleChain(byKey('M6'), 'complete', segCoreP),
  () => moduleChain(byKey('M9'), 'complete', segCoreP),
]
log('Concurrency limit ' + LIMIT + '. Segments core first; M4 and M7 alongside; SEG UI, M6, M9 after the core.')
const results = await parallel(chains)

const compact = results.filter(Boolean).map((r) => ({
  key: r.key,
  build: r.build,
  reviewFindings: (r.review && r.review.findings) ? r.review.findings.map((f) => f.severity + ': ' + f.title) : null,
  fix: r.fix || null,
}))
const failed = ['SEG-CORE', 'M4', 'M7', 'SEG', 'M6', 'M9'].filter((k) => !results.find((r) => r && r.key === k && r.build))
if (failed.length) log('Without a build result: ' + failed.join(', '))
const priorNote = 'M1, M2, M3, M5 and M8 were built, reviewed and fixed in the previous run (reports in docs/build-notes/feature-reports/ plus their fixes on disk); the decisions B28/B29 step is done and pushed.'

phase('Integrate')
const integration = await run(PREAMBLE + integratePrompt({ previousRun: priorNote, thisRun: compact }), { label: 'Feature integrate', phase: 'Integrate', schema: BUILD_REPORT })

phase('Completeness')
const critic = await run(PREAMBLE + criticPrompt(integration) + '\nAlso audit B30 (revenue segments) end to end.', { label: 'BRD completeness critic', phase: 'Completeness', schema: GAPS })
const gaps = critic && critic.gaps ? critic.gaps : []
log('Completeness gaps: ' + gaps.length + ' (' + gaps.filter((g) => g.severity === 'blocker').length + ' blockers, ' + gaps.filter((g) => g.severity === 'major').length + ' major)')
let gapFix = null
if (gaps.length) gapFix = await run(PREAMBLE + gapFixPrompt(gaps, integration), { label: 'Gap fixer', phase: 'Completeness', schema: FIX_REPORT })
return { modules: compact, failed, integration, critic, gapFix }
