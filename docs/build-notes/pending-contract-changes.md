# Contract changes to apply after the foundation workflow completes

**Status 2026-09-30 (foundation patch):** the decided changes A–K below are **APPLIED** and reflected in
`docs/ARCHITECTURE.md` (item L; see its §7 change log). Verified (re-run at the end of the patch): `npm run
typecheck`, `npm test` (unit 205, db 241, data 25 = 471), `npx eslint src tests scripts`, `npm run build`,
`npm run db:types -- --check`, `npm run db:verify` (hosted Postgres 17.6, one rolled-back transaction: PASS, 17
checks).
Still open: item 5 (bootstrap the first Super Admin; `create-user.ts` issuing access links) and the notes for
feature modules (items 3 flow → M2, 7 → M1).

**Second patch 2026-09-30 (independent review, `tests/db/patch-review.test.ts` now passes without expected failures):**
ScaleUp staff profiles hidden from company users (approvals revealed the partner-in-charge; BRD B24/B28); access links
guarded in the database (issuer rules, validity cap, immutable, atomic single-use `claim_access_link()`; BRD B29);
`reopen_period_close` refused for exited / written-off companies; `db:verify` verifies the server certificate and refuses
files with transaction control. Details: `docs/ARCHITECTURE.md` §7. Verified: typecheck, `npm test` (unit 210, db 266,
data 25 = 501, no expected failures), eslint, build, `db:types --check`, `db:verify` (PostgreSQL 17.6, TLS verified, 18
checks PASS). BRD B28 and B29 (§13) are marked "Confirm" for business sign-off.

| Item | Change | Status |
|---|---|---|
| A | `companies.reporting_start_month` nullable: null = "Not yet reporting" (BRD B16); `open_due_periods()` / `open_period()` skip such companies; setting the start month later opens the missing months and closes on the next `open_due_periods()` (tested null → 2026-07-01); clearing it keeps the history and opens nothing new; never overdue; `prior_months` counts every earlier draft; period close counts from the company's first month in the period; `NOT_YET_REPORTING_META` | APPLIED (`tests/db/reporting-start.test.ts`) |
| B | Seed the whole launch portfolio (block `portfolio_h1_2026_v1`): 18 companies (SV1 7, SFF 11), pilot fund mapping, Huddle KPIs, StayHere written off, i-Motorbike USD (iMotorbike Pte Ltd, Singapore), everyone but the pilot not yet reporting | APPLIED (`tests/db/migrations.test.ts`, fixtures `PORTFOLIO`) |
| C | `public.access_links` (service role only, RLS without policies, not row-audited); `/access` public in the proxy (and self-managed, like `/auth/confirm`) | APPLIED (`tests/db/access-links.test.ts`, `tests/unit/proxy.test.ts`) |
| D | Partner-in-charge moved to `company_internal` (ScaleUp-only, Super Admin assigns, row always exists); `is_partner_of` + RPCs/policies use it; `getCompanyInternal`; permission helpers take the internal row; "Your ScaleUp partner" removed from the portal | APPLIED (`tests/db/partner-in-charge.test.ts`, permissions parity) |
| E | `platform_settings` SELECT ScaleUp-only; `get_client_settings()`; `getClientSettings`; bundle `clientSettings` + nullable `settings`; session/login use the RPC | APPLIED (`tests/db/settings-terms.test.ts`, `tests/data`) |
| F | Terms of use enforced by the database (`private.terms_ok()`); harness users accept by default; a Super Admin can publish a new terms version through the API (and then accepts it like everyone else) | APPLIED (`tests/db/settings-terms.test.ts`) |
| G | `request_changes`, `reopen_submission`, `extend_due_date` refused for non-active companies; approve still allowed | APPLIED (`tests/db/read-only-companies.test.ts`, permissions parity) |
| H | Generated types `PostgrestVersion: "14"` | APPLIED (pinned in `tests/db/types.typecheck.ts`) |
| I | `npm run db:verify` (`scripts/db-verify.ts`) dry run on the real database, always rolled back | APPLIED — PASS on PostgreSQL 17.6 |
| J | `supabase/config.toml` Auth (password length 12, secure password change, rate limits) + dashboard settings in `supabase/README.md` | APPLIED |
| K | F-DATA scratch tests moved into `tests/data/` | APPLIED (25 tests) |
| L | `docs/ARCHITECTURE.md` updated, this file marked | APPLIED |

