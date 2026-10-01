# Database (Supabase)

The database is the security boundary of the platform: strict tenant isolation between portfolio
companies, ScaleUp-internal data (partner-in-charge, internal fields, platform settings) hidden from
companies, MFA and the terms of use enforced in SQL, and an append-only audit log. Contract:
`docs/ARCHITECTURE.md` §2 (schema, RLS, RPCs) and §3 (template).

| File | What it does |
|---|---|
| `migrations/20260930000100_schema.sql` | Enums, the 27 tables (incl. `access_links`), constraints and indexes (§2.1, §2.2) |
| `migrations/20260930000200_helpers.sql` | `private` helpers used by policies (`today_myt`, `mfa_ok`, `terms_ok`, `is_active_user`, `is_scaleup`, `can_view_company`, …) and integrity triggers (updated_at, company config, `company_internal` guard, access-link guard and issuer rule, comments, documents, template guard, `handle_new_user`, email sync) |
| `migrations/20260930000300_audit.sql` | `private.audit_row_change()` on every business table (not `access_links`), append-only guard, `public.log_audit_event()` |
| `migrations/20260930000400_rls.sql` | RLS enabled on every table + all policies (§2.7); `access_links` has none (service role only); company users never read ScaleUp staff profiles (names only, through `staff_display_names()`) |
| `migrations/20260930000500_rpc.sql` | Business rules: periods, saving, validation, workflow, comments, period close, access links (`claim_access_link`, service role only), settings (`get_client_settings`), profiles, templates, companies (§2.4, §2.6) |
| `migrations/20260930000600_views.sql` | `v_submission_financials`, `v_submission_overview` (`security_invoker`) |
| `migrations/20260930000700_storage.sql` | Private `company-documents` bucket + `storage.objects` policies (§2.8) |
| `migrations/20260930000800_grants.sql` | Revokes everything from `anon`/`authenticated`/`PUBLIC`, grants back only what RLS needs, and makes objects created by later migrations closed by default |
| `migrations/20260930000900_cron.sql` | Optional daily `open_due_periods()` at 00:05 MYT via pg_cron (no-op where pg_cron is unavailable) |
| `migrations/20261001000100_decisions_b28_b29.sql` | B28: `staff_display_names(p_ids)` (ScaleUp staff shown to company users as "Name (ScaleUp)", never email or role); B29: `platform_settings.owner_contributor_limit` (default 4, in `get_client_settings()`) and the `company_members` contributor-limit trigger |
| `migrations/20261001000200_revenue_segments_b30.sql` | B30: `revenue_segments.kind` (`company` / `scaleup`) and `retired_at`, partial unique index on active names, guard trigger, `set_company_revenue_segments()`, validation for both kinds, active-segment-only saves |
| `migrations/20261001000300_revenue_total_from_segments.sql` | B30 hardening: `revenue_total` of open months recalculated from the company's segments (`save_submission_values`, `set_company_revenue_segments`); optional `p_expected_ids` optimistic check |
| `seed.sql` | Settings, SV1/SFF funds, template "Portfolio Update" v1 (published), the launch portfolio (BRD Appendix A: 18 companies — the pilot Batik Boutique, RECQA and Kiddocare reporting from July 2026, the rest "Not yet reporting"; every company mapped to its fund, SV1 7 / SFF 11) and the KPIs of Batik Boutique, Kiddocare and Huddle. Fixed UUIDs. Safe to re-run: settings, template and `company_internal` rows are ensured; bootstrap blocks run once (`private.seed_markers`: `funds_v1`, `pilot_companies_v1`, `portfolio_h1_2026_v1`). No users. |
| `config.toml` | Supabase CLI config (`db push`, seed path, local-dev Auth settings) |
| `certs/prod-ca-2021.crt` | Supabase's root CA ("Supabase Root 2021 CA", sha256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`, valid to 2031) — the file behind Dashboard → Database → Settings → SSL configuration → *Download certificate*. Used to verify the database server's TLS certificate (`db:verify`, `db push`); compare the fingerprint with the one you download |

## Applying to the Supabase project

