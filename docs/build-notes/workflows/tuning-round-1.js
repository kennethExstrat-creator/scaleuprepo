export const meta = {
  name: 'tuning-round-1',
  description: 'Round 1 tuning: Title Case labels and segment names, KPI two kinds (B31), expected-ids wiring, 2FA switch removal, then integrate and re-run E2E',
  phases: [
    { title: 'Build', detail: 'labels core, small fixes, KPI core then KPI UI; at most 4 agents at once' },
    { title: 'Review', detail: 'independent review per track' },
    { title: 'Fix', detail: 'track owner fixes verified findings' },
    { title: 'Integrate', detail: 'typegen, typecheck, tests, lint, build; contract docs' },
    { title: 'E2E', detail: 'extend and re-run the Playwright suite against :3001' },
  ],
}

const ROOT = '/Users/kenneth-personal/Documents/ScaleUp Reporting Platform'

const PRE = [
  'You work on the ScaleUp Portfolio Reporting Platform (Phase 1, now in tuning) in: ' + ROOT + '. Read CLAUDE.md, docs/ARCHITECTURE.md (the contract as built; sections 1, 2, 4, 5, 6 and the change log) and the BRD "ScaleUp Portfolio Reporting Platform - BRD.md" section 13 (B28-B40) before you start. Today is 2026-10-01 (Asia/Kuala_Lumpur).',
  'STATE: the whole Phase 1 app is built, integrated (1,644 tests green, production build passing) and the database is DEPLOYED to Supabase, including migrations 20261001000100, 000200, 000300 and the gap fixer\'s 000500 (cycle settings and MFA guard). Every existing migration is deployed: NEVER edit one; database changes go in NEW files named 20261001000NNN_<name>.sql (use the number given in your brief). A dev server runs at http://localhost:3001 against the live database (never stop or start servers).',
  'RULES: only edit files in your ownership list; other agents are editing other files at the same time (at most 4 agents run). No new npm dependencies; never edit src/components/ui/*, package*.json or config files; never touch .env.local or print secrets. Run npx tsc --noEmit at most 3 times in your session; never run npm test, npm run build, next build or next typegen (the integrator does); run only targeted vitest files and targeted eslint. Start any command that may exceed 2 minutes with the Bash tool run_in_background option and poll its output file (never block on one command for more than about 2 minutes). The folder is iCloud-synced: never create files with spaces in their names. If a network error occurs, wait briefly and retry.',
  'CONVENTIONS: British English copy; Server Actions assert access first (assertScaleUp / assertCompanyAccess), zod v4 validation, toActionError; typed query results without casts; the DB enforces rules, src/lib mirrors them for UX (keep tests/db/mirror-parity.test.ts and permissions-parity.test.ts green when you touch validation or permissions).',
  'REPORT (structured): summary, files, deviations, verification (commands and results), openQuestions, notesForOtherModules (exact names/signatures others must use; anything the lead must do, such as migrations to push).',
].join('\n')

const REPORT = {
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
const FIX = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    notFixed: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, reason: { type: 'string' } }, required: ['title', 'reason'] } },
    verification: { type: 'string' },
    notesForOtherModules: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'notFixed', 'verification', 'notesForOtherModules'],
}
const QA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    flows: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'skipped'] }, notes: { type: 'string' } }, required: ['name', 'status', 'notes'] } },
    bugs: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, reproducible: { type: 'boolean' },
      steps: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, evidence: { type: 'string' }, suspectedFile: { type: 'string' },
    }, required: ['title', 'severity', 'reproducible', 'steps', 'expected', 'actual', 'evidence', 'suspectedFile'] } },
  },
  required: ['summary', 'flows', 'bugs'],
}