## Original notes (kept for reference)

1. companies.reporting_start_month NULLABLE — null = "Not yet reporting" (BRD B16) — **APPLIED (A)**
   - open_due_periods(): skip companies with null start; min() already ignores nulls
   - sync on update of reporting_start_month (null → date) creates the missing submissions
     (as built: the next `open_due_periods()` call does it — M1 calls `rpc('open_due_periods')` right after saving)
   - UI: companies list/detail + tracker show "Not yet reporting"; admin sets the start month to onboard
   - tests: null-start company gets no periods/submissions; setting it creates them

2. Seed: full portfolio (docs/build-notes/portfolio-seed.sql) — 18 companies, SV1 7 / SFF 11; StayHere written_off;
   i-Motorbike USD (iMotorbike Pte Ltd, Singapore); Huddle KPIs; pilot 3 keep start 2026-07-01 — **APPLIED (B)**

3. access_links (BRD B14) — our own invite / sign-in links, independent of Supabase OTP expiry — **APPLIED (C)**; the flow
   below is for module M2 (docs/ARCHITECTURE.md §2.2 access_links, §4 route map)
   table public.access_links (id uuid pk, user_id uuid not null → profiles on delete cascade,
     purpose text check in ('invite','signin'), token_hash text not null unique (sha256 hex of 32 random bytes),
     expires_at timestamptz not null (invite 7 days, signin 24 h), created_by uuid → profiles,
     created_at, used_at, revoked_at)
   RLS enabled, NO policies for authenticated (service-role only — auth plumbing, not business data); audit via log_audit_event
   Flow: admin/owner invites → admin.createUser({email, email_confirm: true, user_metadata.full_name}) (or reuse existing)
         → assign role (rpc admin_update_profile as the caller) / membership (insert as caller)
         → create access_link with created_by = the acting user → show URL ${SITE_URL}/access/<token> (copy button) + expiry
         (second patch: the database refuses an OWNER's link for anyone but a contributor confined to that owner's
         active companies — for an existing account of another company just add the membership and tell them to sign in
         as usual; Super Admins may issue links for anyone. Validity ≤ 7 days / 24 h; links never change once issued.)
   Accept: GET /access/[token] = public page (no sign-in from GET; shows "Accept invitation"/"Sign in" button + who it's for)
           POST (server action): hash → rpc claim_access_link(p_token_hash) (service role; atomic single use, re-checks the
           account and the issuer; no row = invalid) → admin.generateLink({type:'magiclink', email})
           → server client verifyOtp({type:'magiclink' (or 'email'), token_hash}) → startIdleClock() → redirect /set-password (invite) or /mfa (signin)
           (never check-then-set used_at: two concurrent requests could both pass the check)
   proxy: /access/* public (as built: also a self-managed auth route like /auth/confirm, so the proxy never writes auth
   cookies there; the action must call startIdleClock() after verifyOtp)
   Admin UI: pending invites (created, expires, revoke, re-issue); "Send new sign-in link" per user
   Owner UI (portal team): same for contributors of own company (only those who belong to no other company; others ask ScaleUp)

4. ARCHITECTURE.md: reflect 1–3 (+ BRD Appendix A portfolio) — **APPLIED (L)**

5. After db push: bootstrap super admin kenneth@scaleup.my ("Kenneth Siew") via scripts/create-user.ts
   → change the script to issue an access link (7 days) instead of printing a password (keep --password for test users)
   Supabase dashboard already done by user: sign-ups disabled (verified disable_signup=true), Site URL + redirect URL set.
   — **OPEN.** Note: `SUPABASE_DB_URL` in `.env.local` is the *direct* host, which is IPv6-only. Earlier on 30 Sep this
   machine had no IPv6 (the final `db:verify` run reached the direct host); if `npm run db:push` cannot connect, use the
   *Session pooler* string (supabase/README.md). `db:verify` falls back to the pooler by itself.

## Resume notes (session 1, 2026-09-30)
- Foundation workflow run: wf_1ea6e328-611 (F-DB, F-AUTH, F-LIB builders → DB reviews ×2 + auth review → fixes → F-DATA → integrator).
  Script: ~/.claude/projects/-Users-kenneth-personal-Documents-ScaleUp-Reporting-Platform/4f9ef32d-71ac-471d-87cd-066d7a48b51c/workflows/scripts/foundation-build-wf_1ea6e328-611.js
- If the run died offline: inspect its journal.jsonl; files already on disk are kept — relaunch the unfinished tracks with prompts that say "continue the existing work".
- Then: apply items 1–5 above → npm run test:db → npm run db:push (+ seed) → create kenneth@scaleup.my → Features workflow (modules M1–M9 in docs/ARCHITECTURE.md §4).
  (Items 1–4 and 6/8 applied by the foundation patch; next: `npm run db:verify` → `db:push` (session pooler URL if the direct host is unreachable) → item 5.)

## Follow-ups surfaced by foundation builders (17:10)
6. platform_settings is readable by company users (incl. internal flag thresholds) → restrict table SELECT to ScaleUp;
   expose what company users need (due_day, declaration_text, terms_version, require_mfa) via a security-definer RPC/view.
   — **APPLIED (E):** `get_client_settings()`.
7. delete_company leaves files in storage → M1 must delete the `<company_id>/` folder via the Storage API after the RPC.
   — note for M1 (unchanged).
8. Access links (item 3): add '/access' to PUBLIC_PAGES in src/lib/supabase/proxy.ts and call markSessionActive() after verifyOtp.
   — **APPLIED (C)** for the proxy; `startIdleClock()` (which calls markSessionActive) is M2's accept action.
9. Brand contrast: white on #E2743A = 3.09:1 (fails AA for normal text) → use darker same-hue orange oklch(0.582 0.154 46.14)
   for filled buttons/text-on-orange; keep #E2743A for accents/logo. — done in the foundation (`--primary` #C25716).
10. Users with activity can't be hard-deleted (FKs) → policy: deactivate + ban (keeps audit trail). Document in BRD.
    — done (BRD B22).

## Status 2026-09-30 22:40 MYT (lead)
- Foundation + patch complete (501 tests green; db:verify PASS on real Postgres 17.6).
- DEPLOYED to Supabase (wxquidkdynbaubcxdtee): migrations 20260930000100–000900 + seed (18 companies, SV1 7 / SFF 11).
  => NEVER edit these migration files again; DB changes go in NEW migration files (2026100100NNNN_*.sql) + `npm run db:push`.
  Push command used (TLS verified): supabase db push --db-url "$SUPABASE_DB_URL?sslmode=verify-full&sslrootcert=<path without spaces>/prod-ca-2021.crt" --include-seed --yes
- Features workflow running: wf_1da6dcbf-db3 (M1–M9 build → review → fix → integrate → BRD completeness critic → gap fix).
- Next after features: Playwright e2e (install @playwright/test + chromium), test users on example.com with TOTP, clean up after;
  then bootstrap Super Admin kenneth@scaleup.my via `npm run user:create` (prints a 7-day /access link).
- BRD B28/B29 added by the patch fixer, marked "Confirm" — ask the user.

## Status 2026-10-01 10:40 MYT (lead)
- Features run wf_1da6dcbf-db3 FAILED overnight: machine out of memory (swap 11 GB) → every agent stalled. Code on disk survived:
  M1 7.9k lines, M2 5.5k, M3 4.5k, M5 5.0k, M6 4.9k, M7 3.9k, M8 4.0k, M9 5.4k; M4 nothing. Completed build reports: feature-reports/M1,M2,M3,M5,M8.json.
- Resumed as wf_3652dfb3-6c4 (same script, pool of 3): M4 build, M6/M7/M9 complete-from-disk, then review → fix for all 9, integrate, BRD critic, gap fix.
- 2026-10-01 ~10:55 MYT: product owner decided B28 = staff shown as "Name (ScaleUp)" to companies; B29 = owners invite new
  contributors up to 4 active per company (Super Admin setting owner_contributor_limit). wf_3652dfb3-6c4 stopped; relaunched as
  wf_8bdb1ddc-857 with a "Decisions" step first (NEW migration 20261001000100_decisions_b28_b29.sql — lead must push it).

## Decisions 2026-10-01 (product owner: BRD §13 B28, B29) — decisions step of wf_8bdb1ddc-857
Applied to the contract (`docs/ARCHITECTURE.md`, items marked "(decisions 2026-10-01)", §7 change log).

| Item | Change | Status |
|---|---|---|
| D1 | NEW migration `supabase/migrations/20261001000100_decisions_b28_b29.sql`: `public.staff_display_names(uuid[])` (B28), `platform_settings.owner_contributor_limit` (default 4, 0–100) + `get_client_settings()` returning it (B29), trigger `company_members_contributor_limit` (owners ≤ limit active contributors; ScaleUp / system exempt) | **TO PUSH** — `npm run db:push` (lead). Dry run PASS on the hosted PostgreSQL 17.6 (`npm run db:verify`: 9 deployed, 1 pending, 22 checks, rolled back). Then `npm run db:types -- --check` stays green (types already generated). |
| D2 | Data layer: `getStaffDisplayNames(sb, ids)`; `listSubmissionEvents` / `getSubmissionBundle` name ScaleUp actors "Name (ScaleUp)" for company users; `ClientSettings.owner_contributor_limit`; `contributorSlotsLeft`, `contributorLimitMessage` (`@/lib/types/domain`); `SCALEUP_LABEL`, `SCALEUP_STAFF_SUFFIX`, `DEFAULT_OWNER_CONTRIBUTOR_LIMIT`, `OWNER_CONTRIBUTOR_LIMIT_MAX` (`src/lib/constants.ts`) | APPLIED (`tests/data`, `tests/unit/constants.test.ts`) |
| D3 | `scripts/db-verify.ts` works on a deployed database: replays only migrations not recorded in `supabase_migrations.schema_migrations` (+ seed), FAILs on unknown / out-of-order versions, best-effort "deployed files unchanged" + seed-hash checks, data checks WARN when deployed, new B28/B29 checks | APPLIED (PASS, see D1) |
| D4 | Tests: `tests/db/decisions-2026-10-01.test.ts`; `tests/db/migrations.test.ts` pins the sha256 of the nine deployed `20260930…` migrations and accepts later timestamps; old-B28 wording updated in `partner-in-charge`, `patch-review`, `isolation`; `settings-terms` + type tests for the new column/RPC | APPLIED |
| D5 | Feature modules (not done by the decisions step): M2 team limit UX + B28 names on the team page; M4 settings field; B28 names in M5–M9 (see `docs/ARCHITECTURE.md` §6); test fixtures with a full `PlatformSettingsRow` / `ClientSettings` need `owner_contributor_limit: 4` (`tests/features/m1/actions.test.ts:67`, `tests/features/m1/render.test.ts:134`, `tests/features/m5/fixtures.ts:336`, `tests/features/m6/fixtures.ts:393`, `tests/features/m6/render.test.ts:98`) | OPEN (feature modules) |
| D6 | `supabase/README.md` still describes the old B28 rule ("ScaleUp staff are anonymous to company users … Show "ScaleUp"") and lists 9 migrations / the old db:verify behaviour; the decisions step may only add NEW files under `supabase/`, so the lead (or F-DB with permission) should update its "Rules the app must know about" B28 paragraph, the migration table (add `20261001000100_decisions_b28_b29.sql`), the B29 limit and the db:verify notes | OPEN (lead) |
- 2026-10-01 12:50 MYT: pushed 20261001000100_decisions_b28_b29.sql to Supabase (TLS verified). pg_cron is active on the live DB (it had opened Jul–Sep 2026 for the pilots).
- Created Super Admin kenneth@scaleup.my (invite link issued for localhost:3001; the user's other project occupies port 3000).
- DEMO DATA TO REMOVE BEFORE LAUNCH: company "Demo Company (test)" (id 21ceb88d-cd7d-4604-a67a-31786dd7fa81; segments Online/Retail; KPIs Active customers/Orders)
  and user demo.owner@example.com (owner). Remove: delete_company (Super Admin, with reason) + deactivate/ban the demo user.
- Dev server for previews: `NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next dev -p 3001`.
- 2026-10-01 ~13:15 MYT: wf_8bdb1ddc-857 stopped (network outage ~11:20 killed M4/M6/M7/M9; M1/M2/M3/M5/M8 reviewed+fixed).
  User decided B30 (two revenue breakdowns: owner-defined company segments sum to total; ScaleUp lines need not) — BRD 6.1 + B30 updated.
  Launched wf_24476f44-93d (script copy: docs/build-notes/workflows/features-finish.js; concurrency 3):
  Segments core (NEW migration 20261001000200_revenue_segments_b30.sql — lead must push) → SEG UI (portal /segments page, form, admin tab),
  M4/M7 complete → review → fix, M6/M9 complete (+segments) → review → fix, then integrate → BRD critic → gap fix.

## B30 — two revenue breakdowns (product owner, 1 Oct 2026) — segments core step of wf_24476f44-93d
Applied to the contract (`docs/ARCHITECTURE.md`, items marked "(B30)", §7 change log).

| Item | Change | Status |
|---|---|---|
| S1 | NEW migration `supabase/migrations/20261001000200_revenue_segments_b30.sql`: `revenue_segments.kind` (`company` \| `scaleup`, default `scaleup` — every existing row, incl. the demo company's Online / Retail, becomes a ScaleUp line) and `retired_at` (trigger `revenue_segments_guard`, check constraint); partial unique index `revenue_segments_active_name_key (company_id, kind, lower(name)) where is_active` replaces `revenue_segments_company_id_name_key`; RLS: admins write `kind = 'scaleup'` rows only; `public.set_company_revenue_segments(uuid, jsonb)` (owner of an active company, or Super Admin / Fund Admin on behalf); `save_submission_values` (active segments only; clears retired company segments' figures from the month saved); `validate_submission` (company segments sum to total, ScaleUp lines only required) | **TO PUSH** — `npm run db:push` (lead). Dry run PASS on the hosted PostgreSQL 17.6 (`npm run db:verify`: 10 deployed, 1 pending, 23 checks incl. the new B30 check, rolled back). Types already generated (`npm run db:types`). |
| S2 | Data layer and libs: `CompanyConfig.companySegments` / `scaleupSegments` / `retiredCompanySegments`; `segmentsForMonth`, `sumSegmentAmounts`, `partitionRevenueSegments`, `segmentKind`, `isCompanySegment`, `normaliseSegmentName`, `companySegmentListError`, `diffCompanySegments` (`@/lib/types/domain`); `setCompanyRevenueSegments` (`@/lib/data`); `ValidationInput.segments[].kind`; `computeFlags({ scaleupLinesTotal })` → `segments_exceed_total`; constants `REVENUE_SEGMENT_*` | APPLIED (`tests/data`, `tests/unit`) |
| S3 | Tests: `tests/db/revenue-segments-b30.test.ts`; `validation`, `mirror-parity`, `permissions-parity`, `migrations` (20261001000100 pinned as deployed), type tests; `scripts/db-verify.ts` B30 check | APPLIED |
| S4 | Feature modules (B30 UI step and M1/M5/M6/M9): portal page `/portal/[companyId]/segments`, form blocks per kind, M1 revenue lines tab = `kind = 'scaleup'` only, review/exports per kind, sidebar link (F-AUTH), feature test fixtures (`kind`, `retired_at`, `...partitionRevenueSegments(segments)`) — see `docs/ARCHITECTURE.md` §6 "(B30)" | OPEN (feature modules) |
| S5 | `supabase/README.md` (lead): add `20261001000200_revenue_segments_b30.sql` to the migration table and a "Rules the app must know" paragraph on the two revenue breakdowns (company segments only through `set_company_revenue_segments`; ScaleUp lines direct; months open for changes follow the current segments). BRD: consider noting in B30 that a renamed segment without submitted figures is simply renamed (no new series) | OPEN (lead) |
- Demo data: after the push, "Demo Company (test)"'s Online / Retail are ScaleUp revenue lines (required each month, no sum rule). To demo B30, define the company's own segments on `/portal/<id>/segments` (as demo.owner@example.com) and, if wanted, deactivate the two lines on the admin company page.
- 2026-10-01 14:35 MYT: pushed 20261001000200_revenue_segments_b30.sql (db:verify PASS on PG 17.6 first). Existing revenue_segments rows became kind 'scaleup'.
  FOLLOW-UP (after the workflow): let the DATABASE keep revenue_total = sum(active company segments) for editable months
  (on save_submission_values and inside set_company_revenue_segments), so a segment change never leaves a stale total that
  blocks submit with sum_mismatch; also clear retired-segment figures on submit. New migration needed.
- 2026-10-01 ~15:15 MYT: in parallel with the integrator, launched wf_8272a216-c3b: (a) E2E QA in isolated e2e/ folder (Playwright; test accounts e2e.*@example.com + "E2E Test Co (automated)", cleaned up after; report-only),
  (b) DB follow-up: NEW migration 20261001000300_revenue_total_from_segments.sql (DB recomputes revenue_total from company segments for editable months; p_expected_ids optimistic check) — NOT pushed yet.