Prerequisites: `.env.local` contains `SUPABASE_DB_URL`, the project's Postgres connection string
(Dashboard → Connect → *Session pooler* or *Direct connection*; the password must be
percent-encoded). No `supabase link` is needed.

**IPv4 networks:** the *Direct connection* host (`db.<ref>.supabase.co`) is IPv6-only unless the
IPv4 add-on is enabled (the `SUPABASE_DB_URL` in `.env.local` is this direct host). On a network
without IPv6 `db push` cannot reach it (the development machine had none on some networks on 30 Sep
2026; the final `db:verify` run that day reached the direct host): then put the **Session pooler**
string (port 5432, user `postgres.<ref>`) in `SUPABASE_DB_URL`. `npm run db:verify` falls back to the
session pooler by itself.

**Verify the server's certificate.** These commands log in as `postgres` (bypasses RLS, owns everything) with the
database password. Without certificate verification an on-path attacker (spoofed DNS, hostile Wi-Fi) could pose as the
server and collect that password. `npm run db:verify` always verifies it (below). For `supabase db push`, end the
connection string with `?sslmode=verify-full&sslrootcert=supabase/certs/prod-ca-2021.crt` (the CLI reads `sslrootcert`;
run from the repository root). You can keep that suffix in `SUPABASE_DB_URL`: `db:verify` honours it too.

```sh
# 0. Dry run on the real database (Postgres 17): applies every migration and the seed in ONE
#    transaction, runs sanity checks, prints PASS/FAIL and always rolls back. Changes nothing.
npm run db:verify

# 1. See what would be applied (connects, changes nothing)
sh -c 'set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL" --include-seed --dry-run'

# 2. First deployment: migrations + seed
sh -c 'set -a; . ./.env.local; set +a; npx supabase db push --db-url "$SUPABASE_DB_URL" --include-seed'

# 3. Later deployments: new migrations only
npm run db:push

# 4. Bootstrap the first Super Admin (and other users)
npm run user:create -- --email someone@scaleup.my --name "Full Name" --role super_admin
```

Notes

- `npm run db:push` runs `supabase db push --db-url "$SUPABASE_DB_URL"` without the seed; extra
  npm arguments are **not** forwarded into that `sh -c` script, so use the full command above for
  `--include-seed` / `--dry-run`.
- Each migration file runs in its own transaction; applied versions are recorded in
  `supabase_migrations.schema_migrations`. Never edit a migration that has been pushed — add a new
  `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` instead (then `npm run db:types`).