const TRACKS = {
  labels: {
    title: 'Labels and names (product owner wording, decided 2026-10-01)',
    owns: 'supabase/migrations/20261001000400_labels_title_case.sql (NEW), supabase/seed.sql, src/lib/constants.ts, src/components/submission-form/** (only the hard-coded block titles, which must now come from constants), src/components/comments/target-labels.ts, src/components/review/comparison.ts, src/lib/exports/** (label strings only), src/app/portal/[companyId]/segments/** (titles and copy only), src/components/shell/portal-sidebar.tsx and company-switcher.tsx (nav label only), src/app/admin/companies/[companyId]/_components/** (revenue tab label and headings only), tests/db/**, tests/unit/**, tests/data/**, tests/features/** (only assertions about these labels), docs/ARCHITECTURE.md (section 3 template table and the change log)',
    brief: [
      'A. Revenue breakdown names everywhere. The product owner wants these exact titles: company-defined segments = "Self Defined Revenue Segment"; ScaleUp-defined lines = "ScaleUp Required Revenue Segment". Put them in REVENUE_SEGMENT_KIND_META (src/lib/constants.ts): label and plural both equal to the exact title (titles are singular by the owner\'s choice; a per-item prefix like "ScaleUp Required Revenue Segment: Online" is fine), descriptions updated in the same spirit ("Defined by the company owner. They add up to total revenue." / "Required by ScaleUp for this company. Reported every month; they need not add up to total revenue."). Replace the two hard-coded titles in src/components/submission-form/revenue.tsx with the constants again. Every other place must use the constants or these words: the portal page /portal/[companyId]/segments (page title "Self Defined Revenue Segment", nav item the same, headings, toasts), the admin company tab ("ScaleUp Required Revenue Segment", plus the read-only "Self Defined Revenue Segment" panel), the review comparison groups, comment target labels, export sheet and column headers. Search the whole src tree for "Revenue segments", "revenue segments", "ScaleUp revenue line" and "revenue lines" in user-facing strings and align them (code identifiers and comments may stay). Update every test that asserted the old words.',
      'B. Financials labels (template v1 is published and the Jul-Sep 2026 periods are pinned to it; no real company has submitted yet, only demo/test data, so fix the data in place). New migration supabase/migrations/20261001000400_labels_title_case.sql: update template v1 (template_versions.version_no = 1 of the default template; find the ids the seed uses) so that the section with key financials has title "Financials of The Month" (keep its description sensible), and the system fields are labelled exactly: revenue_total "Total Revenue (of the month)", gross_profit "Gross Profit (of the month)", net_profit "Net Profit (of the month)", cash_in_bank "Cash In Bank (month end)", burn_rate "Burn Rate (per month)", headcount_ft "Full-Time Headcount", headcount_pt "Part-Time Headcount". The template guard trigger (private.guard_template_edit) blocks edits to non-draft versions: read it and either use its system-caller exemption if one exists, or temporarily disable that trigger inside the migration (ALTER TABLE ... DISABLE TRIGGER / ENABLE TRIGGER) with a comment explaining the one-off pre-launch data fix. Make the same changes in supabase/seed.sql (fresh databases and PGlite tests) and in SYSTEM_FIELD_LABELS (src/lib/constants.ts). Validation messages derive from the labels ("Gross Profit (of the month) is required."), so update every test that asserted the old messages or labels (tests/db incl. mirror-parity, tests/unit, tests/data, tests/features fixtures) rather than changing how messages are built.',
      'C. Verify: npx vitest run tests/db tests/unit tests/data (background, polled) all green; targeted tests/features files you changed; npx tsc --noEmit clean for your files; npm run db:verify (rolled back, real Postgres 17) PASS; npm run db:types check unchanged (labels are data, not schema). Do NOT push. Update docs/ARCHITECTURE.md section 3 (template labels) and the change log.',
    ].join('\n'),
  },
  small: {
    title: 'Small fixes: expected-ids wiring, types pin, 2FA switch removal (B40)',
    owns: 'src/lib/supabase/database.types.ts (regenerate only), tests/db/types.typecheck.ts (the one pin), src/lib/data/segments.ts, src/app/portal/[companyId]/segments/actions.ts, src/app/admin/companies/actions.ts (segment on-behalf part only), src/app/admin/settings/** (2FA switch removal), src/app/admin/users/** (only if a 2FA reset affordance is missing), tests/data/**, tests/features/seg/**, tests/features/m4/**, tests/features/m1/** (only assertions you break), docs/ARCHITECTURE.md (sections 2.4, 5.5 and the change log for these items)',
    brief: [
      '1. Regenerate the types: run npm run db:types; then in tests/db/types.typecheck.ts update the set_company_revenue_segments pin to { Args: { p_company_id: string; p_expected_ids?: string[]; p_segments: Json }; Returns: Tables<"revenue_segments">[] } (read the file; keep its style). npx tsx scripts/gen-db-types.ts --check must pass.',
      '2. Optimistic concurrency wiring (migration 20261001000300 is live): src/lib/data/segments.ts setCompanyRevenueSegments gains an optional expectedIds?: readonly string[] and sends p_expected_ids only when given (omit otherwise, never null); the portal segments Server Action passes the ids of the segments the editor opened with; the admin on-behalf segment action does the same. Keep the existing pre-check (it also catches renames and reorders). The DB message ("...changed by someone else. Reload the page...") must reach the user through toActionError. Update tests/data and tests/features/seg accordingly.',
      '3. B40: remove the platform-wide "Require two-factor authentication" switch from /admin/settings (the setting stays true; the form no longer offers it), with a short note that 2FA is always required and locked-out users get a 2FA reset from a Super Admin (check /admin/users already offers "Reset 2FA"; if not, say so in notesForOtherModules rather than building it). Update tests/features/m4.',
      '4. Verify: npx tsc --noEmit clean; npx eslint on your paths; npx vitest run tests/data tests/features/seg tests/features/m4 (and tests/db/types.typecheck is covered by tsc). Update docs/ARCHITECTURE.md for the wiring and B40.',
    ].join('\n'),
  },
  kpiCore: {
    title: 'KPI two kinds (BRD B31) - database, validation, data layer',
    owns: 'supabase/migrations/20261001000600_kpis_b31.sql (NEW), tests/db/**, tests/unit/validation.test.ts and tests/unit/constants.test.ts (only additions), tests/data/**, src/lib/supabase/database.types.ts (regenerate), src/lib/validation.ts, src/lib/metrics.ts, src/lib/constants.ts (KPI constants only - the labels track also edits this file for revenue names; coordinate by editing only the KPI block you add), src/lib/data/**, src/lib/types/domain.ts, scripts/db-verify.ts (one check), docs/ARCHITECTURE.md (sections 2.2, 2.4, 2.6, 2.7, 5.4, 5.5 and change log), docs/build-notes/pending-contract-changes.md (append)',
    brief: [
      'Mirror BRD B30 (revenue segments) for company KPIs exactly as BRD B31 says (re-read B31 in the BRD: it was updated on 1 Oct with the default-KPI rule), with these rules: "ScaleUp Required KPI" = today\'s company_kpis (kind scaleup: admin-defined, required, dimensions and half-yearly allowed); "Self Defined KPI" = kind company, owner-defined, required while active, monthly, single value (no dimension, no half-yearly), value types number, integer, currency, percent, boolean (no text).',
      '1. New migration 20261001000600_kpis_b31.sql: company_kpis.kind text not null default \'scaleup\' check in (scaleup, company), retired_at timestamptz; replace unique (company_id, name) with a partial unique index on (company_id, kind, lower(name)) where is_active; guard trigger (kind never changes; retired_at follows is_active; company-kind rows must be monthly, dimension_id null, frequency monthly, value_type in the allowed set); RLS: direct writes by super_admin/fund_admin for kind scaleup only; company-kind rows change only through public.set_company_kpis(p_company_id uuid, p_kpis jsonb, p_expected_ids uuid[] default null) returns setof company_kpis (security definer, search_path \'\'): caller = owner of an ACTIVE company or super_admin/fund_admin on behalf; p_kpis = ordered array of { id?, name, unit?, value_type }; same semantics as set_company_revenue_segments (rename in place when no submitted/approved month has a value for it, else retire + create and move values of editable months; items missing from the list retire and their values in editable months are deleted; 0-30 items; names 1-80 chars unique case-insensitively; a changed value_type on an existing kpi with submitted values = retire + create); p_expected_ids compared as a set under the lock, P0001 "Your KPIs were changed by someone else. Reload the page to see the latest version." Audited as usual. Grants: execute to authenticated only.',
      '2. save_submission_values: KPI values must reference an ACTIVE kpi of the company (either kind); refuse retired ones with a friendly message. Start from the 20261001000300 body of save_submission_values (it contains the revenue_total recalculation) and keep every existing behaviour; add a PGlite test proving the recalculation still works.',
      '3. Validation (private.validate_submission AND src/lib/validation.ts, parity test extended): every active required kpi of either kind needs a value (company kind: monthly, no members); codes/targets unchanged (required, not_integer, negative where relevant; target kpi:<id>). ValidationInput kpis gain kind. kpiCellsForMonth returns cells for both kinds with kind on each cell.',
      '4. Data layer: CompanyConfig keeps kpis (all, with kind) and gains scaleupKpis and companyKpis (active, sorted) plus retiredCompanyKpis; a client-safe helper kpisForMonth(config, values, editable) like segmentsForMonth (editable months: active ones; read-only months: exactly those with values, including retired, names at the time); setCompanyKpis(sb, companyId, items, { expectedIds }) in @/lib/data. Keep existing exports backward compatible.',
      '5. Tests (new tests/db/kpis-b31.test.ts): RPC permissions matrix (owner yes, contributor no, other company no, exited no, fund_admin yes, viewer no), rename-in-place vs retire+create, value moves for editable months only, deletions for removed kpis in editable months only, submitted/approved untouched, uniqueness, guard trigger rules, save refuses retired kpis, validation for both kinds, direct writes kind scaleup only, p_expected_ids refusal and 2-arg call. Add a db-verify check. npm run db:types; npm run db:verify PASS (rolled back). Do NOT push.',
      '5b. Default ScaleUp Required KPI (B31): platform_settings.default_required_kpis jsonb not null default \'[{"name":"Active Customers","unit":"customers","value_type":"integer"}]\' (array of { name, unit, value_type }, validated by a check or trigger: 0-20 items, allowed value types, unique names); an AFTER INSERT trigger on companies inserts those KPIs for the new company (kind scaleup, frequency monthly, is_required true, sorted); the migration backfills "Active Customers" (integer, customers, monthly, required) for every EXISTING company that has no active ScaleUp KPI with that name (case-insensitive), including the seeded portfolio - admins can remove it per company. Tests: new company gets the defaults, backfill, setting change affects only new companies, Super Admin updates the setting (RLS already allows), company users cannot read it (platform_settings is ScaleUp-only). Add default_required_kpis to the seed settings row.',
      '6. Update docs/ARCHITECTURE.md and append the migration as "to push" in docs/build-notes/pending-contract-changes.md. In notesForOtherModules give the exact API for the KPI UI track.',
    ].join('\n'),
  },
  kpiUi: {
    title: 'KPI two kinds (BRD B31) - portal page, monthly form, admin tab, review, exports',
    owns: 'src/app/portal/[companyId]/kpis/** (NEW), src/app/admin/settings/** (ONLY the new default-KPI editor; keep the small track\'s B40 change intact), src/components/submission-form/** (KPI block only), src/components/shell/portal-sidebar.tsx and company-switcher.tsx (one nav item), src/app/admin/companies/[companyId]/_components/** (KPIs tab: relabel to "ScaleUp Required KPI" + read-only "Self Defined KPI" panel), src/components/review/comparison.ts and src/components/review/** (KPI groups), src/components/comments/target-labels.ts (KPI labels), src/lib/exports/** (KPI sheets by kind), tests/features/kpi/** (NEW), tests/features/m6/**, m9/**, seg/**, m5/** (only assertions you break), docs/ARCHITECTURE.md (sections 4 and 6 for these items)',
    brief: [
      'Build on the KPI core API (read its report and docs/ARCHITECTURE.md). Mirror the revenue segments UI (src/app/portal/[companyId]/segments/** and the revenue block of the monthly form) for KPIs:',
      '1. New portal page /portal/[companyId]/kpis titled "Self Defined KPI": lists the company\'s active self-defined KPIs (name, unit, type) and, collapsed, retired ones with the month they stopped; owners of an active company add, rename, change unit, reorder, remove and Save (contributors and exited companies read-only); first-time explanation (reused every month; required while active); on changes to an existing set, the same comparability ConfirmDialog wording as segments (adapted to KPIs); Server Action with assertCompanyAccess (owner), zod, setCompanyKpis with expectedIds, revalidate the kpis page, updates pages and portal home; friendly DB errors. Add the nav item "Self Defined KPI" after the segments item.',
      '2. Monthly form KPI block: two sub-blocks with titles exactly "ScaleUp Required KPI" (note: "Set by ScaleUp for your company" plus the half-yearly note) and "Self Defined KPI" (note: "Your own operating metrics; set once and reused every month" with a "Manage KPIs" link for owners); inputs per value type as today; read-only/past months show exactly the KPIs with values (incl. retired, names at the time). Inline errors only after touch or submit attempt.',
      '2b. Owners always see an "Add KPI" button in the Self Defined KPI block (also when the company has none yet) linking to /portal/<id>/kpis; contributors see a note that the owner can add KPIs. On /admin/settings add a "Default ScaleUp Required KPIs for new companies" editor (name, unit, type; add/remove/reorder; default row Active Customers) saving platform_settings.default_required_kpis, with the explanation that it applies to companies created from now on and that per-company KPIs are managed on each company page.',
      '3. Admin company KPIs tab: rename to "ScaleUp Required KPI" (manage kind scaleup only, as today) and add a read-only "Self Defined KPI" panel (active + retired with dates). Review comparison: two KPI groups. Comment target labels and exports: KPIs sheet / columns grouped by kind with these titles.',
      '4. Verify: npx tsc --noEmit clean for your files; npx eslint on your paths; tests in tests/features/kpi (render tests with mocks like tests/features/seg) plus the suites you touched.',
    ].join('\n'),
  },
}