- With `--include-seed` the CLI records a hash of `seed.sql` in `supabase_migrations.seed_files`
  and re-runs the seed whenever the file changes. Re-running is safe: the settings row, the
  default template and every company's `company_internal` row are ensured idempotently, and each
  one-time bootstrap block (`funds_v1`, `pilot_companies_v1` = the pilot companies and their KPIs,
  `portfolio_h1_2026_v1` = the rest of the launch portfolio, the fund mapping and Huddle's KPIs)
  runs once and is then recorded in `private.seed_markers`, so rows that admins have deleted since
  are never re-created. New bootstrap rows go into a new block with a new marker key; never edit an
  applied block.
- `config.toml` is not strictly required by `db push --db-url`, but it pins the seed path
  (`[db.seed] sql_paths = ["./seed.sql"]`) and Postgres major version 17, and its `[auth]` section
  mirrors the hosted Auth settings for local development (password length 12, secure password
  change, rate limits). Do **not** run `supabase config push` against production without reviewing
  its `[auth]` section (`site_url` is localhost).
- `npm run db:verify` (`scripts/db-verify.ts`): uses `SUPABASE_DB_URL` (or `SUPABASE_POOLER_URL` /
  the region's session pooler, `SUPABASE_REGION` default `ap-southeast-1`, when the direct host is
  unreachable), never prints connection details, and holds locks on the objects it touches (e.g.
  `auth.users`, `storage.objects`) for the few seconds it runs.
  - **TLS:** every candidate's certificate is verified before the password is sent, host name included
    (`sslmode=verify-full` is the default; `verify-ca` skips the host name; `disable` / `allow` / `prefer` /
    `require` are refused). The CA is `SUPABASE_DB_CA_FILE` (a PEM file) if set, else `sslrootcert=<file>` (or
    `system`) from the URL, else `supabase/certs/prod-ca-2021.crt` for `*.supabase.co` / `*.supabase.com`. The
    direct host and both Supavisor poolers present certificates issued by that CA. Local hosts (`localhost`,
    `127.0.0.1`, `::1`) are not verified.
  - **Transaction control:** a top-level `BEGIN` / `COMMIT` / `END` / `ROLLBACK` / `SAVEPOINT` / `RELEASE` /
    `ABORT` / `START TRANSACTION` / `PREPARE TRANSACTION` in a migration or the seed would end the dry run's single
    transaction and commit part of it for real, so such files are refused before connecting
    (`scripts/sql-transaction-control.ts`); the transaction id is also compared after every file.
  - Last run (30 Sep 2026, second patch): **PASS** on PostgreSQL 17.6 — all 9 migrations and the seed apply as
    `postgres`, 18 checks passed; TLS verified against Supabase Root 2021 CA with the host name checked.
- Supabase's own `public.rls_auto_enable()` (the event trigger that switches RLS on for new tables)
  lives in `public`: the grants migration's `revoke … on all functions in schema public` removes
  EXECUTE from anon/authenticated on it too, which is harmless (event triggers are not called
  through the API) and keeps it out of the Data API.
- The cron migration enables `pg_cron` and schedules job `open-due-periods` (`5 16 * * *` UTC =
  00:05 MYT). If enabling pg_cron is not permitted it only raises a NOTICE; the app still opens
  months on tracker/portal page loads. Check with `select jobname, schedule, command from cron.job;`
  and, if missing, enable pg_cron in Dashboard → Database → Extensions and run:
  `select cron.schedule('open-due-periods', '5 16 * * *', 'select public.open_due_periods()');`

Quick post-deploy checks (SQL editor):

```sql
select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity; -- expect 0 rows
select id, public, file_size_limit from storage.buckets where id = 'company-documents';                       -- private, 26214400
select version_no, status from public.template_versions;                                                     -- 1, published
select count(*), count(reporting_start_month) from public.companies;                                         -- 18, 3
```

## Required dashboard settings (manual)

| Where | Setting |
|---|---|
| Project creation | Region **Singapore (ap-southeast-1)** (PDPA hosting requirement; cannot be changed later) |
| Authentication → Sign In / Providers | Email provider on; **"Allow new users to sign up" off** (users are created by admins / `user:create`) |
| Authentication → Sign In / Providers → Email | **Minimum password length = 12** (the app's rule: 12–72 characters); **Password requirements: none** (length-based passphrases); **Secure password change on**; **Secure email change on**; "Prevent use of leaked passwords" on when the plan offers it (the app shows `weak_password` as "too easy to guess") |
| Authentication → Rate Limits | Almost every Auth call (sign-ins, link verifications, token refreshes) comes from the app server — only the TOTP steps on `/mfa` run in the browser — so these per-IP limits are platform-wide budgets (the app throttles each client first, `src/lib/auth/rate-limit.ts`): **sign-ups and sign-ins 100 / 5 min**, **token refreshes 300 / 5 min**, **token verifications 60 / 5 min**, emails 30 / h (custom SMTP only) — the values in `config.toml` `[auth.rate_limit]` |
| Authentication → Multi-Factor | **TOTP (authenticator app) enabled** (enrol + verify). `platform_settings.require_mfa = true` makes the database refuse all company/ScaleUp data to `aal1` sessions |
| Authentication → URL Configuration | **Site URL** = production URL (`NEXT_PUBLIC_SITE_URL`); **Redirect URLs**: `<site>/auth/confirm`, `<site>/auth/callback` (and `http://localhost:3000/auth/confirm`, `http://localhost:3000/auth/callback` for development) |
| Authentication → Email (provider settings) | **Email OTP expiration = 86400 s** (24 h; the maximum) so invitation and recovery links stay valid for a working day |
| Authentication → Emails → Templates | Links must go through `/auth/confirm` with a token hash, e.g. Invite: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password`; Reset password: `…&type=recovery&next=/set-password`; Magic link: `…&type=magiclink`; Change email: `…&type=email_change` |
| Authentication → Emails → SMTP | **Custom SMTP recommended** before Phase 2 reminders (the built-in sender is rate-limited and for testing only) |
| API → Data API | Exposed schemas: `public` (and `graphql_public`) only. **Never expose `private`** |
| API → Data API → Settings | **"Default privileges for new entities" off** (matches `auto_expose_new_tables = false` in `config.toml`; the migrations already revoke the default privileges of objects they create later) |
| Database → Backups | Pro plan keeps 7 days; the BRD's 30-day target needs PITR or an off-site dump |

## Tests (`npm run test:db`)

The migrations are tested in-process with PGlite (WASM Postgres, no Docker):

- `tests/db/supabase-shim.sql` recreates what the migrations rely on (see below);
  `tests/db/schema.ts` applies shim → migrations (filename order) → seed.
- `tests/db/harness.ts` builds that base image once, caches it as a PGDATA tarball in the OS temp
  dir (keyed by a hash of the SQL), and gives every test file a fresh copy (`freshDb()`).
  Helpers: `createUser({ email, fullName, scaleupRole, isActive, acceptTerms })` (users accept the
  current terms of use unless `acceptTerms: false`), `acceptTerms(userId)`,
  `addMember(companyId, userId, role)`, `createCompany({ reportingStartMonth /* null = not yet
  reporting */, partnerInChargeId /* company_internal */, … })`, `asUser(userId, fn, { aal })`
  (transaction as `authenticated` with `request.jwt.claims` = sub/role/aal/email, like PostgREST),
  `asAnon`, `asService`, `setToday('2026-10-20')` (sets the `app.today` hook read by
  `private.today_myt()`), `expectDenied` (42501) / `expectRule` (P0001).
- `tests/db/scenario.ts` sets up the standard cast (super admin, fund admin, partner-in-charge,
  other partner, viewer, owners/contributors of the pilot companies) and opens months as of a date.
- `tests/db/fixtures.ts` exports the seed's fixed UUIDs and the launch portfolio (`PORTFOLIO`).
- `tests/db/types.typecheck.ts` is a type-level test of the generated types (run `npx tsc --noEmit`).
- `tests/data/` (run by `npm test`) tests `src/lib/data` with the real supabase-js client against a
  small PostgREST fake (`fake-postgrest.ts`; RLS simulated by leaving rows out).

`npm run db:types` regenerates `src/lib/supabase/database.types.ts` from the migrations in the
format of `supabase gen types typescript` (`npx tsx scripts/gen-db-types.ts --check` fails if it
is stale; `POSTGREST_VERSION` sets `__InternalSupabase.PostgrestVersion`, default `14` — the hosted
project runs PostgREST 14; postgrest-js treats 13 and 14 alike).

### How the shim differs from real Supabase

- `postgres` is a **superuser** in PGlite. On Supabase it is a non-superuser with `BYPASSRLS` that
  owns everything the migrations create, so security definer functions bypass RLS in both.
  Statements that need special rights on Supabase (triggers on `auth.users`, policies on
  `storage.objects`, `create extension pg_cron`) cannot be proven here; they follow Supabase's
  documented patterns and the pg_cron step is wrapped in an exception handler.
- No GoTrue, Storage API, PostgREST, Realtime, pg_graphql or pg_cron. The harness reproduces
  PostgREST's per-request `set local role` + `request.jwt.claims`; `auth.uid()`, `auth.role()`,
  `auth.email()` and `auth.jwt()` are copies of Supabase's definitions.
- `auth.users`, `storage.buckets` and `storage.objects` are simplified copies (same column names
  for what the migrations and tests use; no Supabase-owned triggers such as delete protection).
- Roles `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin` and their object
  ownership do not exist; Supabase's default privileges in `public` (ALL to anon, authenticated,
  service_role) are replicated so the tests prove the migrations revoke them.
- PGlite is PostgreSQL **18**; the hosted project runs **17** (`config.toml` pins it). The
  migrations avoid PG16+ features (only PG15 features such as `unique nulls not distinct` and
  `security_invoker` views are used). One known difference: deleting a row that is still referenced
  through an `ON DELETE RESTRICT` foreign key raises SQLSTATE **23001** ("violates RESTRICT setting
  of foreign key constraint") on 18 but **23503** ("violates foreign key constraint") on 17, so the
  app must map both to the "still in use — deactivate it instead" message and tests accept either.
  Before go-live, run the migrations, the seed and this suite once against real Postgres 17
  (`supabase start`, or a branch / staging project with `db push --dry-run` then `db push`).
- Sessions are forced to `TimeZone = UTC` like Supabase (PGlite defaults to the host zone).
- `storage.objects.metadata` is null in the shim unless a test sets it; on Supabase it holds the
  upload's `size` and `mimetype`, which `public.documents` copies (see below).

## Rules the app must know about

- **Terms of use** (BRD B25) are enforced by the database: until a user has accepted the current
  `platform_settings.terms_version` (`accept_terms`), every access helper denies them (only their
  own profile and `get_client_settings()` are readable). Bumping `terms_version` makes everyone
  accept again.
- **Platform settings** are ScaleUp-only (BRD B27). Every signed-in session — also aal1 and
  terms-pending ones — reads `require_mfa`, `terms_version`, `declaration_text`, `due_day` and `owner_contributor_limit` with
  `rpc('get_client_settings')` (one row; use `.maybeSingle()`).
- **Partner-in-charge** is ScaleUp-internal (BRD §6.3, B24): `company_internal.partner_in_charge_id`.
  Every company has exactly one `company_internal` row (created with the company; update it, never
  insert or delete); only Super Admins change the partner (42501 "Only Super Admins can assign the
  partner-in-charge." otherwise).
- **ScaleUp staff on the company side** (BRD B24, B28, decided 1 Oct 2026): company users cannot read
  ScaleUp staff profiles (no emails, roles or the partner-in-charge assignment), but they see staff **names**
  as "<Full name> (ScaleUp)" through `rpc('staff_display_names', { p_ids })` (data layer
  `getStaffDisplayNames`; the bundle's timeline `actor_name` arrives resolved). Ids such as
  `submissions.approved_by`, `submission_events.actor_id` or `comments.author_id` resolve only through
  that function.
- **Contributor limit** (BRD B29): `platform_settings.owner_contributor_limit` (default 4) caps the ACTIVE
  contributors a company owner may have; pending invitations count because an invite creates the active
  membership. The `company_members` trigger refuses the next one for owners with P0001 "Your team already
  has n contributors. Deactivate one, or ask ScaleUp to add more."; ScaleUp and system callers are not limited.
- **Revenue segments** (BRD B30): `revenue_segments.kind` is `company` (the owner's own segments, which add
  up to `revenue_total`) or `scaleup` (ScaleUp revenue lines, no sum rule). Company segments change only
  through `set_company_revenue_segments(p_company_id, p_segments, p_expected_ids default null)` (owner of
  an active company, or Super Admin / Fund Admin on behalf): a segment with no submitted figures is renamed
  in place, otherwise the row is retired and a new series starts; figures of OPEN months are moved or
  cleared and their `revenue_total` recalculated; with `p_expected_ids` given, a changed id set raises
  P0001 ("...changed by someone else. Reload..."). ScaleUp lines are written directly by Super Admin /
  Fund Admin with `kind = 'scaleup'`. `save_submission_values` accepts active segments only and keeps
  `revenue_total` equal to the sum of the company segments present (unless the save sets `revenue_total`
  itself). Submitted and approved months never change.
- **Not yet reporting** (BRD B16): `companies.reporting_start_month` null = no months are opened.
  After setting a start month, call `rpc('open_due_periods')` (or let the next tracker / portal page
  load or the daily job do it) to create the missing months (backfill grace) and closes. Clearing it
  keeps the company's history and opens nothing new; its months are never overdue.
- **Access links** (BRD B14, `public.access_links`): service role only (admin client). Store only the
  sha256 hex of the token; log `invite` / `sign_in_link` / `invite_revoke` with `log_audit_event()`.
  Always set `created_by` to the acting user: the database (`access_links_guard`) lets a Super Admin issue
  links for anyone, and an owner only for contributors who belong to none but that owner's active
  companies (42501 otherwise — for an existing account of another company, add the membership and let
  them sign in as usual). Invitations last at most 7 days, sign-in links 24 hours; links never change once
  issued. Use a link only through `rpc('claim_access_link', { p_token_hash })` (service role): it claims it
  atomically (single use) and re-checks the account and the issuer; no row = not valid.

- **Documents** (`public.documents`) describe a real upload: first upload the file to bucket
  `company-documents` at exactly `<company_id>/<period_close_id or general>/<uuid>-<file name>`
  (lower-case ids, three segments, no `.`/`..`), then insert the row with that `storage_path`.
  The database refuses rows whose file is not in storage or whose folders do not match the row, and
  copies `size_bytes` / `mime_type` from the storage metadata. Sign download URLs (service role) only
  for `storage_path` values read from `documents` rows the caller can see.
- **Exited / written-off companies** are read-only for their members: no saving, submitting,
  documents, period closes, comment replies, resolving threads or team changes. ScaleUp staff can
  still comment, resolve and approve months that were already submitted, but can no longer send a
  month back or reopen a confirmed close: `request_changes`, `reopen_submission`, `extend_due_date` and
  `reopen_period_close` raise P0001 "<Company> is no longer an active portfolio company, so its records
  are read-only." (BRD B21).
- **Default template**: to switch, set `is_default = true` on the new template (it needs a published
  version); the previous default steps down in the same statement. `is_default` cannot be set to
  false directly.
- **Months sent back** (request changes, reopen) are due no earlier than `backfill_grace_days` from
  that day (`original_due_date` keeps the first due date), and a confirmed quarter / half close
  covering the month is reopened (audited) so the company confirms it again after resubmitting.
- **Audit events** (`log_audit_event`): only `export`, `download` (any active user), `invite`,
  `invite_revoke`, `sign_in_link` (Super Admin, or a company owner with `p_company_id` = their
  company) and `mfa_reset` (Super Admin). `p_entity` is a lower-case name such as `documents`.
- **Deleting users**: users who have saved, submitted, approved, commented, uploaded or invited
  anyone are referenced by foreign keys without `ON DELETE`, so `auth.admin.deleteUser` fails with
  "Database error deleting user". Policy: deactivate (`admin_update_profile(p_is_active => false)`)
  and ban in Supabase Auth instead of deleting; the audit trail stays intact.

## Conventions for new migrations

- Name: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_name>.sql`, later than the last one.
- **No transaction control** (`BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, `RELEASE`, `ABORT`,
  `START TRANSACTION`, `PREPARE TRANSACTION`) at the top level of a migration or the seed: `db push` already
  runs each file in its own transaction, and `db:verify` replays them all in one rolled-back transaction
  (it refuses such files; `tests/db/migrations.test.ts` fails on them). PL/pgSQL `begin … end` inside
  `$$ … $$` bodies is fine.
- New tables: `alter table … enable row level security`, policies `to authenticated` with
  `with check` on insert/update, then explicit grants (`grant select[, …] … to authenticated`).
  New objects start closed: the grants migration revokes the default privileges, so nothing is
  reachable by `anon`/`authenticated` (or executable through `PUBLIC`) until it is granted;
  `service_role` keeps its default access. Attach
  `private.audit_row_change('<company source>', '<pk cols>')` to business tables (not to tables
  holding secrets, such as `access_links`) and add them to the isolation matrix in
  `tests/db/isolation.test.ts` (the test fails for uncovered tables; `"service"` marks a
  service-role-only table).
- Access helpers: build on `private.is_active_user()` (active profile + MFA + current terms);
  `private.is_active_session()` (no terms check) is only for `accept_terms`.
- Functions: `security definer` + `set search_path = ''` + schema-qualified names; `revoke execute
  … from public, anon`; `grant execute … to authenticated` only for app-callable RPCs and helpers
  used in policies. Permission failures: `raise exception using errcode = '42501', message = '…'`;
  business-rule failures: plain `raise exception '…'` (P0001) with a British-English message the
  UI shows as-is. Compare nullable helper results null-safely (`is not distinct from`).
- Invoker-rights trigger functions run as the writing user: they may only call built-ins or
  helpers granted to `authenticated`.
- Dates: "today" is `private.today_myt()` (Asia/Kuala_Lumpur; `app.today` overrides it in tests).