function buildPrompt(key) {
  const t = TRACKS[key]
  return PRE + '\nTRACK ' + key + ': ' + t.title + '\nOWNERSHIP (only these paths): ' + t.owns + '\nBRIEF:\n' + t.brief + '\n'
}
function reviewPrompt(key, build) {
  const t = TRACKS[key]
  return PRE + '\nROLE: Reviewer for track ' + key + ' (' + t.title + '). Review ONLY that track\'s files (' + t.owns + ') for: authorization and data exposure (guards, assert* first, RLS/RPC rules, company users never seeing other companies or ScaleUp-internal data), conformance with the brief and BRD B28-B40, correctness and edge cases (empty data, exited companies, retired items, months already submitted, non-MYR), Next.js 16 and React mistakes, accessibility and UX gaps, and consistency of the new wording everywhere. Mostly read code; run npx tsc --noEmit ONCE and the track\'s targeted tests. Do NOT edit files. Report only verified findings with file:line evidence and a concrete fix.\nBRIEF:\n' + t.brief + '\nBUILDER REPORT: ' + JSON.stringify(build)
}
function fixPrompt(key, findings, build) {
  const t = TRACKS[key]
  return PRE + '\nTRACK ' + key + ' (second pass): fix the verified findings below in your own files.\nOWNERSHIP: ' + t.owns + '\nFINDINGS: ' + JSON.stringify(findings) + '\nYOUR EARLIER REPORT: ' + JSON.stringify(build) + '\nRe-run npx tsc --noEmit (your files clean), targeted eslint and your targeted tests. Report fixed, notFixed (with reason), verification and notesForOtherModules.'
}

const LIMIT = (args && args.concurrency) ? args.concurrency : 4
let active = 0
const waiting = []
async function acquire() { if (active < LIMIT) { active += 1; return } await new Promise((r) => waiting.push(r)); active += 1 }
function release() { active -= 1; const n = waiting.shift(); if (n) n() }
async function run(prompt, opts) { await acquire(); try { return await agent(prompt, opts) } finally { release() } }

async function chain(key, after) {
  if (after) { const dep = await after; if (!dep) { log('Track ' + key + ' skipped: its dependency failed'); return { key, build: null } } }
  const build = await run(buildPrompt(key), { label: key + ' build', phase: 'Build', schema: REPORT })
  if (!build) return { key, build: null }
  const review = await run(reviewPrompt(key, build), { label: key + ' review', phase: 'Review', schema: FINDINGS })
  const findings = review && review.findings ? review.findings : []
  let fix = null
  if (findings.length) fix = await run(fixPrompt(key, findings, build), { label: key + ' fix', phase: 'Fix', schema: FIX })
  return { key, build, review, fix }
}

phase('Build')
const labelsP = chain('labels', null)
const smallP = chain('small', null)
const kpiCoreBuildP = labelsP.then((r) => (r && r.build) ? run(buildPrompt('kpiCore'), { label: 'kpiCore build', phase: 'Build', schema: REPORT }) : null)
const kpiP = (async () => {
  const core = await kpiCoreBuildP
  if (!core) return { key: 'kpi', build: null }
  const ui = await run(buildPrompt('kpiUi') + '\nKPI CORE REPORT: ' + JSON.stringify(core), { label: 'kpiUi build', phase: 'Build', schema: REPORT })
  if (!ui) return { key: 'kpi', build: core, ui: null }
  const review = await run(reviewPrompt('kpiUi', ui) + '\nAlso review the KPI core files (' + TRACKS.kpiCore.owns + ') with report: ' + JSON.stringify(core), { label: 'kpi review', phase: 'Review', schema: FINDINGS })
  const findings = review && review.findings ? review.findings : []
  let fix = null
  if (findings.length) fix = await run(fixPrompt('kpiUi', findings, ui) + '\nYou may also edit the KPI core files (' + TRACKS.kpiCore.owns + ') for findings about them.', { label: 'kpi fix', phase: 'Fix', schema: FIX })
  return { key: 'kpi', build: core, ui, review, fix }
})()
const results = await parallel([() => labelsP, () => smallP, () => kpiP])

const compact = results.filter(Boolean).map((r) => ({ key: r.key, build: r.build, ui: r.ui || null, reviewFindings: (r.review && r.review.findings) ? r.review.findings.map((f) => f.severity + ': ' + f.title) : null, fix: r.fix || null }))

phase('Integrate')
const integration = await run(PRE + '\nROLE: Integrator (you run alone; the per-agent limits on tsc/test/build do not apply, but run heavy commands one at a time and start npm test and npm run build with run_in_background, polling their output). You may edit any file under src/, tests/, scripts/, docs/ and e2e/ (not src/components/ui/*, package*.json, config files, deployed migrations). Apply every cross-track request in the reports below; make sure every user-facing string uses the new wording ("Self Defined Revenue Segment", "ScaleUp Required Revenue Segment", "Self Defined KPI", "ScaleUp Required KPI", "Financials of The Month", the new field labels) and nothing old remains; run npx next typegen, npm run typecheck, npm test, npx eslint src tests scripts, npm run build until all pass; update docs/ARCHITECTURE.md (routes, sections 3, 5, 6, change log) and list in notesForOtherModules the migrations the lead must push (20261001000400 and 20261001000600 if present) and anything else for the lead.\nTRACK RESULTS: ' + JSON.stringify(compact), { label: 'Round 1 integrate', phase: 'Integrate', schema: REPORT })

phase('E2E')
const e2e = await run(PRE + '\nROLE: E2E QA. The lead has pushed the new migrations by now (if a flow fails because the live database lacks set_company_kpis or the new labels, say so and stop early). Work ONLY in e2e/ (its own packages are installed; read e2e/README or the existing tests first). Extend the suite: assert the new titles and field labels on the monthly form; add a flow where the owner creates two Self Defined KPIs on /portal/<id>/kpis, fills them in the July form next to the ScaleUp Required KPI, and the review page shows both groups; keep all existing flows. Run the whole suite against http://localhost:3001 (one worker; retry once), then tear down as the suite already does. Report flows and bugs; do not edit application code.\nINTEGRATION REPORT: ' + JSON.stringify(integration), { label: 'Round 1 E2E', phase: 'E2E', schema: QA })

return { tracks: compact, integration, e2e }
