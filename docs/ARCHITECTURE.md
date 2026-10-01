# ScaleUp Portfolio Reporting Platform — Architecture & Build Contract (v1 / Phase 1 MVP)

This document is the **single source of truth** for how the platform is built. Every module is
implemented against the contracts here (table/column names, RPC signatures, routes, shared library
APIs). If you must deviate, record the deviation in your final report so the contract can be updated.

Business requirements live in `ScaleUp Portfolio Reporting Platform - BRD.md` (repo root).
Phase 1 scope = BRD §4 Phasing item 1 + every module marked Phase 1 in BRD §8 and §9.

> **Status (updated 2026-09-30, foundation integration + contract patch).** The foundation modules F-DB,
> F-AUTH, F-LIB and F-DATA are built and verified; the stubs of §5.7 exist. Items marked **(updated)**
> describe what was actually built where it differs from, or adds to, the original contract; feature
> modules M1–M9 code against this version. The decided changes of
> `docs/build-notes/pending-contract-changes.md` are applied (see §7): "Not yet reporting" companies
> (nullable `reporting_start_month`), the full launch portfolio in the seed, `access_links` (BRD B14),
> the partner-in-charge moved to `company_internal`, ScaleUp-only platform settings with
> `get_client_settings()`, terms of use enforced by the database, and read-only exited companies that can
> no longer be sent back. The migrations and seed were dry-run on the hosted Postgres 17
> (`npm run db:verify`, PASS). Operational database notes (deploying, dashboard settings, rules the app
> must know): `supabase/README.md`.
> **Second patch (2026-09-30, independent review):** ScaleUp staff profiles are hidden from company users
> (approvals revealed the partner-in-charge), access links are guarded in the database (who may issue a
> link for whom, validity cap, atomic single-use `claim_access_link()`), confirmed closes of exited companies
> can no longer be reopened, and `db:verify` verifies the server's TLS certificate and refuses files with
> transaction control. See §7.
> **Decisions 2026-10-01 (product owner, BRD §13 B28, B29; items marked "(decisions 2026-10-01)"):** on the
> company side ScaleUp people are shown as **"<full name> (ScaleUp)"** (never their email or role; their
> profiles and the partner-in-charge stay hidden) through `staff_display_names()` / `getStaffDisplayNames`;
> company owners can have at most **`platform_settings.owner_contributor_limit`** (default 4, a Super Admin
> setting) active contributors per company — ScaleUp can add more. New migration
> `20261001000100_decisions_b28_b29.sql` (**deployed** 1 Oct 2026, 12:50 MYT); the 0100–0900 files and it are
> deployed and must never change (`tests/db/migrations.test.ts` pins them). `db:verify` now replays only the
> migrations a deployed database has not recorded yet (plus the seed). See §7.
> **B30 — two revenue breakdowns (product owner, 1 Oct 2026; items marked "(B30)"):** `revenue_segments.kind` is
> `company` (the company's **own** revenue segments, defined by its owner in the portal through
> `set_company_revenue_segments()`; they add up to total revenue, which is calculated from them, and carry over every
> month) or `scaleup` (revenue lines ScaleUp defines per company with direct writes, as before; required every month,
> no sum rule; every row that existed before is one). Changing company segments warns about comparability; a renamed
> segment with figures in a submitted or approved month starts a new series, months still open for changes follow the
> new set, and submitted / approved months never change. New migration `20261001000200_revenue_segments_b30.sql`
> (**to push**: `npm run db:push`). See §2.2, §2.4, §2.6, §2.7, §5.4, §5.5, §6 and §7.
> **Feature integration (1 Oct 2026; items marked "(updated, integration)"):** the nine feature modules M1–M9 and
> the B30 segments UI (module SEG) are built, reviewed, fixed and wired together. §4 now lists the routes and
> ownership as built (incl. `/portal/[companyId]/segments`, the deep-link parameters and `GET /api/exports/audit`),
> §5 the shared APIs the modules added, §5.7 the props as built and §6 the cross-module rules settled during
> integration (months still requested, open-month totals, deadline extension limits, export navigations). No
> database change: the B30 migration above is still the only one to push. See §7.

---

## 0. Stack and conventions

| Area | Choice |
|---|---|
| Framework | **Next.js 16.3** App Router, `src/` dir, React 19.2, TypeScript strict |
| UI | Tailwind CSS v4, shadcn/ui (style `radix-nova`, Radix primitives) in `src/components/ui/*` (generated — do not hand-edit), `lucide-react` icons, `sonner` toasts |
| Validation | **zod v4** (`import { z } from "zod"`; v4 API: `z.email()`, `z.uuid()`, `error.issues`, `z.flattenError(err)`) |
| Backend | **Supabase**: Postgres 17 + Row Level Security, Auth (email + password, TOTP MFA), Storage |
| Supabase libs | `@supabase/ssr` 0.12 (cookie sessions), `@supabase/supabase-js` 2.117 |
| Excel | `exceljs`; zip: `jszip` |
| Dates | `date-fns` v4; all "today" logic in **Asia/Kuala_Lumpur** (UTC+8) |
| Tests **(updated)** | `vitest` (unit + DB), `@electric-sql/pglite` 0.5.8 (in-process **PostgreSQL 18.3** with a Supabase shim, `tests/db/supabase-shim.sql`) for migration/RLS tests. Production is Postgres 17: some error codes differ (FK `ON DELETE RESTRICT` raises `23001` on 18 and `23503` on 17) — code must accept both. |
| Package manager | **npm**. All dependencies are pre-installed. Do **not** add packages; if one is truly needed, say so in your report. |

### Next.js 16 rules (breaking changes vs older versions — read `node_modules/next/dist/docs/` when unsure)
- Middleware is now **`src/proxy.ts`** exporting `export async function proxy(request: NextRequest)` (Node runtime).
- `params`, `searchParams`, `cookies()`, `headers()` are **async** — always `await` them.
- Page/layout props: use the global helpers `PageProps<'/admin/review/[submissionId]'>` / `LayoutProps<'/portal/[companyId]'>`, e.g. `export default async function Page(props: PageProps<'/admin/review/[submissionId]'>) { const { submissionId } = await props.params }`.
  **(updated)** These globals are generated into `.next/types` by `next dev` / `next build` / `npx next typegen`; after adding a route run `npx next typegen` if `tsc` cannot find them.
- `cacheComponents` is **off**. Pages that read cookies are dynamic automatically. Do not use `"use cache"`.
- After mutations in Server Actions call `revalidatePath(path)` (from `next/cache`) for affected routes. `revalidateTag` now needs 2 args — avoid it.
- Server Actions are public POST endpoints: **every action re-checks auth + permission** (see §5.2) even though RLS also enforces it.
- ESLint runs via `npx eslint <paths>` (no `next lint`).

### Coding conventions
- British English in all UI copy (BRD house style): "organisation", "authorise", "finalise".
- Money is entered in the company's **reporting currency** (default `MYR`) and displayed with `formatMoney()` → `RM 1,234,567`. Numbers are right-aligned with `tabular-nums`.
- A **month** is stored as a `date` on the first day (`2026-09-01`) and appears in URLs as `YYYY-MM` (`2026-09`). Helpers in `src/lib/periods.ts`.
- Server Components fetch data; Client Components (`"use client"`) handle interactivity; mutations go through **Server Actions** in an `actions.ts` next to the route (file starts with `"use server"`), returning `ActionResult<T>` (§5.3).
- Use the RLS-scoped server client (`createClient()` from `@/lib/supabase/server`) for all data access. The service-role client (`createAdminClient()`) is **only** for Supabase Auth admin APIs (invite, ban, MFA reset) and storage signed URLs where noted — never for reading/writing business tables (it would bypass RLS **and** lose the audit actor).
- Keep components small; colocate route-private components in `_components/` folders inside the route.
- Every user-visible string about status/roles comes from `src/lib/constants.ts` so wording is consistent.
- **(updated)** Client Components import types and pure helpers from `@/lib/types/domain` (client-safe), never from `@/lib/data` (server-only: it imports `"server-only"`).
- **(updated)** `src/hooks/use-mobile.ts` is shadcn-generated (used by `components/ui/sidebar.tsx`); it was rewritten with `useSyncExternalStore` to satisfy the React hooks lint rule — keep that form.
- **(updated)** Branding: use `<Logo className="h-8" />` from `@/components/shell/logo` (the ScaleUp logo supplied by the user, `public/brand/scaleup-logo.png`; `/brand/*` is excluded from the proxy). Theme tokens in `src/app/globals.css`: `--primary` is the darker brand orange `#C25716` (4.5:1 with white text); the logo orange `#E2743A` is `--brand` / `text-brand` / `bg-brand`, `--ring` and `--chart-1`.

---

## 1. Roles and permissions

ScaleUp roles live on `profiles.scaleup_role` (`super_admin | fund_admin | partner | viewer`, null for company users).
Company roles live on `company_members.role` (`owner | contributor`); a person can belong to several companies (multi-company founders).

| Action | Super Admin | Fund Admin | Partner | Viewer | Co. Owner | Co. Contributor |
|---|---|---|---|---|---|---|
| Manage funds, companies, users, platform settings | Yes | No | No | No | No | No |
| Manage templates, company KPIs, revenue segments, FX rates **(B30: "revenue segments" = ScaleUp revenue lines, `kind = 'scaleup'`)** | Yes | Yes | No | No | No | No |
| Define the company's own revenue segments **(B30, new; `set_company_revenue_segments`, active companies only)** | On behalf (logged) | On behalf (logged) | No | No | Yes | No (read only) |
| Open months early, extend deadlines **(updated: deadlines of active companies only)** | Yes | Yes | No | No | No | No |
| Enter data, upload files | No | On behalf (logged) | No | No | Yes | Yes |
| Submit / resubmit month; confirm period close; request amendment | No | No (fund admin may confirm period close on behalf) | No | No | Yes | No |
| Comment (start threads), request changes **(updated: request changes on active companies only)** | Yes | Yes | Yes (any company) | No | Reply only | Reply only |
| Resolve comment threads | Yes | Yes | Yes | No | Yes (shared threads) | Yes (shared threads) |
| Approve submission / reopen approved month **(updated: reopen on active companies only)** | Yes | Reopen only | Yes (own companies) | No | No | No |
| Reopen a confirmed period close **(updated: active companies only)** | Yes | Yes | No | No | No | No |
| Edit internal fields (rating, exit status, notes) | Yes | Yes | Yes (own companies) | No | No | No |
| Assign the partner-in-charge **(updated, new)** | Yes | No | No | No | No | No |
| View | All | All | All | All | Own companies | Own companies |
| Export | Yes | Yes | Yes | Yes | Own company data | No |
| View audit log | Yes | Yes | Yes | No | No | No |
| Invite users | Any | No | No | No | Contributors of own company **(updated: access links only for contributors who belong to no other company, BRD B29; (decisions 2026-10-01) up to `owner_contributor_limit` active contributors, default 4)** | No |

Company users **never** see: other companies, `company_internal` (incl. the partner-in-charge), `fund_investments`, internal comments, the audit log **(updated:)**, the full `platform_settings` or **ScaleUp staff profiles** (emails, roles; see the partner-in-charge rules below). **(decisions 2026-10-01, BRD B28)** They see ScaleUp people by name with a "(ScaleUp)" label — "Renuka Sena (ScaleUp)" — through `staff_display_names()` only.
**2FA** (TOTP) is required for everyone when `platform_settings.require_mfa` is true (default). The database enforces it too:
helper functions only grant access when the JWT `aal` claim is `aal2` (see `private.mfa_ok()`).

**(updated) Rules as built** (database and `src/lib/auth/permissions.ts` agree; `tests/db/permissions-parity.test.ts` checks every helper against the real policies and RPCs for every role):
- **Exited / written-off companies are read-only (BRD B15, B21)** for their members **and** for Fund Admin on-behalf work: no saving values, submitting, requesting amendments, uploading documents, confirming period closes, replying to or resolving threads, or team changes. Members get the P0001 message `"<Company> is no longer an active portfolio company, so its records are read-only."`. ScaleUp reviewers can still comment, resolve threads and **approve months already submitted** (to finalise the history), but **(updated)** can no longer send a month back or reopen a confirmed close: `request_changes`, `reopen_submission`, `extend_due_date` and **(updated, second patch)** `reopen_period_close` raise the same P0001 (after the permission check, so callers without the role still get 42501; system callers too). A reopened close of such a company could never be confirmed again, since `confirm_period_close` needs an active company.
- Every database access helper requires an **active profile, satisfied MFA and the current terms of use accepted** **(updated)** (`private.is_active_user()` = `is_active_session()` + `terms_ok()`): `aal1`, deactivated and terms-pending sessions read empty sets (apart from their own profile) and RPCs raise 42501. Every signed-in session can still call `get_client_settings()`; `accept_terms()` only needs an active account with MFA.
- **Terms of use (updated, BRD B25)** are enforced by the database (`private.terms_ok()`: `profiles.terms_version = platform_settings.terms_version` and `terms_accepted_at` set) and by the app (`require*`/`assert*` guards; `getAccessContext()` returns no role and no memberships until accepted). Bumping `platform_settings.terms_version` makes every user accept again.
- **Platform settings (updated, BRD B27)** are ScaleUp-only (flag thresholds and escalation rules stay internal). Every signed-in session reads `require_mfa`, `terms_version`, `declaration_text` and `due_day` through `get_client_settings()`.
- **Not yet reporting (updated, BRD B16)**: a company without `reporting_start_month` gets no months and no period closes; setting the start month later opens the missing months on the next `open_due_periods()` (with the backfill grace period); clearing it again keeps the history and opens nothing new (its months are never overdue).
- **Funds**: every ScaleUp role can view `/admin/funds` (nav shows it to all); only Super Admin changes funds or fund investments.
- Company owners add/edit/remove only `contributor` rows of their own **active** company, and only for company-side accounts (profiles without a ScaleUp role). Super Admin manages any membership.
- **Owners' contributor limit (decisions 2026-10-01, BRD B29).** An owner can have at most `platform_settings.owner_contributor_limit` (default **4**, 0–100, a Super Admin setting) **active** contributors per company. A pending invitation counts (inviting someone creates their active membership); deactivated contributors do not. Inviting, reactivating or moving in a contributor beyond it is refused by trigger `private.company_members_contributor_limit()` with P0001 `"Your team already has 4 contributors. Deactivate one, or ask ScaleUp to add more."` (`"… 1 contributor. …"`; with the limit at 0 and no contributors: `"Only ScaleUp can add contributors to your team. Ask ScaleUp to add them."`). ScaleUp staff (Super Admins, as far as RLS lets them write) and system / service-role callers are not limited. Everyone reads the limit through `get_client_settings()`; `contributorSlotsLeft` / `contributorLimitMessage` (`@/lib/types/domain`) mirror it for the team page.
- The **partner-in-charge (updated, BRD §6.3, B24)** is ScaleUp-internal: `company_internal.partner_in_charge_id`, never on the company-visible `companies` row and never shown on the company side (no table, view, embed or RPC exposes it to company users; `tests/db/partner-in-charge.test.ts`). Only Super Admins assign it (trigger `private.company_internal_guard()`, 42501 `"Only Super Admins can assign the partner-in-charge."`); Fund Admins and the partner-in-charge edit the other internal fields.
- **ScaleUp staff on the company side: named, never exposed (updated, decisions 2026-10-01; BRD B24, B28).** Company users still cannot read **any** ScaleUp staff profile (`profiles_select`: self, everyone for ScaleUp, and for company users only the company-side accounts of their co-members): no email, no role, and the partner-in-charge assignment (`company_internal`) stays ScaleUp-internal. Company-visible rows hold ScaleUp staff ids — `submissions.approved_by` / `last_saved_by`, `submission_events.actor_id`, `comments.author_id` / `resolved_by`, `documents.uploaded_by`, `period_closes.confirmed_by`, `company_members.invited_by` — and, as the product owner decided on 1 Oct 2026, the company side shows those people **by name with a "(ScaleUp)" label**, e.g. **"Renuka Sena (ScaleUp)"** (or "ScaleUp" when the person has no name), on comments, timelines, approvals and documents. The only way to resolve them is `staff_display_names(ids)` (§2.4; data layer `getStaffDisplayNames`, §5.5), which returns just that display name for ScaleUp staff ids and nothing for other ids. Show `SCALEUP_LABEL` ("ScaleUp") only when no person can be named (system actions). ScaleUp pages keep plain names and roles from the profiles (`tests/db/decisions-2026-10-01.test.ts`, `tests/db/partner-in-charge.test.ts`, `tests/db/patch-review.test.ts`).
- **Company revenue segments (B30).** The company **owner** of an **active** company — or a Super Admin / Fund Admin
  on the owner's behalf (audited `on_behalf`) — sets the company's own segments with `set_company_revenue_segments()`
  (§2.4); contributors, partners and viewers only read them; nobody writes `kind = 'company'` rows directly. Exited /
  written-off companies are read-only for everyone (the read-only P0001). **(updated, integration)** Permission helper
  `canManageCompanySegments(ctx, companyId, companyStatus?)` (§5.2): owner of an active company, or Super Admin / Fund
  Admin while the company is active (`tests/db/permissions-parity.test.ts` checks it against the RPC). The portal page
  uses it; the ScaleUp company page shows the company's own segments read-only (no on-behalf editor yet). ScaleUp
  revenue lines (`kind = 'scaleup'`) stay with `canManageTemplates`.
- Users with history cannot be hard-deleted (foreign keys without `ON DELETE`): deactivate with `admin_update_profile(p_is_active => false)` and ban in Supabase Auth.

---

## 2. Database (Supabase Postgres)

Migrations: `supabase/migrations/<timestamp>_<name>.sql` (applied in filename order). Seed: `supabase/seed.sql`.
Schemas: **`public`** = tables, views, app-callable RPCs (exposed via the Data API). **`private`** = helper and trigger
functions (not exposed; `authenticated` gets `USAGE` on the schema and `EXECUTE` on helpers used in RLS policies).
All `security definer` functions use `set search_path = ''` and fully-qualified names.
Grants: `revoke all on all tables/functions in schema public from anon`; grant table privileges to `authenticated`
only as needed (RLS does the row filtering); `service_role` keeps full access.

**(updated) Grants as built** (`20260930000800_grants.sql`): `anon` has nothing at all. New objects start closed —
`alter default privileges revoke execute on functions from public` and the Supabase default grants in `public` are
reversed for `anon`/`authenticated`, so later migrations must grant their own objects explicitly (see
`supabase/README.md`, "Conventions for new migrations"; `config.toml` sets `[api] auto_expose_new_tables = false`).
`service_role` has no UPDATE/DELETE/TRUNCATE on `audit_log`. `authenticated` may UPDATE only the `notes` column of
`template_versions`, **(updated)** has only SELECT/UPDATE on `company_internal` (the row always exists) and nothing
at all on `access_links` (service role only) **(updated, second patch)** nor EXECUTE on `claim_access_link()` (the one
public RPC that only the service role may call). Migration files: `0100_schema`, `0200_helpers`, `0300_audit`, `0400_rls`, `0500_rpc`,
`0600_views`, `0700_storage`, `0800_grants`, `0900_cron` (daily `open_due_periods()` via pg_cron at 00:05 MYT when available)
— all `20260930…`, **deployed** to the Supabase project on 30 Sep 2026 and never edited again (`tests/db/migrations.test.ts`
pins their sha256) — and **(decisions 2026-10-01)** `20261001000100_decisions_b28_b29.sql` (**deployed** 1 Oct 2026, pinned
too: `staff_display_names()`, `platform_settings.owner_contributor_limit`, `get_client_settings()` with that column, the
contributor-limit trigger) and **(B30)** `20261001000200_revenue_segments_b30.sql` (**to push**: `revenue_segments.kind` /
`retired_at`, the partial unique name index, trigger `revenue_segments_guard`, RLS for `kind = 'scaleup'` writes,
`set_company_revenue_segments()`, the new segment rules of `validate_submission()` and `save_submission_values()`). Every
later database change is a NEW file `<YYYYMMDDHHMMSS>_<name>.sql` sorting after the last one, then `npm run db:types`.
**(updated)** Verified on the hosted Postgres 17.6 with `npm run db:verify`: **(decisions 2026-10-01)** it replays in one
rolled-back transaction exactly what `db push --include-seed` would run next — the migrations not yet recorded in
`supabase_migrations.schema_migrations` (on an empty database: all of them), then the seed — refuses (FAIL) recorded versions the
repository lacks or pending files older than the newest deployed one, compares the deployed files with the statements `db push`
recorded (best effort, WARN), and downgrades data-dependent checks to WARN on a deployed database. Supabase's own event-trigger
function `public.rls_auto_enable()` also loses EXECUTE for anon/authenticated through the grants migration (harmless; it is not an
RPC).

**(updated) System callers**: a caller with no end-user JWT (service-role key, pg_cron, direct DB session;
`private.is_system()`) may run the admin RPCs (`open_period`, `extend_due_date`, `reopen_submission`,
`reopen_period_close`, `admin_update_profile`, `create_template_draft`, `publish_template_version`,
`set_company_status`, `delete_company`, `log_audit_event`, `open_due_periods`). Company-side RPCs (`save_submission_values`,
`submit_submission`, `request_amendment`, `confirm_period_close`, `resolve_comment`) always need a signed-in user.
**(updated, second patch)** `claim_access_link` is for system callers **only** (service-role key; anon and authenticated
have no EXECUTE). **(decisions 2026-10-01)** `staff_display_names` is for signed-in users only (system callers get 42501); system
callers are not held to the owners' contributor limit.

### 2.1 Enums (`public`)
```
scaleup_role:        super_admin, fund_admin, partner, viewer
company_role:        owner, contributor
company_status:      active, exited, written_off
submission_status:   draft, submitted, changes_requested, approved
internal_rating:     on_track, watch, at_risk
kpi_frequency:       monthly, half_yearly
kpi_value_type:      number, integer, currency, percent, boolean, text
field_type:          currency, number, integer, percent, text, long_text, rating, picklist, tags, boolean
section_kind:        financials, headcount, kpis, custom_numbers, narrative, pulse
template_status:     draft, published, archived
comment_visibility:  shared, internal
close_period_type:   quarter, half
period_close_status: open, confirmed
document_type:       management_accounts, supporting
```
TypeScript mirrors: `src/lib/types/enums.ts` (`SCALEUP_ROLES`, `CompanyRole`, …) and `Constants.public.Enums.*` in the generated types.

### 2.2 Tables (all have `created_at timestamptz not null default now()`; tables marked † also `updated_at` maintained by trigger `private.set_updated_at()`)

**(updated) Rules that apply to many tables:**
- **Timestamps are set by the database** for API users: on the 15 client-writable tables (`platform_settings`, `funds`,
  `companies`, `fund_investments`, `company_members`, `company_internal`, `revenue_segments`, `kpi_dimensions`,
  `kpi_dimension_members`, `company_kpis`, `templates`, `template_versions`, `template_sections`, `template_fields`,
  `fx_rates`) plus `documents` and `comments`, `created_at` (and `updated_at`) are set to `now()` on insert and
  `created_at` cannot change (`private.pin_row_timestamps`). System callers may set historical timestamps.
  `submission_values`, `submission_segment_values` and `submission_kpi_values` also have `created_at` + `updated_at`.
- **CHECK constraints** beyond the contract: non-blank names, codes, titles, labels, file names and comment bodies;
  section and field keys match `^[a-z][a-z0-9_]{0,62}$`; settings numbers ≥ 0 and `default_reporting_start` on the 1st;
  `documents.size_bytes ≥ 0`; `period_end > period_start`; `fx_rates.currency ~ '^[A-Z]{3}$'` and months on the 1st;
  `template_versions.version_no > 0`; **(updated, second patch)** `access_links_max_validity` (invite ≤ 7 days, sign-in ≤ 24 hours
  after `created_at`).
- **Unique constraint names** (for 23505 handling / upserts): `companies_name_key`, `funds_code_key`,
  **(B30)** `revenue_segments_active_name_key` (a partial unique INDEX replacing `revenue_segments_company_id_name_key`),
  `company_kpis_company_id_name_key`, `kpi_dimensions_company_id_name_key`,
  `kpi_dimension_members_dimension_id_name_key`, `fund_investments_fund_id_company_id_key`,
  `template_sections_template_version_id_key_key`, `template_fields_template_version_id_key_key`,
  `template_sections_single_system_kind`, `templates_single_default`, `company_members_pkey`, `fx_rates_pkey`,
  `submission_kpi_values_cell_key`, **(updated)** `access_links_token_hash_key`.
- Company configuration rows never move between companies, and dimension members never move between dimensions (P0001).

**platform_settings** † — singleton (`id smallint primary key default 1 check (id = 1)`)
`due_day smallint not null default 15 check (due_day between 1 and 28)`, `escalation_days smallint not null default 14`,
`backfill_grace_days smallint not null default 14`, `revenue_swing_pct numeric not null default 30`,
`min_runway_months numeric not null default 6`, `require_mfa boolean not null default true`,
`default_reporting_start date not null default '2026-07-01'`,
`declaration_text text not null default 'I confirm that the figures submitted are accurate to the best of my knowledge.'`,
`terms_version text not null default '2026-09'`, `updated_by uuid`,
**(decisions 2026-10-01, BRD B29)** `owner_contributor_limit smallint not null default 4` (constraint
`platform_settings_owner_contributor_limit_check`: between 0 and 100) — the most **active** contributors a company owner can
have; ScaleUp can add more (§1; trigger on `company_members`). M4's settings page edits it (Super Admin).
**(updated)** Readable by ScaleUp staff only (BRD B27). Every signed-in session — also aal1, terms-pending and
deactivated ones — reads `require_mfa`, `terms_version`, `declaration_text`, `due_day` **and (decisions 2026-10-01)
`owner_contributor_limit`** with `get_client_settings()` (§2.4).

**profiles** † — `id uuid pk references auth.users(id) on delete cascade`, `email text not null`, `full_name text`,
`job_title text`, `scaleup_role scaleup_role null`, `is_active boolean not null default true`,
`terms_accepted_at timestamptz`, `terms_version text`.
Created by trigger `private.handle_new_user()` on `auth.users` insert (email, `raw_user_meta_data->>'full_name'`); never
take roles from user metadata. Email kept in sync on `auth.users` email update.
**(updated, second patch)** Visible to: the user themself; ScaleUp staff (everyone); company users — the company-side
profiles (`scaleup_role is null`) of the people they share a company with. **Never ScaleUp staff profiles** (§1).
**(decisions 2026-10-01, BRD B28)** Company users get ScaleUp people's names — "<full name> (ScaleUp)", nothing else — only
through `staff_display_names(ids)` (§2.4).

**funds** † — `id uuid pk default gen_random_uuid()`, `code text not null unique` (e.g. `SV1`), `name text not null`,
`legal_name text`, `description text`, `is_active boolean not null default true`.

**companies** † — `id uuid pk`, `name text not null unique`, `legal_name text`, `registration_no text`, `sector text`,
`country text default 'Malaysia'`, `website text`, `description text`,
`reporting_currency char(3) not null default 'MYR' check (reporting_currency ~ '^[A-Z]{3}$')`,
`status company_status not null default 'active'`, `status_changed_at timestamptz`, `status_reason text`,
`reporting_start_month date null check (extract(day from reporting_start_month) = 1)` **(updated: nullable)** — first month the company must report on the platform.
**(updated)** `reporting_start_month` **null = "Not yet reporting"** (BRD B16; label `NOT_YET_REPORTING_META`): no months
and no period closes are opened for the company. Setting it later opens the missing months (backfill grace period) and
closes on the next `open_due_periods()` — M1 calls `rpc('open_due_periods')` right after saving it; clearing it again keeps
the history (submissions, values, closes) and opens nothing new; such months are never overdue. The **partner-in-charge
moved to `company_internal`** (no `partner_in_charge_id` here any more). Triggers: `reporting_start_month` is normalised to
the 1st; `status_changed_at` is maintained; a `company_internal` row is created for every new company. Note
`reporting_currency` is `char(3)`: trim it (the data layer does) before comparing.

**fund_investments** † — `id uuid pk`, `fund_id uuid not null references funds(id) on delete restrict`,
`company_id uuid not null references companies(id) on delete cascade`, `investment_date date`, `instrument text`,
`ownership_pct numeric(7,4) check (ownership_pct between 0 and 100)`, `notes text`, `unique (fund_id, company_id)`.
(Investment date / instrument / ownership are per fund because a company can sit in both SV1 and SFF.)

**company_members** † — `company_id uuid references companies(id) on delete cascade`,
`user_id uuid references profiles(id) on delete cascade`, `role company_role not null`,
`is_active boolean not null default true`, `invited_by uuid references profiles(id)`, `primary key (company_id, user_id)`.
**(updated)** `invited_by` is always set to the inserting user and is immutable.
**(decisions 2026-10-01, BRD B29)** Trigger `company_members_contributor_limit` (before insert or update; security definer
`private.company_members_contributor_limit()`): when the caller is neither ScaleUp staff (`is_scaleup()`) nor a system caller,
a row that would give the company more than `platform_settings.owner_contributor_limit` **active** contributors (inserting an
active contributor, reactivating one, changing a member to contributor, moving one in from another company) is refused with
P0001 `"Your team already has <n> contributors. Deactivate one, or ask ScaleUp to add more."` (n = the company's other active
contributors; "1 contributor"; limit 0 and none yet: `"Only ScaleUp can add contributors to your team. Ask ScaleUp to add them."`).
Re-saving an active contributor and deactivating are always fine. Callers who are not an owner of the company are left to RLS
(42501, nothing about the team leaks); concurrent invitations to one company are serialised (advisory lock).

**company_internal** † — ScaleUp-only. `company_id uuid pk references companies(id) on delete cascade`,
**(updated)** `partner_in_charge_id uuid null references profiles(id) on delete set null` (indexed),
`internal_rating internal_rating`, `exit_strategy_status text`, `exit_strategy_notes text`, `notes text`, `updated_by uuid`.
**(updated)** Exactly one row per company: created with the company (trigger; the migration and the seed backfill any
missing one), **update, never insert or delete** (authenticated has only SELECT/UPDATE). `updated_by` is set by trigger.
Trigger `private.company_internal_guard()`: the row never moves to another company, and only Super Admins (or system
callers) change `partner_in_charge_id` (42501 `"Only Super Admins can assign the partner-in-charge."`); sending the
unchanged value back (whole-row forms) is fine. `partner_in_charge_id` may point at any profile — only an active
`partner` who is partner-in-charge gets partner rights (`private.is_partner_of()` reads this column).

**revenue_segments** — `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`name text not null`, `sort_order int not null default 0`, `is_active boolean not null default true`, ~~`unique (company_id, name)`~~.
If a company has **no active segments**, it enters total revenue directly.
**(B30)** Two revenue breakdowns per company:
- `kind text not null default 'scaleup' check (kind in ('scaleup', 'company'))` (constraint `revenue_segments_kind_check`):
  `company` = the company's **own** revenue segments (defined by its owner, `set_company_revenue_segments()` only; the
  active ones add up to total revenue, which the form calculates from them; they carry over every month) · `scaleup` =
  **ScaleUp revenue lines** (Super Admins / Fund Admins, direct writes as before; required every month, need not add up to
  total revenue). Every row that existed before B30 is a ScaleUp line. The kind never changes (trigger, P0001 `"A revenue
  segment cannot switch between a company segment and a ScaleUp revenue line. Add a new one instead."`, for every caller).
- `retired_at timestamptz` — when the segment was deactivated; maintained by trigger `private.revenue_segments_guard()`
  (set to now() when `is_active` becomes false, cleared when it becomes true, kept while it stays inactive; trusted system
  callers may date it), constraint `revenue_segments_retired_at_check` (`is_active = (retired_at is null)`). Rows
  deactivated before B30 were dated from the audit log (else `created_at`). Retired **company** segments are never
  reactivated: a renamed segment with submitted figures continues as a new row (§2.4).
- Names are unique per company **and kind** among the ACTIVE rows, ignoring case: partial unique index
  `revenue_segments_active_name_key on (company_id, kind, lower(name)) where is_active` (23505); a retired name can be used
  again, and a ScaleUp line may share a company segment's name. Plain index `revenue_segments_company_idx (company_id)`.
- A month's segments: an open month (draft, changes requested) shows the **active** segments; a submitted / approved month
  shows **exactly the segments it has figures for** (retired ones included), so it keeps its names and figures —
  `segmentsForMonth` (§5.5).

**kpi_dimensions** — `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`name text not null` (e.g. "Outlet"), `unique (company_id, name)`.
**(updated)** Deleting a dimension deletes its members first (trigger), so their audit rows keep the company id; a
dimension used by a KPI, or members with stored values, still block the delete (RESTRICT).

**kpi_dimension_members** — `id uuid pk`, `dimension_id uuid not null references kpi_dimensions(id) on delete cascade`,
`name text not null` (e.g. "Mont Kiara"), `sort_order int not null default 0`, `is_active boolean not null default true`,
`unique (dimension_id, name)`.

**company_kpis** † — `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`name text not null`, `description text`, `unit text` (display unit, e.g. "RM", "cameras", "%"),
`value_type kpi_value_type not null default 'number'`, `frequency kpi_frequency not null default 'monthly'`,
`dimension_id uuid null references kpi_dimensions(id) on delete restrict` (dimension must belong to the same company — trigger check),
`is_required boolean not null default true`, `sort_order int not null default 0`, `is_active boolean not null default true`,
`unique (company_id, name)`. Half-yearly KPIs are collected in **June and December** submissions only.

**templates** — `id uuid pk`, `name text not null`, `description text`, `is_default boolean not null default false`
(partial unique index: only one default).
**(updated)** Trigger `private.guard_default_template()` (signed-in users): a template cannot be inserted as the default;
it needs a published version before it can become the default; `is_default` cannot be set to false directly
(`"There must always be a default template. Make another template the default instead."`). Setting `is_default = true`
on a template switches the default in one statement for every caller — M3 switches with a single update of the new template.

**template_versions** — `id uuid pk`, `template_id uuid not null references templates(id) on delete cascade`,
`version_no int not null`, `status template_status not null default 'draft'`, `notes text`, `created_by uuid`,
`published_at timestamptz`, `published_by uuid`, `unique (template_id, version_no)`, partial unique index: one `draft` per template.
The **current** version of a template = the one with `status = 'published'` (publishing archives the previous published one).
Sections/fields of non-draft versions are immutable (trigger `private.guard_template_edit()`).
**(updated)** Also a partial unique index: at most one `published` version per template. Versions inserted by users are
always drafts with `version_no = max + 1` and `created_by = caller`; `status`/`published_at`/`published_by` change only
inside `publish_template_version()`; published and archived versions cannot be deleted; users may update only `notes`.

**template_sections** — `id uuid pk`, `template_version_id uuid not null references template_versions(id) on delete cascade`,
`key text not null`, `title text not null`, `description text`, `kind section_kind not null`, `sort_order int not null default 0`,
`unique (template_version_id, key)`.
**(updated)** At most one `financials`, `headcount` and `kpis` section per version (index `template_sections_single_system_kind`);
system sections keep their kind and cannot be deleted.

**template_fields** — `id uuid pk`, `template_version_id uuid not null references template_versions(id) on delete cascade`,
`section_id uuid not null references template_sections(id) on delete cascade`, `key text not null` (stable across versions),
`label text not null`, `help_text text`, `field_type field_type not null`, `is_required boolean not null default false`,
`is_system boolean not null default false`, `options jsonb` (picklist/tags: `{"options": ["..."]}`; rating: `{"min":1,"max":5,"labels":{"1":"Very low","5":"Very high"}}`),
`validation jsonb` (`{"min": 0}` / `{"allow_negative": true}` / `{"max_length": 4000}`), `sort_order int not null default 0`,
`unique (template_version_id, key)`.
System fields (`is_system = true`) can be relabelled, re-described and reordered but **not deleted** and their `key`,
`field_type`, `is_system` cannot change. Sections of kind `financials`, `headcount`, `kpis` cannot be deleted.
**(updated)** Only the 7 built-in keys (§3) with their types can be system fields, and non-system fields cannot use those
keys. System fields stay in a section of their kind (the five financial figures in Financials, the two headcounts in
Headcount): `"System fields must stay in the Financials section."`. Their `validation` may be changed (min/max apply, §2.6).
Guard messages (P0001), e.g. `"System fields keep their key and type. You can change the label, help text and order."`,
`"This template version is published, so it cannot be changed. Create a new draft instead."`.

**reporting_periods** — one row per month, portfolio-wide. `id uuid pk`, `month date not null unique check (day = 1)`,
`due_date date not null`, `template_version_id uuid not null references template_versions(id)`,
`opened_at timestamptz not null default now()`, `opened_by uuid` (null = automatic).

**submissions** † — one per company per month. `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`period_id uuid not null references reporting_periods(id)`, `month date not null`,
`template_version_id uuid not null references template_versions(id)`,
`status submission_status not null default 'draft'`, `due_date date not null` (effective due date),
`original_due_date date` (set on first extension), `extension_reason text`,
`submitted_at timestamptz`, `submitted_by uuid references profiles(id)`, `declaration_text text`,
`approved_at timestamptz`, `approved_by uuid references profiles(id)`,
`revision int not null default 0` (incremented on every submit), `last_saved_at timestamptz`, `last_saved_by uuid references profiles(id)`,
`unique (company_id, month)`. No direct INSERT/UPDATE from clients — only via RPCs.
**(updated)** `original_due_date` is also set when a month is sent back and its due date moves (§2.4 `request_changes`).

**submission_values** — `submission_id uuid references submissions(id) on delete cascade`, `field_key text not null`,
`value_number numeric(20,4)`, `value_text text`, `value_json jsonb`, `updated_at timestamptz not null default now()`,
`updated_by uuid`, `primary key (submission_id, field_key)`.
Storage rule: currency/number/integer/percent/rating → `value_number`; text/long_text/picklist → `value_text`; tags/boolean → `value_json`.

**submission_segment_values** — `submission_id uuid references submissions(id) on delete cascade`,
`segment_id uuid references revenue_segments(id) on delete restrict`, `amount numeric(18,2)`,
`updated_at`, `updated_by`, `primary key (submission_id, segment_id)`.
**(B30)** Holds the figures of both kinds (company segments and ScaleUp lines). New amounts only for **active** segments;
`set_company_revenue_segments()` moves / clears the figures of months still open for changes; submitted and approved months'
figures never change.

**submission_kpi_values** — `id uuid pk`, `submission_id uuid not null references submissions(id) on delete cascade`,
`kpi_id uuid not null references company_kpis(id) on delete restrict`,
`dimension_member_id uuid null references kpi_dimension_members(id) on delete restrict`,
`value_number numeric(20,4)`, `value_text text`, `value_bool boolean`, `updated_at`, `updated_by`,
`unique nulls not distinct (submission_id, kpi_id, dimension_member_id)` **(updated: constraint `submission_kpi_values_cell_key`)**.

**submission_events** — timeline. `id bigint generated always as identity pk`,
`submission_id uuid not null references submissions(id) on delete cascade`,
`event text not null check (event in ('submitted','resubmitted','changes_requested','approved','reopened','amendment_requested','deadline_extended'))`,
`actor_id uuid references profiles(id)`, `message text`.
**(updated)** `message` holds the request-changes message, the approval note, the reopen / amendment reason, and for
`deadline_extended` the text `"Due date extended to 30 Oct 2026. Reason: …"`.

**comments** — `id uuid pk`, `submission_id uuid not null references submissions(id) on delete cascade`,
`parent_id uuid null references comments(id) on delete cascade` (null = thread root; replies are one level deep),
`target text not null default 'general'` (see §2.5), `visibility comment_visibility not null default 'shared'`,
`author_id uuid not null references profiles(id)`, `body text not null check (char_length(body) between 1 and 5000)`,
`resolved_at timestamptz`, `resolved_by uuid references profiles(id)`.
Trigger: a reply's parent must be a root in the same submission; the reply inherits the root's `target` and `visibility`.
**(updated)** `author_id` defaults to `auth.uid()`. Root targets are validated (`general | field:<key> | segment:<uuid> |
kpi:<uuid>[:<uuid>]`, ids lower-cased; otherwise `"That comment target is not recognised."`). Comments are immutable
except `resolved_at/by` (`"Comments cannot be edited."`); clients cannot insert resolved or back-dated comments.

**period_closes** † — quarter/half close per company. `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`period_type close_period_type not null`, `period_start date not null`, `period_end date not null`, `label text not null` (`Q3 2026`, `H2 2026`),
`status period_close_status not null default 'open'`, `confirmed_at timestamptz`, `confirmed_by uuid references profiles(id)`,
`computed_totals jsonb` (snapshot at confirmation, shape = `PeriodTotals` §5.4), `restated_totals jsonb` (subset of the same keys),
`restatement_reason text`, `unique (company_id, period_type, period_start)`.
Quarters and halves follow the **calendar year** (Q1 = Jan–Mar … ; H1 = Jan–Jun, H2 = Jul–Dec).
**(updated)** `period_end` is the **last calendar day** (`2026-09-30`). Rows are created by `open_due_periods()` once the
period's last month is open for the company. `computed_totals`: `gp_pct`, `np_pct`, `avg_burn_rate` rounded to 4 dp;
percentages as numbers (46.6667 means 46.67 %).

**documents** — `id uuid pk`, `company_id uuid not null references companies(id) on delete cascade`,
`period_close_id uuid null references period_closes(id) on delete set null`, `doc_type document_type not null default 'management_accounts'`,
`file_name text not null`, `storage_path text not null unique`, `mime_type text`, `size_bytes bigint`,
`version int not null default 1` (trigger: 1 + max version for same company/period_close/doc_type), `uploaded_by uuid references profiles(id)`,
`uploaded_at timestamptz not null default now()`. Documents are never deleted in-app (version history).
**(updated)** Trigger `private.documents_before_insert()` (every role): the period close must belong to the same company;
`storage_path` must be exactly `<company_id>/<period_close_id or 'general'>/<file name>` (lower-case ids, three segments,
second folder = `coalesce(period_close_id, 'general')`, no `.`/`..`); the object must already exist in bucket
`company-documents` (`"The file has not been uploaded yet. Upload it first, then save the document."`); `size_bytes`
and `mime_type` are copied from the storage metadata (`size`, `mimetype`) when present; `version` is assigned under an
advisory lock (client values ignored); `uploaded_by` defaults to `auth.uid()`; `uploaded_at`/`created_at` are set by the database.

**fx_rates** — `currency char(3) not null`, `month date not null`, `rate_to_myr numeric(18,8) not null check (rate_to_myr > 0)`,
`updated_at`, `updated_by uuid`, `primary key (currency, month)`.

**audit_log** — immutable. `id bigint generated always as identity pk`, `occurred_at timestamptz not null default now()`,
`actor_id uuid`, `actor_email text`, `actor_role text` (`super_admin`… or `company_owner`/`company_contributor` or `system`),
`action text not null` (`insert|update|delete|submit|approve|request_changes|reopen|export|download|invite|…`),
`entity text not null` (table/domain name), `entity_id text`, `company_id uuid` (no FK, survives deletes),
`on_behalf boolean not null default false`, `summary text`, `old_data jsonb`, `new_data jsonb`.
Written by trigger `private.audit_row_change()` (AFTER INSERT/UPDATE/DELETE, security definer) on every business table above
(skip no-op updates; for UPDATE store only changed columns in old/new, ignoring `updated_at`), and by `public.log_audit_event()`.
`on_behalf = true` when a ScaleUp user writes company data (`submission_values`, `submission_segment_values`,
`submission_kpi_values`, `documents`, `period_closes`). UPDATE/DELETE/TRUNCATE on `audit_log` raise an exception (trigger), for every role.
**(updated)** Actions written by the database: `insert`, `update`, `delete` (row changes) and, from RPCs, `submit` (also
resubmits, summary e.g. `"Resubmitted Jul 2026 (revision 2)"`), `request_changes`, `approve`, `reopen` (months and closes),
`request_amendment`, `extend_due_date`, `resolve`, `unresolve`, `confirm`, `publish`, `status_change`, `accept_terms`,
`open_period`. App events via `log_audit_event()` are limited to the allowlist in §2.4. `actor_role` for a row of a known
company comes only from a membership in that company (else null); rows created by `open_due_periods()` are recorded as
`actor_role = 'system'` with no actor. The diff also ignores `updated_by` (on `company_internal`, `fx_rates` and the three
value tables; a `platform_settings` diff keeps it) and `last_saved_at/last_saved_by` on submissions.

**access_links (updated, new; BRD B14)** — our own single-use invitation and sign-in links, independent of Supabase
Auth's email OTP expiry. `id uuid pk default gen_random_uuid()`, `user_id uuid not null references profiles(id) on delete
cascade` (indexed), `purpose text not null check (purpose in ('invite', 'signin'))`, `token_hash text not null unique
check (token_hash ~ '^[0-9a-f]{64}$')` (lower-case hex sha256 of 32 random bytes; the raw token only ever appears in the
link `/access/<token>`), `expires_at timestamptz not null` (invite 7 days, sign-in 24 hours; `check (expires_at >
created_at)` **(updated, second patch)** and `constraint access_links_max_validity check (expires_at <= created_at + 7 days
for 'invite' / 24 hours for 'signin')`), `created_by uuid references profiles(id)` (indexed; **who issued it — always set
it to the acting user**; null = a trusted script such as `scripts/create-user.ts`), `created_at timestamptz not null default
now()` (never in the future), `used_at timestamptz`, `revoked_at timestamptz`. **Service role only**: RLS enabled with no
policies, no privileges for anon/authenticated — M2 reads and writes it with `createAdminClient()` after its own permission
checks. **Not row-audited** (token hashes must never reach `audit_log`): M2 logs `invite` / `sign_in_link` / `invite_revoke`
with `log_audit_event()` as the acting user.
**(updated, second patch) Database guard** — trigger `private.access_links_guard()` (before insert/update; the table's only
trigger) and `private.access_link_issuer_ok(created_by, user_id)`: whoever holds a link can sign in as its account (the
inviter copies and sends it, BRD B14), so `created_by` must be **an active Super Admin** (any account) or **an active owner
of an active company issuing it for a company-side account with at least one active membership, all of whose memberships
(active or not) are contributor memberships of active companies that owner actively owns** — never for a co-owner, ScaleUp
staff, or an existing account that also reaches another company (BRD B29). Refusals are 42501: `"Only ScaleUp can send this
person a link, because they are not just a contributor of your company. Ask them to sign in as usual."` (an owner) or
`"Only Super Admins and company owners can issue invitation and sign-in links."`. Once issued a link never changes (P0001
`"An access link cannot be changed. Revoke it and issue a new one."`); `used_at` and `revoked_at` are set once each.
Flow (M2): invite → `admin.createUser({ email, email_confirm: true, user_metadata: { full_name } })` (or reuse) → role
(`admin_update_profile` as the caller) / membership (insert as the caller) → insert the link **with `created_by` = the acting
user** → show `${NEXT_PUBLIC_SITE_URL}/access/<token>` + expiry. **An existing account that belongs elsewhere** (the owner
flow reuses it and the database refuses the owner's link): just add the membership and tell the owner "They already have an
account: ask them to sign in as usual" — no link; a Super Admin can still issue one. Accept: `GET /access/[token]` only
renders an "Accept invitation" / "Sign in" button with who it is for (link scanners cannot use it up; a read-only lookup by
token hash with the admin client); the Server Action hashes the token and **claims it atomically first** —
`admin.rpc('claim_access_link', { p_token_hash }).maybeSingle()` (§2.4; no row = expired, used, revoked, deactivated account
or issuer no longer allowed → "ask ScaleUp (or your company owner) for a new link") — then `admin.generateLink({ type:
'magiclink', email })` with the returned email, `verifyOtp({ type: 'magiclink', token_hash })` on the server client, calls
`startIdleClock()` and redirects to `/set-password` (invite) or `/mfa` (sign-in). Never check-then-set `used_at` yourself
(two concurrent requests could both pass the check). A claimed link is used up even if signing in then fails (e.g. Supabase
Auth unavailable): show "ask for a new link".

**private.seed_markers (updated, new)** — `key text pk`, `applied_at` — one row per one-time seed block (no API privileges).

### 2.3 Views (`with (security_invoker = true)` so RLS applies)

**v_submission_financials** — one row per submission: `submission_id, company_id, month, status, due_date, submitted_at, approved_at,
currency, fx_rate_to_myr` (1 for MYR, else `fx_rates.rate_to_myr` for that month or null), and pivoted numeric columns
`revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate, headcount_ft, headcount_pt` from `submission_values`.
**(updated)** `fx_rate_to_myr` is always null for company users on non-MYR companies (`fx_rates` is ScaleUp-only).

**v_submission_overview** — one row per submission for trackers/home: `id, company_id, month, status, due_date, original_due_date,
submitted_at, approved_at, revision, last_saved_at, is_overdue` (status in draft/changes_requested and `due_date < private.today_myt()`),
`days_overdue` (int, 0 if not overdue), `has_narrative` (any non-empty value for a field in a `narrative` or `pulse` section),
`open_threads` (count of unresolved root comments visible to the caller).
**(updated)** `is_overdue`/`days_overdue` are only true/non-zero for an **active** company with a reporting start month
and a month on or after it (months of a company that is not, or no longer, reporting are never overdue). `has_narrative`
ignores system fields. The generated types mark **every view column nullable**;
use `SubmissionOverviewRow` / `SubmissionFinancialsRow` from `@/lib/types/domain` (identity columns non-null).

### 2.4 RPC functions (`public`, `security definer`, each re-checks the caller's permission and raises a clear exception otherwise)

**(updated) Error behaviour.** Permission failures raise **42501** with a friendly message (e.g. `"Only the company owner can
submit monthly updates."`, `"This monthly update was not found or you do not have access to it."`); business-rule
failures raise **P0001** with a British-English message meant to be shown as-is (`toActionError` does both, §5.3). RLS or
privilege refusals on direct table writes carry Postgres text (`new row violates row-level security policy …`) and
are mapped to the generic permission message. Other codes: 23505 unique, 23514 check, 23503/23001 FK. Months in
messages read `"Sep 2026"`, dates `"30 Sep 2026"`. Arguments with a default are optional in the generated types
(`supabase.rpc('x', {...})`) — pass `undefined`/omit them, **not `null`**, unless the type allows null.

| Function | Who | Behaviour |
|---|---|---|
| `open_due_periods() returns int` **(updated)** | any **active, MFA-satisfied** user who accepted the current terms, or a system caller (aal1/inactive/terms pending → 42501 `"Please sign in first."`) | Idempotent. Ensures a `reporting_periods` row exists for every month from `min(default_reporting_start, min(companies.reporting_start_month))` (null start months ignored) up to the **last completed month** in MYT; `due_date` = day `due_day` of the following month; `template_version_id` = current published version of the default template (looked up only when a period row must be created; missing → P0001 `"Publish the default reporting template before opening reporting months."`). Ensures a `submissions` row for every **active** company with a **non-null** `reporting_start_month <= month` (due_date = period due date, or `today + backfill_grace_days` if created after that date). Ensures `period_closes` rows (quarter at Mar/Jun/Sep/Dec, half at Jun/Dec) for those companies' months from their start. "Not yet reporting" companies (null start) get nothing; once a start month is set, the next call creates their missing months and closes. Returns the number of rows created **to ScaleUp and system callers; company users always get 0**. Audited as `system`. Called on tracker/portal page loads, daily by pg_cron, and by M1 after setting a start month. |
| `open_period(p_month date) returns uuid` **(updated)** | super_admin, fund_admin (or system) | Opens one month early (e.g. current month) with the same side effects; returns the period id. `p_month` is normalised to the 1st; months after the current MYT month (`"Only months up to the current month (Oct 2026) can be opened."`) or before the earliest start month are refused. Re-opening an open month is a no-op. |
| `save_submission_values(p_submission_id uuid, p_values jsonb default '[]', p_segments jsonb default '[]', p_kpis jsonb default '[]') returns timestamptz` **(updated)** | company member of an **active** company, or fund_admin (on behalf); super_admin/partner/viewer → 42501 | Only when status is `draft` or `changes_requested` (else P0001 `"Sep 2026 has been submitted and is awaiting review, so it can no longer be edited."` / `"… is approved and locked. Request an amendment if something needs to change."`). `p_values`: `[{ "key": text, "value_number"?: number, "value_text"?: text, "value_json"?: any }]` (key must exist in the submission's template version); `p_segments`: `[{ "segment_id": uuid, "amount": number \| null }]` (segment of this company, either kind; **(B30)** an amount only for an **active** segment — a retired one gives P0001 `"\"Online\" is no longer in use, so revenue can no longer be entered for it. Reload the page to see the current revenue segments."`; clearing one, amount null, is allowed; and every save also clears the month's figures for **retired company** segments — left from before it was sent back after the segments changed — ScaleUp lines' figures are kept); `p_kpis`: `[{ "kpi_id": uuid, "dimension_member_id": uuid \| null, "value_number"?, "value_text"?, "value_bool"? }]` (KPI of this company; member must belong to the KPI's dimension; null when the KPI has no dimension). Upserts; an entry whose values are all null/empty/`[]` **deletes** the row. Updates `last_saved_at/by`. Returns `last_saved_at`. Transactional: one bad entry rejects the whole save. **Input rules:** JSON numbers only (no numeric strings), \|value\| < 1e15; the value must be in the column of the field type (§2.2); text max 20,000 chars (or `validation.max_length`), blank text = empty; picklist and tag values must be in `options` (max 50 tags); rating must be a whole number within `options` min/max (default 1–5); boolean fields take JSON `true`/`false`; integer KPIs must be whole numbers (`"\"App downloads\" must be a whole number."`); KPI text ≤ 2,000 chars; half-yearly KPI values outside June/December are refused (clearing is allowed). Integer **template fields** are not refused at save — validation reports `not_integer`. |
| `set_company_revenue_segments(p_company_id uuid, p_segments jsonb) returns setof revenue_segments` **(B30, new)** | the company **owner** (active membership) of an **active** company; Super Admin / Fund Admin on the owner's behalf (audited `on_behalf`); system callers. Anyone else → 42501 `"Only the company owner can change its revenue segments."` (before any lookup); exited / written-off company → the read-only P0001 (ScaleUp too); unknown company (ScaleUp) → P0001 `"That company was not found."` | Sets the **complete, ordered** list of the company's own segments (`kind = 'company'`): `p_segments = [{ "id"?: uuid, "name": text }, …]`, 0–50 items (P0001 `"Send the revenue segments as a list."`, `"A company can have at most 50 revenue segments."`), names trimmed of spaces / tabs / line breaks, 1–80 characters, no line breaks or tabs inside, unique ignoring case (`"Each revenue segment needs a name."`, `"Revenue segment names can be at most 80 characters."`, `"Revenue segment names cannot contain line breaks or tabs."`, `"There are two revenue segments called \"Online\". Give each segment a different name."`, `"Each revenue segment can only be listed once."`); ids must be the company's **current active company segments** (else `"The revenue segments have changed since this page was opened. Reload the page and try again."`). Per item: same name (exact) → keeps its id, `sort_order` = position (1-based); new name → **renamed in place** if the segment has no figures in a submitted or approved month, otherwise the old row is **retired** and a **new row** with the new name replaces it (a new series) and the figures of the company's months still open for changes (draft, changes requested) **move** to it; no id → added, unless a current segment of that name (ignoring case) is not listed by id — then it is that segment (taken out and put back in the form). Current segments missing from the list are **retired** and their figures in open months are **cleared**. Submitted and approved months are never changed; ScaleUp lines are untouched. Name swaps work (temporary names). Serialised per company (advisory lock; open months locked like `save_submission_values` locks them). Returns the active company segments by `sort_order`. Audited as row changes with summaries such as `Revenue segment "Online" renamed to "Web" as a new series (submitted months keep "Online")`. Data layer: `setCompanyRevenueSegments` (§5.5); UX mirrors `companySegmentListError`, `diffCompanySegments`. EXECUTE: authenticated (service role by default), never anon. |
| `get_submission_validation(p_submission_id uuid) returns jsonb` **(updated)** | anyone who can view it (else 42501) | `{ "ok": bool, "errors": [{ "target": text, "code": text, "message": text }] }`. Codes: `required`, `negative`, `not_integer`, `out_of_range`, `sum_mismatch`, `prior_months`. Rules and order in §2.6. |
| `submit_submission(p_submission_id uuid, p_declaration_accepted boolean) returns void` **(updated)** | company **owner** (active membership) of an **active** company | Status must be `draft`/`changes_requested`; declaration must be true; validation must be ok. Sets `submitted`, `submitted_at/by`, `declaration_text` (from settings), `revision += 1`, clears `approved_at/by`; event `submitted` (or `resubmitted` if revision > 1). Failure messages in order: `"Sep 2026 has already been submitted."` / `"… is approved and locked."`; `"Please confirm the declaration before submitting."`; the `prior_months` message if any (`"Submit earlier months first: Jul 2026, Aug 2026."`), else the single validation message, else `"Please fix N issues before submitting, starting with: <first message>"`. Call `get_submission_validation` first to show field-level errors. |
| `request_changes(p_submission_id uuid, p_message text) returns void` **(updated)** | super_admin, fund_admin, partner (any company); **active companies only** (else P0001 read-only message) | Status `submitted` → `changes_requested`; message required (≤ 5,000 chars); event with the message. **Also:** `due_date = greatest(due_date, today MYT + backfill_grace_days)` (`original_due_date` keeps the first due date when it moves), and any **confirmed** quarter/half close covering the month is reopened (status open, `confirmed_at/by` and `computed_totals` cleared, restatement kept; audited `reopen`). |
| `approve_submission(p_submission_id uuid, p_message text default null) returns void` **(updated)** | super_admin, or the partner who is `company_internal.partner_in_charge_id`; **also for exited / written-off companies** (ScaleUp finalises their history) | Status `submitted` → `approved` (month locked); `approved_at/by`; event (with the optional message, ≤ 5,000 chars). |
| `reopen_submission(p_submission_id uuid, p_reason text) returns void` **(updated)** | super_admin, fund_admin, partner-in-charge (or system); **active companies only** (else P0001 read-only message) | Status `approved` → `changes_requested`; reason required (≤ 5,000); clears `approved_at/by`; event `reopened`. Needs re-approval. Same due-date rule and close reopening as `request_changes`. |
| `request_amendment(p_submission_id uuid, p_reason text) returns void` **(updated)** | company owner of an **active** company | For an `approved` month: creates a shared root comment (target `general`, body prefixed "Amendment requested: ", reason ≤ 4,900) and event `amendment_requested`. |
| `extend_due_date(p_submission_id uuid, p_new_due_date date, p_reason text default null) returns void` **(updated)** | super_admin, fund_admin (or system); **active companies only** (else P0001 read-only message) | Not for approved months (drafts, submitted and changes_requested are fine); the new date must be **later** than the current due date (`"The new due date must be after the current due date (15 Oct 2026)."`); reason optional (≤ 2,000). Sets `original_due_date` (first time), `due_date`, `extension_reason`; event `deadline_extended`. |
| `resolve_comment(p_comment_id uuid, p_resolved boolean) returns void` **(updated)** | ScaleUp non-viewer; company member for shared threads of own **active** company | Root comments only (`"Only whole threads can be resolved. Resolve the first comment of the thread instead."`); sets/clears `resolved_at/by` (resolving an already resolved thread keeps the first resolver). Audited `resolve`/`unresolve`. |
| `confirm_period_close(p_close_id uuid, p_restated_totals jsonb default null, p_reason text default null) returns void` **(updated)** | company owner; fund_admin on behalf; **active** companies only | Every month from `greatest(period_start, reporting_start_month)` (**updated:** without a start month, from the company's first month with a submission in the period) to the period end must be `submitted` or `approved` (`"Submit every month of Q3 2026 before confirming it. Still to submit: Sep 2026 (changes requested)."`); at least one `management_accounts` document linked to the close **whose file exists in storage** (`"Upload the management accounts for Q3 2026 before confirming it."`); stores `computed_totals` (§5.4 `PeriodTotals`, computed in SQL from submitted/approved months); `{}` restatement counts as none; restated keys = the `PeriodTotals` keys except `months_count`, values numbers or null; if restated, `p_reason` required. Status → `confirmed`. Audited `confirm` (on_behalf for ScaleUp). |
| `reopen_period_close(p_close_id uuid, p_reason text) returns void` **(updated)** | super_admin, fund_admin (or system); **(updated, second patch) active companies only** (else P0001 read-only message, after the role check) | `confirmed` → `open`; clears `confirmed_at/by` and `computed_totals` (restated totals and reason kept until the next confirmation); reason required, logged in audit. The confirmed closes of exited / written-off companies stay confirmed (they could never be confirmed again). |
| `claim_access_link(p_token_hash text) returns table (user_id uuid, purpose text, email text)` **(updated, new, second patch)** | **service role only** (system callers; no EXECUTE for anon/authenticated; a signed-in JWT → 42501) | The `/access` accept action's atomic claim: ONE `update access_links set used_at = now() where token_hash = lower(p_token_hash) and used_at is null and revoked_at is null and expires_at > now() and <account active> and access_link_issuer_ok(created_by, user_id) returning …` — so a link can be used once even under concurrent requests (the second waits for the row lock and no longer matches). Returns one row (the account's `user_id`, `purpose`, `email` for `admin.generateLink`) or **no row** when the link is not valid for any reason; unused links that fail a check stay unused. Not audited (M2 logs `invite` / `sign_in_link` when issuing). |
| `get_client_settings() returns table (require_mfa boolean, terms_version text, declaration_text text, due_day smallint, owner_contributor_limit smallint)` **(updated, new; decisions 2026-10-01: + `owner_contributor_limit`)** | **any** session with a user id — also aal1, terms-pending and deactivated ones — or a system caller (no user id → 42501 `"Please sign in first."`; anon has no EXECUTE) | Security definer, stable. Exactly these five columns of the (ScaleUp-only) `platform_settings`, one row: `sb.rpc('get_client_settings').maybeSingle()`. Used by the auth flow (MFA / terms routing), for the submission declaration and (BRD B29) the owners' team page (places left). The return shape changed on 2026-10-01, so the function was dropped and recreated with the same privileges (authenticated, service_role; never anon or PUBLIC). |
| `staff_display_names(p_ids uuid[]) returns table (id uuid, display_name text)` **(decisions 2026-10-01, new; BRD B28)** | any signed-in, **active, MFA-satisfied** user who accepted the current terms (else 42501 `"Please sign in first."`, also for system callers; anon has no EXECUTE) | Security definer, stable. One row per id that belongs to **ScaleUp staff** (a profile with a `scaleup_role`, active or not, so history keeps its names): `display_name` = trimmed `full_name` + `" (ScaleUp)"`, e.g. `"Renuka Sena (ScaleUp)"`, or `"ScaleUp"` when the name is blank; **nothing** for other ids (company users, unknown ids, null). Never an email or role; reads no ScaleUp-internal table. At most 500 ids per call (P0001 `"Ask for at most 500 names at a time."`). Data layer: `getStaffDisplayNames(sb, ids)` (§5.5). |
| `accept_terms(p_version text) returns void` **(updated)** | self (active, MFA-satisfied; **exempt from the terms check**) | Sets own `terms_accepted_at = now()`, `terms_version`. `p_version` must equal `platform_settings.terms_version` (else `"The terms of use have been updated. Please reload the page and review the latest version."`). Audited `accept_terms`. |
| `update_my_profile(p_full_name text, p_job_title text default null) returns void` **(updated)** | self (active, MFA, current terms accepted) | Full name required; ≤ 200 chars each; a blank or omitted job title clears it. |
| `admin_update_profile(p_user_id uuid, p_full_name text, p_job_title text, p_scaleup_role scaleup_role default null, p_is_active boolean default null) returns void` **(updated)** | super_admin (or system) | **Always pass every argument you mean to keep.** Omitted/null `p_scaleup_role` = company user (never escalates); omitted/null `p_is_active` keeps the current value; blank `p_full_name` keeps the name; blank `p_job_title` clears it. A super admin cannot demote or deactivate themselves (`"You cannot remove your own Super Admin role or deactivate your own account."`). |
| `create_template_draft(p_template_id uuid) returns uuid` | super_admin, fund_admin | Copies the current published version (sections + fields) into a new `draft` (version_no + 1), or returns the existing draft id. |
| `publish_template_version(p_version_id uuid) returns void` **(updated)** | super_admin, fund_admin | Draft → published; previous published → archived. Requires all 7 system fields (with their types) **and** the `financials`, `headcount` and `kpis` sections. Future periods use it; periods already open keep theirs. |
| `set_company_status(p_company_id uuid, p_status company_status, p_reason text default null) returns void` | super_admin | Exited / written-off companies become read-only and get no new months; history kept. Audited `status_change`. |
| `delete_company(p_company_id uuid, p_reason text) returns void` **(updated)** | super_admin | Hard delete with reason written to `audit_log` first. **Storage objects are not removed** — M1 deletes the `<company_id>/` folder through the Storage API after the RPC. |
| `log_audit_event(p_action text, p_entity text, p_entity_id text default null, p_company_id uuid default null, p_summary text default null, p_data jsonb default null) returns void` **(updated)** | allowlisted actions only (below) | Appends an audit row for the caller (the actor is always the caller). `p_action` ∈ `export`, `download` (any active user; company scope checked with `can_view_company`) · `invite`, `invite_revoke`, `sign_in_link` (Super Admin, or a company owner passing `p_company_id` = their company) · `mfa_reset` (Super Admin). Any other action → P0001; role failures → 42501. `p_entity` must match `^[a-z][a-z0-9_]{0,63}$` (e.g. `documents`); `p_data` ≤ 64 KB; summary truncated to 2,000 chars. |

### 2.5 Targets (used by validation errors and comments)
`general` · `field:<field_key>` (e.g. `field:gross_profit`) · `segment:<segment_id>` · `kpi:<kpi_id>` · `kpi:<kpi_id>:<dimension_member_id>`
**(updated)** Ids in targets are lower-case UUIDs (the comments trigger lower-cases them). Value maps use a different key:
`kpiCellKey(kpiId, memberId)` = `"<kpiId>:<memberId or ->"` (src/lib/targets.ts).

### 2.6 Validation rules (SQL `private.validate_submission()` is the source of truth; `src/lib/validation.ts` mirrors it for instant UX)
1. Required system numbers: `gross_profit`, `net_profit`, `cash_in_bank`, `burn_rate`, `headcount_ft`, `headcount_pt`, and `revenue_total`.
2. ~~If the company has active revenue segments: every active segment needs an amount, and `revenue_total` must equal their sum (±0.01) → `sum_mismatch`.~~
   **(B30)** Every active revenue segment of **either kind** needs an amount (`required`, target `segment:<id>`, `"Revenue for <name> is required."`), never negative. If the company has active **company** segments (`kind = 'company'`), `revenue_total` must equal **their** sum (±0.01) once all of them have an amount → `sum_mismatch` `"Total revenue (<x>) must equal the sum of your revenue segments (<y>)."`. **ScaleUp revenue lines** (`kind = 'scaleup'`) have **no sum rule**. `revenue_total` stays required.
3. Non-negative: `revenue_total`, segment amounts, `cash_in_bank`, `burn_rate`, headcounts (`gross_profit`, `net_profit` may be negative). Headcounts must be integers.
4. Any other template field with `is_required = true` must have a value.
5. Every active, required company KPI (monthly; half-yearly only in Jun/Dec) needs a value — per active dimension member if it has a dimension.
6. `prior_months`: every earlier submission of the company must be `submitted`, `changes_requested` or `approved` ("submit months in order").
Narrative (C4) and founder-pulse fields are optional unless an admin marks them required.

**(updated) Exact behaviour** (the TS mirror returns exactly the same issues as SQL, minus `prior_months`;
`tests/db/mirror-parity.test.ts` enforces it):
- **Order:** the 7 system numbers in their fixed order (`revenue_total`, `gross_profit`, `net_profit`, `cash_in_bank`,
  `burn_rate`, `headcount_ft`, `headcount_pt`) → active **company** revenue segments (by `sort_order`, name) → `sum_mismatch`
  → **(B30)** active **ScaleUp revenue lines** (by `sort_order`, name) → other template fields (sections by `sort_order`, key;
  fields by `sort_order`, key) → KPI cells (KPIs by `sort_order`, name; members likewise) → `prior_months` (target `general`).
  Retired (inactive) segments of either kind are ignored, also when the month still holds figures for them.
- **Number rules** (system fields and every number-type template field — currency, number, integer, percent, rating — that
  has a value), in this order: `negative` when below 0 and the field is a non-negative system figure, or its `validation`
  sets `allow_negative: false` or `min: 0` (so an admin can forbid negative GP/NP); `not_integer` for the headcounts and
  `integer` fields; `out_of_range` for `validation.min`/`max` (not repeated after `negative`). Only JSON numbers count
  as min/max. Values out of range are still saved (autosave never loses input) and block submit.
- **Emptiness:** null, blank/whitespace text, `[]`, `{}` and `""` JSON are empty; `0` and boolean `false` are values.
- **Rule 6** only counts `draft` months on or after the company's `reporting_start_month` (a month sent back for changes
  counts as submitted for ordering). **(updated)** Without a start month (not yet reporting, months kept from an earlier
  start) every earlier draft counts, so the months still go in order.
- **Messages:** `"<Label> is required."`, `"<Label> cannot be negative."`, `"<Label> must be a whole number."`,
  `"<Label> must be between 1 and 5."` / `"… must be at least 0.5."` / `"… must be at most 100."` (grouped, up to 4 decimals),
  `"Revenue for <segment> is required."`, `"Revenue for <segment> cannot be negative."` (both kinds),
  **(B30)** `"Total revenue (300.02) must equal the sum of your revenue segments (300.00)."` (company segments only; plain
  grouped amounts, 2 decimals, no currency), KPI cells `"<KPI> is required."` / `"<KPI> (<member>) is required."`, `"Submit earlier months first: Jul 2026, Aug 2026."`.
  Labels are the submission's template labels; a system field missing from the template (impossible for a published
  version) is named `initcap(key)`, e.g. `"Burn Rate"`.
- **Client-only extra:** the TS mirror also flags a non-whole value in an `integer` **KPI** (`not_integer`), a rule the
  server enforces at save time instead (the save is refused).

### 2.7 RLS summary
| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| platform_settings **(updated)** | ScaleUp (`is_scaleup`); everyone else uses `get_client_settings()` | update: super_admin |
| profiles **(updated, second patch)** | self; ScaleUp (everyone); company users: the company-side profiles (`scaleup_role is null`) of their co-members — **never ScaleUp staff** (BRD B24: no email or role; **(decisions 2026-10-01, B28)** their names only through `staff_display_names()`) | none (RPCs) |
| funds, fund_investments | ScaleUp | super_admin |
| companies | `can_view_company(id)` | insert/update: super_admin (delete via RPC) |
| company_members **(updated)** | ScaleUp; members of the same company | super_admin any; company owner: `role = 'contributor'` rows of own **active** company, only for users without a ScaleUp role (`is_company_user`); **(decisions 2026-10-01, B29)** at most `owner_contributor_limit` active contributors (trigger `company_members_contributor_limit`; ScaleUp and system callers exempt) |
| company_internal **(updated)** | ScaleUp | update only (the row always exists; no insert/delete privilege): super_admin, fund_admin, partner-in-charge; `partner_in_charge_id` itself: super_admin only (trigger) |
| revenue_segments **(B30)** | `can_view_company` (both kinds) | super_admin, fund_admin — **`kind = 'scaleup'` rows only** (insert / update / delete; `with check kind = 'scaleup'`). `kind = 'company'` rows change only through `set_company_revenue_segments()` (direct inserts 42501; updates / deletes reach no row). Trigger `revenue_segments_guard`: kind never changes (P0001, raised before RLS), `retired_at` follows `is_active` |
| kpi_dimensions, kpi_dimension_members, company_kpis | `can_view_company` | super_admin, fund_admin |
| templates, template_versions, template_sections, template_fields **(updated)** | active, MFA-satisfied user (`is_active_user`) | super_admin, fund_admin (sections/fields only while version is draft; versions: insert drafts, update `notes`, delete drafts) |
| reporting_periods **(updated)** | active, MFA-satisfied user | none (RPCs) |
| submissions, submission_events | `can_view_company(company_id)` | none (RPCs) |
| submission_values / _segment_values / _kpi_values | `can_view_company` of the submission | none (RPC `save_submission_values`) |
| comments **(updated)** | ScaleUp all; company members: `visibility = 'shared'` on own company | insert: ScaleUp non-viewer (any); company member only **replies** to shared roots of own **active** company. `author_id` must be `auth.uid()`. No update/delete (resolve via RPC). |
| period_closes | `can_view_company` | none (RPCs) |
| documents **(updated)** | `can_view_company` | insert: member of an **active** company (own company) or fund_admin; `uploaded_by = auth.uid()`; plus the trigger rules of §2.2 |
| fx_rates | ScaleUp | super_admin, fund_admin |
| audit_log | super_admin, fund_admin, partner | none (triggers / RPC) |
| access_links **(updated, new)** | none (RLS on, no policies, no grants: service role only) | none (service role only; trigger `access_links_guard`: issuer rules, never changed; used through `claim_access_link()`) |

Private helpers (security definer, stable): `private.today_myt()`, `private.mfa_ok()`, `private.scaleup_role()` (null unless active + mfa_ok + **(updated)** current terms accepted),
`private.is_scaleup()`, `private.has_role(variadic scaleup_role[])`, `private.is_company_member(uuid)`, `private.company_role(uuid)`,
`private.is_partner_of(uuid)`, `private.can_view_company(uuid)`, `private.can_edit_submission(uuid)`, `private.submission_company(uuid)`.
In policies wrap argument-less helpers as `(select private.is_scaleup())` for initPlan caching.
**(updated)** Also granted to `authenticated` for policies: `private.is_active_user()`, `private.dimension_company(uuid)`,
`private.shares_company_with(uuid)`, `private.is_company_user(uuid)`, `private.is_active_company(uuid)`,
`private.can_upload_company_document(uuid)`, `private.can_upload_document_object(text)`,
`private.template_version_is_draft(uuid)`, `private.try_uuid(text)`. Internal (not granted): `is_system()`,
`has_role_or_system()`, `system_fields()`, `validate_submission()`, `number_issues()`, `compute_period_totals()`,
`ensure_periods()`, `set_audit_context()`, … `app.today` (a GUC) overrides `today_myt()` in tests.
**(updated)** Access helpers now also require the current terms of use: `private.terms_ok()` (profile
`terms_accepted_at` set and `terms_version` = `platform_settings.terms_version`; internal), `private.is_active_session()`
(active profile + MFA, no terms check; internal, used by `accept_terms` only), `private.is_active_user()` =
`is_active_session() and terms_ok()`; `scaleup_role()` and `company_role()` build on `is_active_user()`.
`private.is_partner_of(company)` reads `company_internal.partner_in_charge_id`.
**(updated, second patch)** Internal (not granted): `private.access_link_issuer_ok(created_by, user_id)` (who may hold a link
for an account; used by `access_links_guard()` and `claim_access_link()`).
**(decisions 2026-10-01)** Internal (not granted): trigger function `private.company_members_contributor_limit()` (BRD B29).
Public, granted to authenticated: `public.staff_display_names(uuid[])` (BRD B28; §2.4).
**(B30)** Internal (not granted): trigger function `private.revenue_segments_guard()`. Public, granted to authenticated:
`public.set_company_revenue_segments(uuid, jsonb)` (§2.4).

### 2.8 Storage
Private bucket **`company-documents`** (created in a migration; 25 MB limit; PDF, XLSX, XLS, CSV, DOCX).
Object path: `<company_id>/<period_close_id or 'general'>/<uuid>-<sanitised file name>`.
Policies on `storage.objects`: SELECT when `private.can_view_company(first folder)`; INSERT when company member of that company or fund_admin.
No UPDATE/DELETE. Uploads use signed upload URLs created server-side after a permission check; downloads use 60-second signed URLs.
**(updated)** INSERT policy = `private.can_upload_document_object(name)`: the same strict path shape as §2.2 documents
(lower-case ids, three segments, the period-close folder must be a close of that company) and a member of that
**active** company or a Fund Admin. Flow for M8: (1) permission check in the action, (2) signed upload URL, (3) upload,
(4) insert the `documents` row (`.select('id, version')` returns the version assigned by the database). Sign
download URLs (service role) only for `storage_path` values read from `documents` rows the caller can see.
MIME types: `DOCUMENT_MIME_TYPES`, size limit `DOCUMENT_MAX_BYTES` in `src/lib/constants.ts`.

### 2.9 Seed (`supabase/seed.sql`)
Settings row; funds **SV1** "ScaleUp Ventures 1 Sdn Bhd" and **SFF** "ScaleUp Founders Fund LP"; default template
"Portfolio Update" v1 **published** (sections/fields in §3); pilot companies **Batik Boutique**, **RECQA**, **Kiddocare**
(`reporting_start_month = '2026-07-01'`, no fund mapping / sector / ownership — to be completed by admins) with the KPIs from BRD §6.2:
Batik Boutique — dimension "Outlet" (Mont Kiara, The Row, IOI City Mall, Westin Desaru, Merdeka 118), KPIs "Revenue per outlet" (currency),
"Monthly break-even" (currency), "Profitable" (boolean), all monthly per outlet; Kiddocare — "App downloads" (integer),
"Bookings" (integer), "Active carers" (integer), "Payouts to carers" (currency). No users are seeded (create with `npm run user:create`).
**(updated)** Fixed UUIDs (documented in `seed.sql`, exported for tests in `tests/db/fixtures.ts`): template
`b0000000-0000-4000-8000-000000000001`, v1 `b1000000-0000-4000-8000-000000000001`, companies Batik Boutique
`c0000000-…-000000000001`, RECQA `…02`, Kiddocare `…03`. The settings row and the template are always ensured; funds
(`funds_v1`) and the pilot companies with their KPIs (`pilot_companies_v1`) are one-time blocks recorded in
`private.seed_markers` (new bootstrap data needs a new marker key). KPI units: RM (Batik revenue and break-even,
Kiddocare payouts), none (Profitable), downloads / bookings / carers. No periods are seeded: `open_due_periods()` creates them.
**(updated) Launch portfolio** (BRD Appendix A; one-time block `portfolio_h1_2026_v1`, source
`docs/build-notes/portfolio-seed.sql`): 18 companies — the pilot (reporting from `2026-07-01`) plus 15 **"Not yet
reporting"** companies (`reporting_start_month` null) with fixed ids `c0000000-…-0000000000NN`: 04 AOne ("Formerly AOne
Schools."), 05 Agiliux, 06 BiiB, 07 IIMMPACT, 08 TixCarte, 09 Buzz ("Formerly BeeBag."), 10 Docspe / Plexis.ai, 11 Huddle,
12 Kabel, 13 StayHere (**written_off**, reason "Fully impaired and written down; voluntary strike-off in progress (H1 2026
SFF report)."), 14 Petotum, 15 SonicBoom, 16 i-Motorbike (legal name iMotorbike Pte Ltd, Singapore, **USD**), 17 Fefifo,
18 E.R.T.H. Every company (the pilot included) is mapped to its fund — fund investments `f0000000-…-0000000000NN` (NN =
the company's NN), **SV1 7** (Batik Boutique, RECQA, AOne, Agiliux, BiiB, IIMMPACT, TixCarte), **SFF 11** (Kiddocare, Buzz,
Docspe / Plexis.ai, Huddle, Kabel, StayHere, Petotum, SonicBoom, i-Motorbike, Fefifo, E.R.T.H) — without investment date,
instrument or ownership (admins complete them). Huddle's KPIs `e0000000-…-000000000008…11`: Cameras deployed (integer,
"cameras"), Games recorded (integer, "games"), Games per camera (number, "games"), Games broken down for statistics
(integer, "games"), all monthly and required. Every company's `company_internal` row is always ensured; no
partner-in-charge is seeded (assigned once the partners' accounts exist).

---

## 3. Master template "Portfolio Update" v1 (seeded)

| # | Section key | Title | Kind | Fields (key — label — type — flags) |
|---|---|---|---|---|
| 1 | `financials` | Financials | financials | `revenue_total` — Total revenue — currency — required, system · `gross_profit` — Gross profit — currency — required, system, allow negative · `net_profit` — Net profit — currency — required, system, allow negative · `cash_in_bank` — Cash in bank (month end) — currency — required, system · `burn_rate` — Burn rate (per month) — currency — required, system, help "Enter 0 if cash-flow positive" |
| 2 | `headcount` | Headcount | headcount | `headcount_ft` — Full-time headcount — integer — required, system · `headcount_pt` — Part-time headcount — integer — required, system |
| 3 | `kpis` | Company KPIs | kpis | (renders the company's KPIs) |
| 4 | `company_summary` | Company Summary | narrative | `key_milestones` — Key milestones — long_text |
| 5 | `revenue_financial` | Revenue and Financial Metrics | narrative | `financial_commentary` — Commentary on the month's numbers — long_text |
| 6 | `partnerships_market` | Partnerships and Market Updates | narrative | `partnerships` — Partnerships and market updates — long_text |
| 7 | `operation` | Operation | narrative | `operations_highlights` — Operations highlights — long_text · `team_highlights` — Team highlights — long_text |
| 8 | `product_development` | Product Development | narrative | `product_highlights` — Product highlights — long_text |
| 9 | `customer_acquisition` | Customer Acquisition Strategies | narrative | `sales_highlights` — Sales highlights — long_text · `marketing_highlights` — Marketing highlights — long_text |
| 10 | `investment` | Investment | narrative | `fundraising_status` — Fundraising status — picklist [Not raising, Preparing to raise, Actively raising, Term sheet received, Closing round, Round closed] · `fundraising_commentary` — Fundraising commentary — long_text |
| 11 | `compliance_regulation` | Compliance and Regulation | narrative | `compliance_updates` — Licences and regulatory matters — long_text |
| 12 | `other_mentionables` | Other Mentionables | narrative | `other_updates` — Anything else — long_text |
| 13 | `founder_pulse` | Founder Pulse | pulse | `team_morale` — Team morale — rating 1–5 · `next_month_goals` — Next month goals — long_text · `help_needed` — Help needed from ScaleUp — long_text · `help_tags` — Help needed (tags) — tags [Fundraising, Hiring, Sales introductions, Partnerships, Legal and regulatory, Finance, Product and technology, Marketing, Other] |

The C4 export maps narrative sections to C4 rows by section title (in template order).
**(updated)** Seeded `sort_order` = the # column for sections, 1… within each section for fields. Seeded `validation`:
`{"min": 0}` on `revenue_total`, `cash_in_bank`, `burn_rate`, `headcount_ft`, `headcount_pt`; `{"allow_negative": true}` on
`gross_profit`, `net_profit`. `team_morale` options `{"min": 1, "max": 5, "labels": {"1": "Very low", "5": "Very high"}}`.

---

## 4. Routes and module ownership

Each module **owns** the listed paths exclusively. Do not create or edit files owned by another module.
Shared foundation files (§5) are read-only during feature work.

| Module | Owns |
|---|---|
| **F-DB** Database | `supabase/**`, `tests/db/**`, `scripts/gen-db-types.ts`, `scripts/db-verify.ts` **(updated)**, `src/lib/supabase/database.types.ts` |
| **F-AUTH** Auth & shell **(updated)** | `src/proxy.ts`, `src/lib/supabase/{server,client,admin,proxy}.ts`, `src/lib/auth/**` (session, types, permissions, redirects, idle, availability, rate-limit, password, features), `src/lib/actions/result.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/icon.png`, `src/app/apple-icon.png`, `src/app/(auth)/**`, `src/app/auth/**`, `src/app/no-access/**`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/app/portal/layout.tsx`, `src/app/portal/page.tsx`, `src/app/portal/[companyId]/layout.tsx`, `src/components/shell/**`, `src/components/app/**`, `public/brand/**`, ~~`scripts/create-user.ts`~~ **(updated, integration: `scripts/create-user.ts` is M2's; the catch-all error boundaries `src/app/admin/error.tsx` and `src/app/portal/[companyId]/error.tsx` are F-AUTH's)** |
| **F-LIB** Core libs | `src/lib/periods.ts`, `src/lib/metrics.ts`, `src/lib/format.ts`, `src/lib/validation.ts`, `src/lib/constants.ts`, `src/lib/targets.ts`, `tests/unit/**` |
| **F-DATA** Data layer | `src/lib/types/domain.ts`, `src/lib/data/**`, `tests/data/**` **(updated)**; **(updated, integration)** `src/lib/fetch-all.ts` (`fetchAllRows`, the paged PostgREST read the tracker and /admin/cycles share) |
| Shared / generated **(updated)** | `src/components/ui/**`, `src/hooks/use-mobile.ts`, `src/lib/utils.ts`, `src/lib/types/enums.ts`, `components.json` |
| M1 Funds & companies (A1, A4) | `src/app/admin/funds/**`, `src/app/admin/companies/page.tsx`, `src/app/admin/companies/new/**`, `src/app/admin/companies/[companyId]/page.tsx`, `src/app/admin/companies/[companyId]/_components/**`, `src/app/admin/companies/actions.ts` |
| M2 Users & team (A2, C1) **(updated)** | `src/app/admin/users/**`, `src/app/portal/[companyId]/team/**`, `src/lib/auth-admin/**`, `src/app/access/**` (access-link accept page, BRD B14), **(updated, integration)** `scripts/create-user.ts` |
| M3 Templates (A3) | `src/app/admin/templates/**` |
| M4 Cycles & settings (A5) | `src/app/admin/cycles/**`, `src/app/admin/settings/**` |
| M5 Monthly update form (C3, C6, on-behalf) | `src/components/submission-form/**` (stub exists), `src/app/portal/[companyId]/updates/**`, `src/app/admin/companies/[companyId]/updates/**`, `src/lib/actions/submission.ts` |
| M6 Review & comments (A7, C7) | `src/app/admin/review/**`, `src/components/comments/**` (stub exists), `src/lib/actions/comments.ts`, `src/components/review/**` |
| M7 Tracker & home (A6, C2) | `src/app/admin/tracker/**`, `src/app/portal/[companyId]/page.tsx`, `src/app/portal/[companyId]/_components/**`, `src/app/portal/[companyId]/history/**` |
| M8 Documents & period close (C4) | `src/app/portal/[companyId]/documents/**`, `src/app/admin/documents/**`, `src/app/api/documents/**`, `src/components/documents/**`, `src/lib/actions/documents.ts` |
| M9 Exports & audit (A13, A14) | `src/app/admin/exports/**`, `src/app/admin/audit/**`, `src/app/api/exports/**`, `src/lib/exports/**` |
| **SEG** Revenue segments UI (B30) **(updated, integration)** | `src/app/portal/[companyId]/segments/**`; inside other modules' folders: the revenue area of the monthly form (`src/components/submission-form/revenue.tsx` and its hooks in `draft.ts`, `form-context.tsx`, `sections.tsx`, `submission-form.tsx`), the admin company page's revenue tab (`revenue-tab.tsx`, `revenue-lines-editor.tsx`, `revenue-data.ts`, `company-segments-panel.tsx`, `tabs.ts` in `src/app/admin/companies/[companyId]/_components/`) and the portal sidebar's "Revenue segments" item; tests in `tests/features/seg/**` |

**(updated)** Foundation regression tests every module must keep green: `npm test` (= `tests/unit`, `tests/db` and
`tests/data`; or `npm run test:unit` / `npm run test:db` separately) — including `tests/db/mirror-parity.test.ts` (SQL
validation / period totals = TS mirrors), `tests/db/permissions-parity.test.ts` (permission helpers = RLS/RPC checks),
`tests/unit/action-result.test.ts` (`toActionError`), `tests/unit/proxy.test.ts` (public routes of the proxy, e.g.
`/access/[token]`), `tests/data/*` (data layer), **(updated, second patch)** `tests/db/patch-review.test.ts` (the independent
review's findings, kept as regression tests) and **(decisions 2026-10-01)** `tests/db/decisions-2026-10-01.test.ts` (BRD B28
staff names, B29 contributor limit) and **(B30)** `tests/db/revenue-segments-b30.test.ts` (two revenue breakdowns). Before deploying a migration change: `npm run db:verify` (dry run on the hosted
Postgres 17 of the migrations not yet deployed + the seed, always rolled back; verifies the server's TLS certificate and refuses
files with BEGIN / COMMIT / END / ROLLBACK / SAVEPOINT — `scripts/sql-transaction-control.ts`, also checked by
`tests/db/migrations.test.ts`, which also pins the deployed `20260930…` files), then the lead runs `npm run db:push`.

### Route map
- Auth: `/login`, `/forgot-password`, `/set-password`, `/mfa`, `/terms`, `/no-access`; route handlers `/auth/confirm` (verifyOtp by `token_hash` + `type`), `/auth/callback` (PKCE `code` exchange), `/auth/signout` (POST).
  **(updated)** `/access/[token]` — **public** accept page for our own invitation / sign-in links (BRD B14, `access_links`), **owned by M2** (`src/app/access/**`): GET only renders who the link is for and an "Accept invitation" / "Sign in" button; the Server Action **(updated, second patch)** first claims the link atomically with `claim_access_link` (service role; single use even under concurrent requests), then signs the user in (`generateLink` + `verifyOtp`), calls `startIdleClock()` and redirects to `/set-password` (invite) or `/mfa` (sign-in). Links that cannot be claimed (expired, used, revoked, deactivated account, issuer no longer allowed) show "ask ScaleUp (or your company owner) for a new link".
  **(updated)** `/auth/confirm` is a **page + Server Action** (GET/HEAD only render an "Accept your invitation" / "Reset your password" button; `verifyOtp` runs in `confirmEmailLinkAction`; types `invite` and `recovery` only; `next` defaults to `/set-password`). `/auth/keepalive` (GET/POST, JSON) is pinged by `<IdleTimer>`. `/set-password` has two modes: a recent email-link session sets a password; any other session must enter the current password. `/forgot-password` sends reset emails only when `PASSWORD_RESET_EMAILS_ENABLED=true` (otherwise it tells people to ask ScaleUp for a new sign-in link).
- `/` → redirect by role: ScaleUp → `/admin/tracker`; company user with one company → `/portal/<id>`; several → `/portal`; none → `/no-access`.
- ScaleUp (`/admin`, sidebar): Tracker `/admin/tracker` · Review `/admin/review/[submissionId]` · Companies `/admin/companies`, `/admin/companies/new`, `/admin/companies/[companyId]`, on-behalf form `/admin/companies/[companyId]/updates/[month]` · Funds `/admin/funds` · Documents `/admin/documents` · Exports `/admin/exports` · Templates `/admin/templates`, `/admin/templates/[versionId]` · Cycles `/admin/cycles` · Users `/admin/users` · Audit log `/admin/audit` · Settings `/admin/settings`.
  **(updated)** `/admin` redirects to `/admin/tracker`. Nav visibility: Users, Settings → Super Admin; Templates, Cycles → Super Admin + Fund Admin; Audit log → all but Viewer; Tracker, Companies, Funds, Documents, Exports → every ScaleUp role (read-only where the role cannot manage). Pages must still call their own guard.
- Company (`/portal`): company picker `/portal`; per company `/portal/[companyId]` (home) · Monthly updates `/portal/[companyId]/updates`, `/portal/[companyId]/updates/[month]` · Documents `/portal/[companyId]/documents` · Team `/portal/[companyId]/team` · History `/portal/[companyId]/history`.
  **(updated)** Team is shown in the sidebar to owners only. ScaleUp staff opening a `/portal/...` URL are redirected to `/admin` by the portal layout.
  **(B30)** Revenue segments `/portal/[companyId]/segments` — the company's own revenue segments (owners edit, with the
  comparability warning; contributors and owners of exited companies read only; built by the B30 UI step, sidebar link for
  every member). ScaleUp edits a company's own segments on the owner's behalf and its ScaleUp revenue lines on
  `/admin/companies/[companyId]` (M1's revenue lines tab becomes `kind = 'scaleup'` only).
- API: `GET /api/documents/[documentId]/download` (signed URL redirect) · `GET /api/exports/c4/[companyId]` (xlsx) · `GET /api/exports/portfolio?format=xlsx|csv&fund=&from=&to=` · `GET /api/exports/documents/[companyId]?closeId=` (zip).
- **(updated, integration) Routes as built** (every page calls its own guard; page props are typed explicitly with
  `params` / `searchParams` as Promises; `npx next typegen` generates the route types). Deep-link parameters other modules use:
  - `/admin/tracker` (every ScaleUp role; M7) `?fund=<fund code>&partner=<profile uuid>|none&status=needs_attention|overdue|escalated|not_submitted|submitted|changes_requested|approved&months=6|12&search=<text>`; cells → `/admin/review/<submissionId>`.
  - `/admin/review` → redirects to `/admin/tracker`; `/admin/review/[submissionId]` (every ScaleUp role; M6; 404 for unknown,
    malformed or invisible ids; drafts and months sent back render too) → "Edit on behalf"
    `/admin/companies/<id>/updates/<YYYY-MM>` (Fund Admin, active company, draft / changes requested), documents
    `/admin/documents?company=<id>` (quarter / half ends), settings `/admin/settings` (Super Admin).
  - `/admin/companies` (M1) `?q=&fund=<CODE>&status=active|exited|written_off&partner=<uuid>|none&reporting=yes|no` ·
    `/admin/companies/new` (Super Admin) · `/admin/companies/[companyId]?tab=overview|funds|revenue|kpis|team|internal|updates`
    (`companyTabHref(id, tab)`; the `revenue` tab is labelled "ScaleUp revenue lines" and also shows the company's own
    segments read-only; Team → `/admin/users?company=<id>`) · `/admin/companies/[companyId]/updates/[month]` (M5: Fund Admin
    on-behalf entry, read-only "View only" for the other roles; no list page at `/admin/companies/[companyId]/updates`).
  - `/admin/funds` (M1; company counts → `/admin/companies?fund=<CODE>`) · `/admin/documents` (M8)
    `?period=Q3-2026&fund=<code>` or `?company=<id>[&period=Q3-2026|&close=<closeId>]` · `/admin/exports` (M9, every ScaleUp
    role) · `/admin/audit` (M9; super_admin, fund_admin, partner) `?company=<uuid>&actor=<text>&action=<action>&entity=<table>&from=YYYY-MM-DD&to=YYYY-MM-DD&page=N`.
  - `/admin/templates`, `/admin/templates/[versionId]` (M3; Super Admin, Fund Admin) · `/admin/cycles` (M4; Super Admin, Fund
    Admin) `?tab=months|deadlines|closes|fx&extend=<submissionId>` · `/admin/users` (M2; Super Admin)
    `?tab=scaleup|company|pending&company=<companyId>` · `/admin/settings` (M4; Super Admin).
  - Portal (every member unless noted): `/portal/[companyId]` (M7 home) · `/portal/[companyId]/updates` and
    `/portal/[companyId]/updates/[month]` (M5; `YYYY-MM`, a full date redirects to it, anything else 404) ·
    `/portal/[companyId]/segments` (SEG) · `/portal/[companyId]/documents?close=<closeId>` (M8) · `/portal/[companyId]/team`
    (M2; sidebar for owners) · `/portal/[companyId]/history` (M7; owners get "Download my data (Excel)" →
    `/api/exports/c4/<companyId>`).
  - `/access/[token]` (M2): **(updated, integration)** a claimed **sign-in** link continues to `/mfa?next=/set-password` (BRD
    B23: a sign-in link is how a forgotten password is recovered); an invitation to `/set-password`. Bare `/access` → `/login`.
  - API (M8, M9): `GET /api/documents/[documentId]/download` (302 to a 60-second signed URL, audited `download` / `documents`)
    · `GET /api/exports/c4/[companyId]?include=approved|all` (xlsx; every ScaleUp role, owners of that company — no RM block
    for owners) · `GET /api/exports/portfolio?format=xlsx|csv&fund=<code or id|all>&from=YYYY-MM&to=YYYY-MM&status=approved|all`
    (ScaleUp) · `GET /api/exports/documents/[companyId]?closeId=<uuid>` (zip; ScaleUp, owners; at most 100 MB, else 413) ·
    `GET /api/exports/audit?company=&actor=&action=&entity=&from=&to=` (CSV; super_admin, fund_admin, partner; at most
    50 MB / 45 s, then a final "Export incomplete: …" record). HEAD → 405 on all of them. Errors are JSON `{ error }` for
    `fetch()` callers and a small HTML page with "Go back" for browser navigations (plain links).
- **(updated) Proxy** (`src/proxy.ts` → `updateSession` in `src/lib/supabase/proxy.ts`): public pages `/login`, `/forgot-password`, `/access` (`/access/*` is also a self-managed auth route like `/auth/confirm`: the proxy never refreshes or rewrites auth cookies there, so they cannot race with the accept action's new session); signed-out page requests → `/login?next=<path>`; signed-out `/api/*` and `/auth/keepalive` → **401 JSON** `{ error, reason: "timeout" | "signed_out" }` **(updated, integration: except a browser navigation to `/api/*` — `Sec-Fetch-Mode: navigate`, or an HTML `Accept` without fetch metadata, e.g. a plain download link — which goes to `/login?next=<the same-origin page the link was on>` (`/login?reason=timeout` after the idle timeout; the 503 page while Auth is unavailable); `fetch()` callers keep the JSON)**; Server Action POSTs are never redirected (the action's guard answers). 30-minute idle timeout via the httpOnly `su_last_seen` cookie. When Supabase Auth is rate-limited or unreachable nobody is signed out: pages get a 503 page, `/api/*` 503 JSON `{ error, reason: "unavailable" }` with `Retry-After`. Security headers on every response. A new public route must be added to `PUBLIC_PAGES` there (ask F-AUTH).

---

## 5. Shared foundation APIs (implemented in the foundation phase; import, don't re-implement)

### 5.1 Supabase clients
- `src/lib/supabase/server.ts` — `export async function createClient(): Promise<SupabaseClient<Database>>` (cookie session, RLS applies).
- `src/lib/supabase/client.ts` — `export function createClient(): SupabaseClient<Database>` (browser; used for storage uploads to signed URLs and MFA).
- `src/lib/supabase/admin.ts` — `import "server-only"`; `export function createAdminClient(): SupabaseClient<Database>` (secret key; Auth admin + storage signing only; **(updated)** plus the service-role-only `access_links` table, M2).
- `src/lib/supabase/database.types.ts` — generated `Database` type (by `npm run db:types`).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SECRET_KEY` (falls back to `SUPABASE_SERVICE_ROLE_KEY`), `SUPABASE_DB_URL`, `NEXT_PUBLIC_SITE_URL`. **(updated)** `npm run db:verify` only (optional): `SUPABASE_DB_CA_FILE` (CA to verify the database's TLS certificate; default `supabase/certs/prod-ca-2021.crt` for Supabase hosts), `SUPABASE_POOLER_URL`, `SUPABASE_REGION`.
- **(updated)** Types: `import type { Database, Tables, TablesInsert, TablesUpdate, Enums, Json } from '@/lib/supabase/database.types'`; option lists from `Constants.public.Enums.*`. Regenerate with `npm run db:types` after any migration change (`npx tsx scripts/gen-db-types.ts --check` fails when stale). `__InternalSupabase.PostgrestVersion` is `"14"` (the hosted project runs PostgREST 14; postgrest-js treats 13 and 14 alike). Assign query results to typed variables instead of casting, so `tsc` checks every select string (a wrong column becomes a `SelectQueryError` type error). Optional env: `PASSWORD_RESET_EMAILS_ENABLED=true` (§4). The server client never deletes the session after a *temporary* Auth failure (429/5xx/network).

### 5.2 Auth / access (`src/lib/auth/*`, server-only)
```ts
type ScaleupRole = 'super_admin' | 'fund_admin' | 'partner' | 'viewer'   // from src/lib/types/enums.ts
type CompanyRole = 'owner' | 'contributor'
type Membership = { companyId: string; companyName: string; companyStatus: CompanyStatus; role: CompanyRole }
type AccessContext = {
  userId: string; email: string; fullName: string | null;
  scaleupRole: ScaleupRole | null; isActive: boolean;
  memberships: Membership[];
  aal: 'aal1' | 'aal2'; mfaRequired: boolean; termsAccepted: boolean;
}
getAccessContext(): Promise<AccessContext | null>            // React cache()-wrapped, one per request
requireUser(): Promise<AccessContext>                         // redirects: /login, /mfa, /terms, /no-access (inactive)
requireScaleUp(roles?: ScaleupRole[]): Promise<AccessContext> // company users → /portal; wrong role → notFound()
requireCompanyAccess(companyId: string, roles?: CompanyRole[]): Promise<AccessContext & { companyRole: CompanyRole }>  // non-members → notFound()
// For Server Actions / route handlers (throw ActionError instead of redirecting):
assertScaleUp(roles?: ScaleupRole[]): Promise<AccessContext>
assertCompanyAccess(companyId: string, roles?: CompanyRole[]): Promise<AccessContext & { companyRole: CompanyRole }>
```
**(updated) As built** — types in `src/lib/auth/types.ts` (type-only, client-safe), functions in `src/lib/auth/session.ts`:
```ts
type ScaleUpAccessContext = AccessContext & { scaleupRole: ScaleupRole }
type CompanyAccessContext = AccessContext & { companyRole: CompanyRole }
type CompanyViewContext   = AccessContext & { companyRole: CompanyRole | null }   // null for ScaleUp staff
// AccessContext.memberships: ACTIVE memberships sorted by company name.
getAccessContext(): Promise<AccessContext | null>   // null = no session; scaleupRole null and memberships [] until the
                                                    // session is fully verified (active, MFA, terms). Never authorise with it.
                                                    // Throws AuthUnavailableError when Supabase Auth is unreachable/rate-limited.
getSessionClaims(): Promise<JwtPayload | null>
getAuthSettings(): Promise<{ requireMfa: boolean; termsVersion: string }>   // (updated) via rpc get_client_settings
requireUser(): Promise<AccessContext>   // no session → /login; inactive → /no-access?reason=inactive; aal1 → /mfa; terms → /terms
requireScaleUp(roles?: readonly ScaleupRole[]): Promise<ScaleUpAccessContext>
requireCompanyAccess(companyId: string, roles?: readonly CompanyRole[]): Promise<CompanyAccessContext>
                                        // non-UUID → notFound(); ScaleUp staff → redirect(`/admin/companies/${id}`)
assertUser(): Promise<AccessContext>    // same checks as requireUser, throws ActionError
assertScaleUp(roles?: readonly ScaleupRole[]): Promise<ScaleUpAccessContext>
assertCompanyAccess(companyId: string, roles?: readonly CompanyRole[]): Promise<CompanyAccessContext>
                                        // active members only; ScaleUp users rejected ("This action is only available to company users.")
assertCanViewCompany(companyId: string): Promise<CompanyViewContext>   // both audiences (downloads, exports)
startIdleClock(): Promise<void>        // every new sign-in path must call it before responding
isUuid(value: unknown): value is string
class AuthUnavailableError extends ActionError
```
All guards are memoised per request. Layouts do not re-run on client navigation, so **every page calls its own guard**.
Other modules in `src/lib/auth/`: `redirects.ts` (`safeNextPath`, `firstParam`, `withNext`), `idle.ts` (`markSessionActive`,
`LAST_SEEN_COOKIE`, `IDLE_WARNING_BEFORE_MS`, `isIdleExpired`, …), `availability.ts`, `rate-limit.ts` (`RATE_LIMITS`,
`consumeRateLimit(s)`, `clientIp`), `password.ts`, `features.ts` (`passwordResetEmailsEnabled()`).

`src/lib/auth/permissions.ts` — pure helpers mirroring §1 for showing/hiding UI (DB still enforces):
`canManagePlatform(ctx)`, `canManageTemplates(ctx)`, `canManageCycles(ctx)`, `canEnterData(ctx, companyId)`, `canSubmit(ctx, companyId)`,
`canComment(ctx)`, `canApprove(ctx, company: { partner_in_charge_id: string | null })`, `canReopen(ctx, company)`, `canEditInternal(ctx, company)`,
`canExport(ctx, companyId?)`, `canViewAudit(ctx)`, `isScaleUp(ctx)`.
**(updated) As built** (client-safe; `ctx` is any `PermissionSubject = Pick<AccessContext, 'userId' | 'scaleupRole' | 'memberships'>`;
**`PartnerAssignment = { partner_in_charge_id: string | null }`** — the company's `company_internal` row, e.g. from
`getCompanyInternal(sb, companyId)`, or null when not available (company users never see it: only role-based rights
remain); an omitted `companyStatus` means active; they check roles and company state, not month/thread state):
- `isScaleUp(ctx)`, `membershipFor(ctx, companyId): Membership | null`, `companyRoleOf(ctx, companyId): CompanyRole | null`
- `canManagePlatform(ctx)` — super_admin · `canManageTemplates(ctx)` — super_admin, fund_admin (templates, KPIs, segments, FX)
- `canManageCycles(ctx)` — super_admin, fund_admin (**`open_period`**, portfolio-wide) · **`canExtendDueDate(ctx, companyStatus?)`** — super_admin, fund_admin, **active companies only** (`extend_due_date`) · **`canReopenPeriodClose(ctx, companyStatus?)`** — super_admin, fund_admin, **(updated, second patch) active companies only** (`reopen_period_close`)
- `canEnterData(ctx, companyId, companyStatus?: CompanyStatus)` — members of an active company; fund_admin on behalf (pass `companyStatus`; omitted = active). Also covers document uploads.
- `canSubmit(ctx, companyId)` — owner of an active company (submit, resubmit, **request amendment**)
- `canConfirmPeriodClose(ctx, companyId, companyStatus?)` — owner of an active company; fund_admin on behalf (active company)
- `canComment(ctx)` — super_admin, fund_admin, partner (start threads; any company, exited ones included) · **`canRequestChanges(ctx, companyStatus?)`** — the same roles, **active companies only** (`request_changes`)
- `canReplyToComments(ctx, companyId)`, `canResolveComments(ctx, companyId)` — ScaleUp non-viewers; members of the company while it is **active**
- `canApprove(ctx, internal: PartnerAssignment | null)` — super_admin or partner-in-charge (also for exited companies) · `canReopen(ctx, internal, companyStatus?)` — super_admin, fund_admin, partner-in-charge, **active companies only** · `canEditInternal(ctx, internal)` — super_admin, fund_admin, partner-in-charge (rating, exit status, notes) · **`canAssignPartner(ctx)`** — super_admin only
- `canExport(ctx, companyId?)` — every ScaleUp role; owners for their own company · `canViewAudit(ctx)` — super_admin, fund_admin, partner
- `canInviteUsers(ctx, companyId?)` — super_admin; owners of an **active** company · `canManageCompanyTeam(ctx, companyId)` — owners of an **active** company (portal team page)
- **(updated, integration; B30)** `canManageCompanySegments(ctx, companyId, companyStatus?)` — the company's own revenue segments (`set_company_revenue_segments`): owner of an **active** company; super_admin / fund_admin on behalf while the company is active (pass `companyStatus` for ScaleUp staff; omitted = active)

### 5.3 Server action result (`src/lib/actions/result.ts`)
```ts
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }
export class ActionError extends Error {}
export function ok<T>(data: T): ActionResult<T>; export function fail(error: string, fieldErrors?): ActionResult<never>
export function toActionError(e: unknown): ActionResult<never>   // maps Postgres/Supabase errors to friendly text
```
**(updated) As built:** `new ActionError(message, fieldErrors?)`; `ok()` (no argument) returns `ActionResult<void>`;
`MESSAGES = { permission, duplicate, inUse, missingReference, notAllowed, network, session, notFound, invalid, generic }`.
`toActionError(e)` re-throws `redirect()`/`notFound()` (`unstable_rethrow`), then maps:
`ActionError` → its message (+ fieldErrors) · `ZodError` → "Please check the highlighted fields." + first message per dotted path ·
network failures → "Couldn't reach the server. Please try again." · **P0001** → the database message as-is (≤ 500 chars) ·
**42501** → the RPC's own friendly message, but "You don't have permission to do that." for Postgres RLS/privilege text ·
23505 → "That already exists." · **23503/23001** → "This item is in use and can't be removed." (or "Something this refers to no
longer exists. Please reload the page and try again." for an insert/update) · 23514 → "One of the values isn't allowed…" ·
PGRST116 → not-found message · PGRST301/PGRST303 → session expired · anything else → generic (logged). For a `DataError`
(src/lib/data) the database message is read from its `cause`, never the data layer's own text.
Pattern: `try { const ctx = await assertScaleUp(['super_admin']); …; if (error) throw error; revalidatePath(p); return ok(data) } catch (e) { return toActionError(e) }`.

### 5.4 Core libs
- `src/lib/periods.ts` — `MonthKey` = `'YYYY-MM'`; `monthKeyToDate('2026-09') → '2026-09-01'`; `dateToMonthKey('2026-09-01') → '2026-09'`;
  `isMonthKey(s)`; `monthLabel(m) → 'Sep 2026'`, `monthLabelLong(m) → 'September 2026'`; `addMonths(m, n)`; `monthsBetween(a, b)` (inclusive list);
  `quarterOf(m)` / `halfOf(m)` → `{ type, label: 'Q3 2026' | 'H2 2026', start, end, months: string[] }`; `isQuarterEnd(m)`, `isHalfEnd(m)`;
  `todayMYT() → 'YYYY-MM-DD'`; `lastCompletedMonth(today?)`; `dueDateFor(month, dueDay)`; `daysBetween(a, b)`. Accepts either `YYYY-MM` or `YYYY-MM-DD`.
  **(updated)** Invalid input throws `RangeError`; for route params use `parseMonthKey(v): MonthKey | null` (then `notFound()`).
  `ClosePeriod = { type, label, rangeLabel: 'Jul–Sep 2026', year, index, start: '2026-07-01', end: '2026-09-30' (last day),
  startMonth, endMonth, months: MonthKey[] }`; match `period_closes` rows by month key (`dateToMonthKey(close.period_end) === q.endMonth`).
  Also: `DateKey`, `isDateKey`, `parseMonthParts`, `compareMonths`, `monthDiff(from, to)`, `lastDayOfMonth`, `closePeriodOf(type, m)`,
  `parsePeriodLabel('Q3 2026')`, `addDays(d, n)`, `daysBetween(a, b)` = b − a, `effectiveDueDate(month, dueDay, createdOn, graceDays)`,
  `daysOverdue(dueDate, today?)`, `parseInstant`, `mytParts`, `toMYTDate(iso)`, `currentMonthMYT(now?)`, `isLeapYear`, `daysInMonth`,
  `MONTH_NAMES_SHORT`, `MONTH_NAMES_LONG`, `MYT_OFFSET_MINUTES`. `monthsBetween` returns [] when reversed; `dueDateFor` caps the day at the month length.
- `src/lib/metrics.ts` — `MonthlyFinancials` = `{ month: string; revenue_total, gross_profit, net_profit, cash_in_bank, burn_rate: number | null; headcount_ft, headcount_pt: number | null }`;
  `gpPct(f)`, `npPct(f)`, `runwayMonths(f)` (null when burn is 0 → treat as cash-flow positive), `isCashflowPositive(f)`, `growthPct(curr, prev)`;
  `periodTotals(months: MonthlyFinancials[]): PeriodTotals` where `PeriodTotals = { months_count, revenue_total, gross_profit, net_profit, gp_pct, np_pct, cash_in_bank /*period end*/, avg_burn_rate, headcount_ft, headcount_pt /*period end*/ }`;
  `computeFlags({ current, previous, sameMonthLastYear, settings: { revenue_swing_pct, min_runway_months }, validationErrors }): Flag[]` where `Flag = { code: 'revenue_swing' | 'low_runway' | 'missing_required' | 'negative_cash'; severity: 'warning' | 'critical'; message: string }`.
  **(updated)** Also `deriveMetrics(f) → { gp_pct, np_pct, runway_months, cashflow_positive }`, `financialsFromValues(month, values)`,
  types `FlagCode`, `FlagSeverity`, `FlagSettings`, `ComputeFlagsInput`. Semantics: margins null when revenue is 0/null;
  `runwayMonths` null when burn ≤ 0 or a figure is missing, 0 when cash is negative; `growthPct = (curr − prev) / |prev| × 100`
  (null when prev is 0/null). `periodTotals` = the SQL `computed_totals`: flows summed over the months present (null when all
  blank); `gp_pct`/`np_pct` from the sums, rounded to 4 dp; cash and headcount from the latest month present (no back-fill);
  `avg_burn_rate` = mean of the burns present (4 dp); `months_count` = distinct months passed (pass only the months that
  should count, e.g. approved months for LP figures). `computeFlags`: `previous`, `sameMonthLastYear`, `settings`,
  `validationErrors` optional and `currency` accepted; `missing_required` (issues with code `required`) and `negative_cash`
  are critical; `low_runway` warning below `min_runway_months`, critical below 3 (not when burn is 0, a figure is missing or
  cash is negative); `revenue_swing` warning when |MoM| > `revenue_swing_pct`, critical above twice it; critical flags first.
  **(B30)** `FlagCode` gains `segments_exceed_total` (warning, non-blocking): pass the optional
  `scaleupLinesTotal` (the month's ScaleUp revenue lines added up, e.g. `sumSegmentAmounts(segmentsForMonth(bundle.config,
  bundle.current, editable).scaleup, bundle.current.segments)`) and it warns `"The ScaleUp revenue lines add up to RM 1,200,
  more than total revenue (RM 1,000)."` when they exceed `revenue_total` (not when either is missing). Label in
  `FLAG_CODE_LABELS` ("Revenue lines exceed total").
- `src/lib/validation.ts` — `validateSubmissionDraft(input): ValidationIssue[]` mirroring §2.6 rules 1–5 (rule 6 is server-side only); `ValidationIssue = { target: string; code: string; message: string }`.
  **(updated)** Output = SQL output minus `prior_months` (§2.6). Build the input with `toValidationInput(bundle, liveValues?)`
  from `@/lib/types/domain`. **(B30)** `ValidationInput.segments` items are `{ id, name, is_active, kind }` with
  `kind: RevenueSegmentKind` ('company' | 'scaleup'; anything else counts as a ScaleUp line): company segments carry the sum
  rule, ScaleUp lines are only required / non-negative (order and messages as §2.6). Also exported: `ValidationCode`, `ValidationInput`, `ValidationField`, `ValidationKpi`, `KpiCell`,
  `isEmptyValue(value, type?)`, `isHalfYearMonth(month)`, `isKpiDueInMonth(kpi, month)`, `kpiCellsForMonth(input)` (the KPI grid
  cells of the month, including optional KPIs; half-yearly only in Jun/Dec; active KPIs and members only),
  `requiredKpiCells(input)`, `groupIssuesByTarget(issues)`, `toFieldErrors(issues)` (first message per target — the
  `fieldErrors` shape).
- `src/lib/format.ts` — `formatMoney(n, currency = 'MYR', opts?: { compact?: boolean; decimals?: number })` (`MYR` → `RM`), `formatNumber`, `formatPct(n, decimals = 1)`, `formatDate('2026-09-30') → '30 Sep 2026'`, `formatDateTime(iso) → '30 Sep 2026, 14:05'` (MYT), `formatRelative(iso)`, `parseNumberInput('1,234.50') → 1234.5 | null`.
  **(updated)** No Intl: output is identical on server and client. Missing values render `EMPTY_DISPLAY` ('—'); negatives
  `-RM 1,234`; `formatMoney(v, currency, { compact: true })` → 'RM 1.2M'. Signatures: `formatNumber(n, decimals = 0)`,
  `formatNumberTrimmed(n, maxDecimals = 2)`, `formatNumberInput(n, maxDecimals = 4)` (round-trips with `parseNumberInput`),
  `formatPct(n, decimals = 1, { signed? })` ('+12.5%'), `formatRunway(months, { cashflowPositive? })` ('4.2 months', truncated;
  'Cash-flow positive'), `formatFileSize(bytes)`, `formatTime(iso)` ('14:05' for "Saved 14:05"), `formatRelative(v, now?)`
  (clock-dependent: render in client components), `currencySymbol(code)`, `toFiniteNumber(v)`, `DISPLAY_TIME_ZONE`.
  `parseNumberInput` accepts '1,234.50', 'RM 1,234.50', '(1,000)', '-RM 500'; rejects '1e3', '1,23', '1234,50'.
- `src/lib/constants.ts` — `SUBMISSION_STATUS_META` (label, tone), `SCALEUP_ROLE_LABELS`, `COMPANY_ROLE_LABELS`, `COMPANY_STATUS_LABELS`, `INTERNAL_RATING_META`, `KPI_FREQUENCY_LABELS`, `FIELD_TYPE_LABELS`, `SYSTEM_FIELD_KEYS`, `NUMBER_FIELD_KEYS`, `TERMS_VERSION`.
  **(updated)** Also: `Tone`, `OVERDUE_META`, `ESCALATED_META`, `MISSING_META`, **`NOT_YET_REPORTING_META`** (`{ label: "Not yet reporting", tone: "neutral", description }` for companies whose `reporting_start_month` is null, BRD B16), `COMPANY_STATUS_META`, `KPI_VALUE_TYPE_LABELS`,
  `SECTION_KIND_LABELS`, `TEMPLATE_STATUS_META`, `COMMENT_VISIBILITY_META`, `CLOSE_PERIOD_TYPE_LABELS`, `PERIOD_CLOSE_STATUS_META`,
  `DOCUMENT_TYPE_LABELS`, `SUBMISSION_EVENT_LABELS`, `SystemFieldKey`, `MONEY_FIELD_KEYS`, `HEADCOUNT_FIELD_KEYS`,
  `SYSTEM_FIELD_LABELS`, `NEGATIVE_ALLOWED_KEYS`, `NON_NEGATIVE_FIELD_KEYS`, `NUMBER_FIELD_TYPES`, `TEXT_FIELD_TYPES`,
  `JSON_FIELD_TYPES`, `NUMBER_KPI_VALUE_TYPES`, `SYSTEM_SECTION_KINDS`, `NARRATIVE_SECTION_KINDS`, `REVENUE_SUM_TOLERANCE`,
  `VALIDATION_CODE_LABELS`, `FLAG_CODE_LABELS`, `FLAG_SEVERITY_META`, `DEFAULT_DUE_DAY`, `DEFAULT_ESCALATION_DAYS`,
  `DEFAULT_BACKFILL_GRACE_DAYS`, `DEFAULT_REVENUE_SWING_PCT`, `DEFAULT_MIN_RUNWAY_MONTHS`, `CRITICAL_RUNWAY_MONTHS`,
  `DEFAULT_CURRENCY`, `TIME_ZONE`, `SESSION_IDLE_TIMEOUT_MS`, `DOCUMENT_MAX_BYTES`, `DOCUMENT_ACCEPT`, `DOCUMENT_MIME_TYPES`.
  `SUBMISSION_STATUS_META.draft.label` is "Not submitted"; `NUMBER_FIELD_KEYS` = `SYSTEM_FIELD_KEYS`.
  **(decisions 2026-10-01)** `SCALEUP_LABEL` ("ScaleUp": what the company side shows when no person can be named, e.g. system
  actions — `actor_name ?? SCALEUP_LABEL`), `SCALEUP_STAFF_SUFFIX` (" (ScaleUp)"; the database builds the display names, BRD B28),
  `DEFAULT_OWNER_CONTRIBUTOR_LIMIT` (4) and `OWNER_CONTRIBUTOR_LIMIT_MAX` (100) for `platform_settings.owner_contributor_limit`
  (BRD B29; M4's settings form validates 0–100).
  **(B30)** `REVENUE_SEGMENT_KINDS` (`['company', 'scaleup']`), type `RevenueSegmentKind`, `REVENUE_SEGMENT_KIND_META`
  (`{ label, plural, description }`: company "Revenue segment(s)" — "Defined by the company owner. They add up to total
  revenue."; scaleup "ScaleUp revenue line(s)" — "Defined by ScaleUp for this company. Reported every month; they need not
  add up to total revenue."), `REVENUE_SEGMENTS_MAX` (50) and `REVENUE_SEGMENT_NAME_MAX` (80) (the RPC's limits, for zod
  schemas), `REVENUE_SEGMENT_CHANGE_WARNING` (the comparability warning the owner confirms before a change: "Changing your
  revenue segments may affect reporting standards and comparability with earlier months. Months already submitted keep their
  segment names and figures; months not yet submitted switch to the new segments."), `FLAG_CODE_LABELS.segments_exceed_total`.
  `REVENUE_SUM_TOLERANCE` (0.01) now applies to company segments only.
- **(updated)** `src/lib/targets.ts` — `GENERAL_TARGET`, `fieldTarget(key)`, `segmentTarget(id)`, `kpiTarget(kpiId, memberId?)`,
  `kpiCellKey(kpiId, memberId?)`, `parseKpiCellKey(key)`, `ParsedTarget`, `parseTarget(target)` (strict; malformed → `{ kind: 'general' }`),
  `formatTarget(parsed)`.

### 5.5 Data layer (`src/lib/data/*`, server-only; each takes the RLS client as first arg)
```ts
getCompany(sb, companyId): Promise<CompanyRow | null>
getCompanyConfig(sb, companyId): Promise<CompanyConfig>   // { company, segments (active first, sorted), kpis (sorted, with dimension + active members), members (with profiles) }
getTemplateVersion(sb, versionId): Promise<TemplateVersionFull>   // version + sections (sorted) each with fields (sorted)
getCurrentTemplateVersion(sb): Promise<TemplateVersionFull | null>
getSubmission(sb, submissionId): Promise<SubmissionRow | null>
getSubmissionByMonth(sb, companyId, month): Promise<SubmissionRow | null>
getSubmissionValues(sb, submissionId): Promise<SubmissionValues>  // { values: Record<field_key, SubmissionValueRow>, segments: Record<segment_id, number|null>, kpis: Record<kpiCellKey, SubmissionKpiValueRow> }
getSubmissionBundle(sb, submissionId): Promise<SubmissionBundle | null>
  // { submission, company, config: CompanyConfig, template: TemplateVersionFull, current: SubmissionValues,
  //   previous: { submission, values: SubmissionValues } | null  (prior month), lastYear: {…} | null (same month last year),
  //   events: SubmissionEventRow[] (with actor names), financials: MonthlyFinancials (current), settings: PlatformSettingsRow }
listCompanySubmissions(sb, companyId): Promise<SubmissionOverviewRow[]>    // from v_submission_overview, newest first
getFinancialSeries(sb, companyId, fromMonth?, toMonth?): Promise<(MonthlyFinancials & { status; currency; fx_rate_to_myr })[]>
getPlatformSettings(sb): Promise<PlatformSettingsRow>
// kpiCellKey / fieldTarget / segmentTarget / kpiTarget / parseTarget live in src/lib/targets.ts
```
Row types (`CompanyRow`, `SubmissionRow`, …) are exported from `src/lib/types/domain.ts` as aliases of the generated `Database` types.

**(updated) As built** — import functions from `@/lib/data` (server-only), types and pure helpers from `@/lib/types/domain`
(client-safe). `sb: SupabaseClient<Database>` = `await createClient()` from `@/lib/supabase/server`.
```ts
getCompany(sb, companyId: string): Promise<CompanyRow | null>
getCompanyConfig(sb, companyId: string): Promise<CompanyConfig>            // throws a not-found DataError
getTemplateVersion(sb, versionId: string): Promise<TemplateVersionFull>    // throws a not-found DataError; drafts too
getCurrentTemplateVersion(sb): Promise<TemplateVersionFull | null>         // published version of the default template
getSubmission(sb, submissionId: string): Promise<SubmissionRow | null>
getSubmissionByMonth(sb, companyId: string, month: string /* 'YYYY-MM' | 'YYYY-MM-DD' */): Promise<SubmissionRow | null>
getSubmissionValues(sb, submissionId: string): Promise<SubmissionValues>
getSubmissionBundle(sb, submissionId: string): Promise<SubmissionBundle | null>
getSubmissionBundleByMonth(sb, companyId: string, month: string): Promise<SubmissionBundle | null>   // for [month] routes
listCompanySubmissions(sb, companyId: string): Promise<SubmissionOverviewRow[]>        // newest first
listSubmissionEvents(sb, submissionId: string): Promise<SubmissionEventWithActor[]>    // oldest first; (decisions 2026-10-01)
                                                    // company users: ScaleUp actors' `actor` null (RLS), `actor_name`
                                                    // "Name (ScaleUp)" (staff_display_names, BRD B28); ScaleUp viewers:
                                                    // plain names. Show `actor_name ?? SCALEUP_LABEL`
getSubmissionValidation(sb, submissionId: string): Promise<SubmissionValidation>       // RPC get_submission_validation
getFinancialSeries(sb, companyId: string, fromMonth?: string | null, toMonth?: string | null): Promise<FinancialSeriesPoint[]>
                                                    // oldest first, every status; bounds inclusive; malformed bound → RangeError
getPlatformSettings(sb): Promise<PlatformSettingsRow>   // (updated) ScaleUp only: full row; throws a not-found DataError
                                                        // when missing or hidden (company users)
getClientSettings(sb): Promise<ClientSettings>          // (updated, new) rpc get_client_settings: require_mfa, terms_version,
                                                        // declaration_text, due_day, (decisions 2026-10-01) owner_contributor_limit
                                                        // — every signed-in user; not-found DataError if missing
getStaffDisplayNames(sb, ids: Iterable<string | null | undefined>): Promise<Record<string, string>>
                                                    // (decisions 2026-10-01, BRD B28) rpc staff_display_names: lower-case id →
                                                    // "Renuka Sena (ScaleUp)" ("ScaleUp" without a name) for ScaleUp staff ids
                                                    // only; drops nulls, duplicates and non-UUIDs; one request per 500 ids, none
                                                    // for an empty list; DataError (42501) when not fully signed in
getCompanyInternal(sb, companyId: string): Promise<CompanyInternalWithPartner | null>
                                                    // (updated, new) ScaleUp only: company_internal + the partner-in-charge's
                                                    // profile; null for company users (RLS), unknown companies, non-UUIDs
setCompanyRevenueSegments(sb, companyId: string, segments: readonly CompanySegmentInput[]): Promise<RevenueSegmentRow[]>
                                                    // (B30, new) rpc set_company_revenue_segments: the COMPLETE ordered list
                                                    // [{ id?: current segment id, name }]; returns the active company segments
                                                    // in order; DataError keeps the code (42501 / P0001 → toActionError);
                                                    // non-UUID company → not-found DataError without a request
class DataError extends Error { operation: string; code: string | undefined; details; hint; notFound: boolean }
isNotFoundError(e: unknown): e is DataError     // pages: try { … } catch (e) { if (isNotFoundError(e)) notFound(); throw e }
kpiCellKey, parseKpiCellKey                     // re-exported from src/lib/targets.ts
emptySubmissionValues, flattenTemplateFields, parseFieldOptions, parseFieldValidation, toMonthlyFinancials, toValidationInput  // re-exported
```
Non-UUID ids and malformed months never reach PostgREST: nullable getters return null, lists `[]`. Query failures throw
`DataError` with the Postgres/PostgREST `code` kept (so `toActionError` maps it). Independent reads run in parallel; the
bundle takes two round trips (11 requests) — **(decisions 2026-10-01)** plus one `staff_display_names` request when the timeline
has actors whose profile the caller cannot read (company users with ScaleUp actors). **(updated)** Nothing partner-related or ScaleUp-internal is in any
company-visible result: the bundle's `company` is the plain `companies` row (no partner column any more), and ScaleUp pages
load the internal record separately with `getCompanyInternal`. **(updated, decisions 2026-10-01; BRD B24, B28)** ScaleUp staff
profiles stay hidden from company users (RLS): timeline `events[].actor` is null for ScaleUp actors and the ScaleUp staff ids that
company-visible rows carry (`submission.approved_by`, `last_saved_by`, `events[].actor_id`, values' `updated_by`, members'
`invited_by`, comments' `author_id` / `resolved_by`, documents' `uploaded_by`, closes' `confirmed_by`) resolve to no profile —
but the company side names those people **"<full name> (ScaleUp)"**: `listSubmissionEvents` / the bundle fill `actor_name` from
`getStaffDisplayNames` for every actor whose profile the caller cannot read (one extra request, company users only), and other
modules resolve the ids they show with `getStaffDisplayNames(sb, ids)`. Never look names, emails or roles up another way (no
admin client). Tests: `tests/data/*` (fake PostgREST, `npm test`).
Types (`@/lib/types/domain`): every row alias (`ProfileRow`, `FundRow`, `CompanyRow`, `FundInvestmentRow`, `CompanyMemberRow`,
`CompanyInternalRow`, `RevenueSegmentRow`, `KpiDimensionRow`, `KpiDimensionMemberRow`, `CompanyKpiRow`, `TemplateRow`,
`TemplateVersionRow`, `TemplateSectionRow`, `TemplateFieldRow`, `ReportingPeriodRow`, `SubmissionRow`, `SubmissionValueRow`,
`SubmissionSegmentValueRow`, `SubmissionKpiValueRow`, `SubmissionEventRow`, `CommentRow`, `PeriodCloseRow`, `DocumentRow`,
`FxRateRow`, `AuditLogRow`, `PlatformSettingsRow`, **(updated)** `AccessLinkRow` (service role only)), plus:
```ts
SubmissionOverviewRow / SubmissionFinancialsRow   // view rows with identity columns non-null (raw: …ViewRow)
KpiDefinition = CompanyKpiRow & { dimension: KpiDimensionRow | null; members: KpiDimensionMemberRow[] /* ACTIVE, sorted */ }
KpiDimensionWithMembers = KpiDimensionRow & { members: KpiDimensionMemberRow[] /* all, active first */ }
MemberProfile = Pick<ProfileRow, 'id' | 'email' | 'full_name' | 'job_title' | 'is_active' | 'terms_accepted_at'>
MemberWithProfile = CompanyMemberRow & { profile: MemberProfile | null }
CompanyConfig = { company; segments: RevenueSegmentRow[] /* all, active first */; kpis: KpiDefinition[] /* all, active first —
                  filter is_active for input */; dimensions: KpiDimensionWithMembers[]; members: MemberWithProfile[];
                  // (B30) segments = BOTH kinds (RevenueSegmentRow now has kind: string ('company' | 'scaleup') and
                  // retired_at: string | null), plus:
                  companySegments: RevenueSegmentRow[]          /* the company's own, ACTIVE, by sort_order, name */;
                  scaleupSegments: RevenueSegmentRow[]          /* ScaleUp's revenue lines, ACTIVE, in order */;
                  retiredCompanySegments: RevenueSegmentRow[]   /* own segments retired, most recently retired first */ }
TemplateSectionFull = TemplateSectionRow & { fields: TemplateFieldRow[] }
TemplateVersionFull = TemplateVersionRow & { template: TemplateRow; sections: TemplateSectionFull[] }   // sort_order, then key
TemplateFieldWithSection = TemplateFieldRow & { section_key; section_kind; section_title }
FieldValidation = { allow_negative?; min?; max?; max_length? }   FieldOptions = { choices: string[]; rating: { min; max; labels } | null }
SubmissionValues = { values: Record<string, SubmissionValueRow>; segments: Record<string, number | null>; kpis: Record<string, SubmissionKpiValueRow> }
SubmissionValuesInput = the same shape with only the columns validation reads (live form state)
SubmissionSnapshot = { submission; values: SubmissionValues; financials: MonthlyFinancials }
EventActor = Pick<ProfileRow, 'id' | 'full_name' | 'email' | 'scaleup_role'>   // (updated) never a ScaleUp profile for company users
SubmissionEventWithActor = SubmissionEventRow & { actor: EventActor | null; actor_name: string | null }
                     // (decisions 2026-10-01) actor_name: readable profile → full name (else email); company users seeing
                     // ScaleUp staff → "Name (ScaleUp)"; null = system / cannot be named → show SCALEUP_LABEL
SubmissionBundle = { submission; company; config: CompanyConfig; template: TemplateVersionFull /* the submission's own version */;
                     current: SubmissionValues; previous: SubmissionSnapshot | null; lastYear: SubmissionSnapshot | null;
                     events: SubmissionEventWithActor[] /* oldest first */; financials: MonthlyFinancials;
                     clientSettings: ClientSettings /* (updated) always: declaration_text, due_day, … */;
                     settings: PlatformSettingsRow | null /* (updated) full row for ScaleUp staff; null for company users */ }
ClientSettings = { require_mfa: boolean; terms_version: string; declaration_text: string; due_day: number;
                   owner_contributor_limit: number /* (decisions 2026-10-01, BRD B29) */ }   // (updated, new)
PartnerProfile = Pick<ProfileRow, 'id' | 'full_name' | 'email' | 'scaleup_role' | 'is_active'>                   // (updated, new)
CompanyInternalWithPartner = CompanyInternalRow & { partner: PartnerProfile | null }                            // (updated, new)
SubmissionValidation = { ok: boolean; errors: ValidationIssue[] }
FinancialSeriesPoint = MonthlyFinancials & { submission_id; status; currency: string; fx_rate_to_myr: number | null }
FinancialColumns, Json
```
Helpers: `toValidationInput(bundle, values?: SubmissionValuesInput): ValidationInput`;
`toMonthlyFinancials(month, values)` / `(snapshot)` / `(v_submission_financials row)`; `flattenTemplateFields(template)`;
`parseFieldValidation(json)`; `parseFieldOptions(field)` (rating defaults 1–5); `emptySubmissionValues()`. The bundle is plain
JSON (safe to pass to Client Components). `MonthlyFinancials.month` stays 'YYYY-MM-DD'.
**(B30; client-safe pure helpers in `@/lib/types/domain`, also re-exported by `@/lib/data`)**
```ts
type RevenueSegmentKind = 'company' | 'scaleup'                           // from src/lib/constants.ts
segmentKind(row): RevenueSegmentKind            // 'company' or (anything else) 'scaleup'
isCompanySegment(row): boolean
partitionRevenueSegments(segments): Pick<CompanyConfig, 'companySegments' | 'scaleupSegments' | 'retiredCompanySegments'>
                                                // what getCompanyConfig adds; test fixtures building a CompanyConfig use it:
                                                // { ...config, segments, ...partitionRevenueSegments(segments) }
type MonthSegments = { company: RevenueSegmentRow[]; scaleup: RevenueSegmentRow[] }
segmentsForMonth(config: Pick<CompanyConfig, 'segments'>, values: { segments: Record<id, number | null> }, editable: boolean): MonthSegments
                                                // the segments a month shows, each kind by sort_order, then name:
                                                // editable (status draft / changes_requested, whoever is looking) → the
                                                // ACTIVE ones; read-only (submitted / approved) → exactly those with an
                                                // amount, retired ones included (the names it was submitted with)
sumSegmentAmounts(segments, amounts): number | null   // amounts present added up (each segment once, exact to 4 dp);
                                                // null when none: the calculated total revenue
                                                // (segmentsForMonth(...).company) or computeFlags' scaleupLinesTotal
type CompanySegmentInput = { id?: string | null; name: string }
normaliseSegmentName(name): string              // trims spaces, tabs, line breaks at both ends (as the RPC stores it)
companySegmentListError(list): string | null    // the RPC's own P0001 for list problems (≤ 50, blank, > 80 characters,
                                                // line breaks / tabs, duplicate names ignoring case, an id listed twice),
                                                // word for word — validate the form before saving (DB-compared in
                                                // tests/db/revenue-segments-b30.test.ts)
type CompanySegmentChanges = { added: string[]; removed: RevenueSegmentRow[]; renamed: { segment; name }[];
                               reordered: boolean; affectsComparability: boolean; changed: boolean }
diffCompanySegments(config.companySegments, list): CompanySegmentChanges
                                                // what saving would change, matched like the RPC (ids; an item without id
                                                // named like an unlisted current segment is that segment). Show
                                                // REVENUE_SEGMENT_CHANGE_WARNING (and get a confirmation) when
                                                // affectsComparability (added / removed / renamed); a pure reorder needs none
```
`toValidationInput` passes each segment's `kind` (§5.4). M5's form computes total revenue from the company segments
(`sumSegmentAmounts`) when there are any; the database validates it (`sum_mismatch`) but does not compute it.
**(decisions 2026-10-01, BRD B29; client-safe, UX only — the database enforces the limit)**
`contributorSlotsLeft(activeContributors, limit): number` (places an owner has left, never below 0; `limit` =
`ClientSettings.owner_contributor_limit`, `activeContributors` = the company's active contributor memberships, pending
invitations included) and `contributorLimitMessage(activeContributors): string` (the database's refusal word for word, e.g. to
show before trying; `tests/db/decisions-2026-10-01.test.ts` compares them).

### 5.6 Shared UI (`src/components/app/*`)
`PageHeader({ title, description?, actions?, breadcrumbs? })`, `StatusBadge({ status })` (submission status; overdue variant),
`Money({ value, currency? })`, `EmptyState({ icon?, title, description?, action? })`, `ConfirmDialog` (controlled, with optional reason textarea),
`SubmitButton` (pending state via `useFormStatus`), `FormError({ message })`, `DataTable`-style helpers are NOT provided — use shadcn `Table` directly.
`src/components/shell/*`: `AdminSidebar`, `PortalSidebar`, `CompanySwitcher`, `UserMenu`, `IdleTimer`, `Logo`.
**(updated) As built:**
- `PageHeader({ title: ReactNode, description?, actions?, breadcrumbs?: BreadcrumbEntry[] /* { label, href? } */, className? })` — renders the page `<h1>`. Pages render inside the shell's padded container (`p-4 md:p-6 lg:p-8`): add no outer padding.
- `StatusBadge({ status, overdue?, className? })` (pass `v_submission_overview.is_overdue` for the red "Overdue" variant); `ToneBadge({ tone, children, title?, className? })`; tone class maps `TONE_BADGE_CLASSES`, `TONE_DOT_CLASSES`, `TONE_TEXT_CLASSES` in `@/components/app/tone`.
- `Money({ value, currency?, compact?, decimals?, className? })` (negatives in red; add `text-right` on the cell).
- `EmptyState({ icon?: element | component, title, description?, action?, className? })`.
- `ConfirmDialog({ open, onOpenChange, title, description?, confirmLabel?, cancelLabel?, destructive?, requireReason?, reasonLabel?, reasonPlaceholder?, onConfirm: (reason?) => Promise<void> | void })` — while pending it cannot be dismissed; throw an `Error` to keep it open and show the message; the reason is trimmed and required with `requireReason`.
- `SubmitButton({ pendingText?, ...ButtonProps })` for `<form action>`; `FormError({ message?, id?, className? })` (use `id` with `aria-describedby`).
- Shell: `AdminSidebar({ userId, role })`, `PortalSidebar({ companyId, companyName, companyRole, companies })` **(updated: no `partner` prop — the partner-in-charge is never shown on the company side)**,
  `CompanySwitcher({ companies, currentId })`, `UserMenu({ name, email, roleLabel })`, `AppHeader({ user, children? })`,
  `AuthShell`, `SignOutButton` (POST `/auth/signout`), `IdleTimer` (already mounted in the admin and portal layouts and the
  auth-flow pages — never mount it again), `Logo({ className?, priority? })`, `isNavActive`, `ACTIVE_NAV_CLASSES`.
  The `/portal/[companyId]` layout already loads the company name and status for the sidebar and header.

### 5.7 Cross-module component contracts (stubs exist; the owning module implements them)
- M6 `src/components/comments/comment-threads.tsx`:
  ```ts
  export type CommentMode = 'scaleup' | 'company'
  export function CommentThreadsPanel(props: { submissionId: string; mode: CommentMode; canStartThreads: boolean; target?: string /* filter */; className?: string }): JSX.Element
  export function FieldCommentButton(props: { submissionId: string; target: string; mode: CommentMode; canStartThreads: boolean; count?: number; unresolved?: number }): JSX.Element
  ```
  `src/lib/actions/comments.ts` (M6) — `listComments(submissionId)`, `addComment({ submissionId, target, body, visibility, parentId? })`, `setCommentResolved(commentId, resolved)`.
- M5 `src/components/submission-form/submission-form.tsx`:
  ```ts
  export function SubmissionForm(props: { bundle: SubmissionBundle; mode: 'company' | 'on_behalf' | 'readonly'; canSubmit: boolean; commentMode: CommentMode | null; commentCounts?: Record<string, { total: number; unresolved: number }> }): JSX.Element
  ```
**(updated)** Both stubs exist (marked `STUB - implemented by module M6/M5`), are Client Components (`"use client"`) with
placeholder rendering, and also export their prop types: `CommentThreadsPanelProps`, `FieldCommentButtonProps`,
`SubmissionFormProps`, `SubmissionFormMode` (`JSX` is `import type { JSX } from "react"`). `SubmissionBundle` comes from
`@/lib/types/domain`. `commentCounts` is keyed by target (§2.5). The owning module replaces the bodies and keeps the
names and props; it may add optional props.
**(updated, integration) As built** — both are implemented (the `STUB` markers are gone); the original props are
unchanged and these optional props were added:
- `CommentThreadsPanel`: `targetLabels?: Record<string, string>` (e.g. `buildTargetLabels(bundle)`), `targetOptions?:
  TargetOption[]` (the new-thread "About" choices, grouped in order of appearance; "General" always first — the review page
  passes the rows it shows), `threads?: CommentThread[]` (loaded by the page; omitted → the panel loads them), `title?:
  string | null` (null hides the heading). `FieldCommentButton`: `targetLabel?`, `threads?`, `className?`. Company users get
  a field button only where a thread exists (they reply, never start threads).
- `SubmissionForm`: `canStartThreads?: boolean` (ScaleUp staff with `canComment(ctx)`; default false) and `earlierDrafts?:
  string[]` (`YYYY-MM` drafts before this month: "Submit … first").
- `src/lib/actions/comments.ts` also exports `getCommentCounts(submissionId)`; `addComment({ submissionId, target?, body,
  visibility?, parentId? })`. Comment and review actions revalidate the review, tracker, company, on-behalf, portal home,
  updates, month and history paths.

### 5.8 Shared APIs added by the feature modules **(updated, integration)**
Import these instead of re-implementing them (client-safe unless marked server-only).
- **Comments (M6):** `@/components/comments/target-labels` — `buildTargetLabels(bundle)` (`field:<key>` → template label;
  company segments `"Revenue: <name>"`, ScaleUp lines `"ScaleUp revenue line: <name>"`, retired ones included; KPI cells),
  `targetLabelFor`, `segmentTargetLabel`, `targetOptionsFrom`, `groupTargetOptions`, `TargetOption`.
  `@/components/comments/load-threads` (server-only) — `loadCommentThreads(sb, { submissionId, companyId, viewer })`,
  `loadCommentCounts(sb, submissionId)`, `fetchCommentRows`, `memberRolesFrom`; company viewers get ScaleUp authors as
  "<name> (ScaleUp)" (B28).
- **Monthly form (M5):** `src/lib/actions/submission.ts` — `saveSubmissionValues({ submissionId, values?, segments?, kpis? })
  → { savedAt }` (revalidates on every save), `getSubmissionValidationAction(id)` (`{ ok, errors, priorMonths, values,
  lastSavedAt, status }`), `submitSubmission(id, declarationAccepted)`, `requestAmendment(id, reason)`.
  `@/components/submission-form/presentation` — `isEditableStatus`, `actionLabel` ("Start" / "Continue" / "Make changes"),
  `nextActionMonth`, `actorLabel` (`actor_name ?? SCALEUP_LABEL`), `targetDomId`. `@/components/submission-form/draft` —
  `reconcileRevenueTotal`, `reconcileWithCompanySegments(draft, config)`, `withSegmentAmount` (company segments, keeps
  `revenue_total` = their sum), `withSegmentValue` (ScaleUp lines; never touches the total). `src/components/submission-form/queries.ts`
  (server-only) — `loadCommentCounts`, `listEarlierDrafts`.
- **Documents and period close (M8):** `PeriodClosePanel({ company, mode: 'company' | 'scaleup', ctx, focusCloseId?,
  focusPeriodLabel? })` (`@/components/documents/period-close-panel`, async Server Component: rights, upload, confirm,
  reopen, document pack link); `@/components/documents/totals` — `parsePeriodTotals`, `parseRestatedTotals`,
  `effectiveTotals` (restated margins are derived from the restated revenue / profit); `src/lib/actions/documents.ts` —
  `prepareDocumentUpload`, `saveDocument`, `confirmPeriodClose`, `reopenPeriodClose`. Storage signing uses the caller's own
  client (never the service role).
- **Exports and audit (M9):** `@/lib/exports/segments` — `isOpenForChanges`, `shownSegmentAmounts`, `shownRevenueTotal` (an
  open month's total revenue = the sum of the company's own segments once one has an amount; the form, the review page and
  the exports agree); `@/lib/exports/document-pack-limits` — `DOCUMENT_PACK_MAX_BYTES` (100 MB),
  `documentPackTooLargeMessage` (no zip library: client-safe); `@/lib/exports/http` — `isPageNavigation`, JSON-or-HTML error
  responses; `@/lib/exports/audit` — `AUDIT_ACTION_META`, `AUDIT_ENTITY_LABELS`, limits; `@/lib/exports/audit-params` —
  `parseAuditFilters` (the /admin/audit deep links).
- **Users and access links (M2, server-only `@/lib/auth-admin`, service role after the caller's own checks):**
  `createAccessLink({ userId, purpose, createdBy }) → { id, userId, purpose, url, expiresAt }`, `revokeAccessLink`,
  `revokeUserAccessLinks(userId, { purpose?, createdBy? })`, `getAccessLink`, `listPendingAccessLinks({ userIds? })`,
  `previewAccessLink(token)`, `claimAccessLink(token)`, `signInWithEmailLink(email)`, `ensureAuthUser({ email, fullName })`,
  `getAuthUser`, `setUserBanned(id, banned)`, `resetUserMfa`, `listAuthUsers`, `getSiteUrl`, `isOwnerLinkRefusal`;
  `@/lib/auth-admin/audit` — `logAccessEvent`, `issueLinkWithAudit` (logs `invite` / `sign_in_link`; revokes the link again
  if the audit entry fails). Client-safe: `purpose.ts`, `status.ts`, `schemas.ts`, `types.ts`. auth-js admin methods throw for
  non-UUID ids: validate first. App audit events use entity `profiles` with the account id.
- **Shared reads:** `@/lib/fetch-all` — `fetchAllRows(fetchPage, { pageSize?, maxPages? })`: every row of a PostgREST query
  (exact count on the first page, so a `max_rows` cap never truncates silently); used by the tracker and /admin/cycles.
- **Company pages (M1):** `companyTabHref(companyId, tab)` (`src/app/admin/companies/[companyId]/_components/tabs.ts`);
  `SectionErrorBoundary` (`src/app/admin/companies/_components/section-error-boundary.tsx`, Next `catchError`, "Try again").

---

## 6. UX notes per module (acceptance criteria)
- **Tracker (A6)**: grid company × last 12 open months; cell = status chip (Draft/missing grey, **overdue red**, Submitted blue, Changes requested amber, Approved green) + narrative dot (filled/skipped); "Escalated" when overdue > `escalation_days`; filters: fund, partner, status; counts per status for the latest month; cell click → review (ScaleUp). Calls `open_due_periods()` on load.
  **(updated)** Read `v_submission_overview` directly (portfolio-wide; there is no bulk data-layer function): `is_overdue`, `days_overdue` (Escalated when `days_overdue > settings.escalation_days`, `ESCALATED_META`), `has_narrative`, `open_threads`. Labels/tones from `SUBMISSION_STATUS_META`, `OVERDUE_META`, `MISSING_META`. Companies without a reporting start month show `NOT_YET_REPORTING_META` (no cells). The partner filter reads `company_internal.partner_in_charge_id` (ScaleUp-only) with the profiles of partners; `escalation_days` comes from `getPlatformSettings` (ScaleUp).
- **(updated) Companies (A1, M1)**: list and detail show the reporting start month or `NOT_YET_REPORTING_META`; saving a start month (or clearing it) is a plain `companies` update by a Super Admin — then call `rpc('open_due_periods')` so the missing months open at once. Internal fields and the partner-in-charge: `getCompanyInternal`, update `company_internal` (never insert); the partner picker only for `canAssignPartner(ctx)`. Status changes with `set_company_status`.
- **Company home (C2)**: current month card with due date + status; red list of months with missing numbers; outstanding change requests / unresolved threads; last submitted figures (revenue, GP%, NP%, cash, runway).
  **(updated)** `listCompanySubmissions` + `getFinancialSeries` (filter status submitted/approved for "last submitted figures"); `open_due_periods()` returns 0 to company users (it still opens months).
- **Monthly form (C3/C6)**: numbers first (revenue by segment with live total, GP, NP, cash, burn; live GP% / NP% / runway), headcount, KPI grid (KPI × dimension member), then optional narrative accordions per C4 category with **last month's entry shown alongside**, founder pulse. **Autosave** (debounced ~1.2 s, "Saved 14:05" indicator). Client-side validation; server validation before submit; owner declaration checkbox; submit blocked while earlier months are unsubmitted (show which). Read-only once submitted/approved; "Request amendment" on approved months (owner).
  **(updated)** Load with `getSubmissionBundleByMonth(sb, companyId, params.month)` (null → `notFound()`); live checks `validateSubmissionDraft(toValidationInput(bundle, liveValues))`; KPI grid `kpiCellsForMonth(toValidationInput(bundle))`; last month's narrative `bundle.previous?.values.values[key]`; inputs `formatNumberInput` / `parseNumberInput`; save with `save_submission_values` (§2.4 input rules), then `get_submission_validation` before `submit_submission`. The declaration text is `bundle.clientSettings.declaration_text` (`bundle.settings` is null for company users). Exited/written-off companies render read-only.
- **Review (A7)**: columns *This month · Prior month · Same month last year · Δ*; auto-flags; field-level comment buttons (internal/shared toggle); timeline; actions Request changes (message) / Approve (partner-in-charge or super admin) / Reopen (reason) / Extend deadline; "Edit on behalf" link for fund admins.
  **(updated)** Flags: `computeFlags({ current: bundle.financials, previous: bundle.previous?.financials ?? null, sameMonthLastYear: bundle.lastYear?.financials ?? null, settings: bundle.settings ?? undefined, validationErrors: (await getSubmissionValidation(sb, id)).errors, currency: bundle.company.reporting_currency })` (ScaleUp staff always get `bundle.settings`); Δ with `growthPct` + `formatPct(x, 1, { signed: true })`; timeline `bundle.events` with `SUBMISSION_EVENT_LABELS` and `actor_name ?? SCALEUP_LABEL` **(updated, decisions 2026-10-01, BRD B28: on the company side `actor_name` of a ScaleUp actor is "Name (ScaleUp)" — the data layer fills it; ScaleUp comment authors and resolvers (M6) are resolved the same way with `getStaffDisplayNames(sb, ids)`; never look names, emails or roles up another way)**; buttons: load `const internal = await getCompanyInternal(sb, bundle.company.id)` and use `canApprove(ctx, internal)`, `canReopen(ctx, internal, bundle.company.status)`, `canRequestChanges(ctx, bundle.company.status)`, `canExtendDueDate(ctx, bundle.company.status)`, `canComment(ctx)`, `canEnterData(ctx, id, company.status)` (exited / written-off companies: approve yes; request changes, reopen and extend no).
- **Period close (C4)**: list of quarter/half closes; per close: computed totals from months, upload management accounts (PDF/Excel, version history), optional restatement with reason, confirm (owner).
  **(updated)** Live totals with `periodTotals` over the submitted/approved months from `greatest(period_start, reporting_start_month)` — without a start month, from the company's first month with a submission in the period (same result as the stored `computed_totals`); upload flow in §2.8; confirmation needs every month submitted/approved and an uploaded management-accounts file; a month sent back reopens a confirmed close. **(updated, second patch)** Show the admins' "Reopen" action with `canReopenPeriodClose(ctx, company.status)`: confirmed closes of exited / written-off companies stay confirmed.
- **(decisions 2026-10-01) ScaleUp people on the company side (BRD B28)** — comments (M6: authors, resolvers), timelines and approvals (M5, M6, M7: `bundle.events` already carry the names), documents and period closes (M8: `uploaded_by`, `confirmed_by`), the team page (M2: `invited_by`, who sent a link), the company home (M7: comment authors) and company-side exports (M9): show **"<full name> (ScaleUp)"** from `getStaffDisplayNames(sb, ids)` (one call per page with every id the page shows that `profiles` did not resolve), falling back to `SCALEUP_LABEL` for system actions. Never an email, a role or the partner-in-charge on the company side; ScaleUp pages keep plain names and roles from `profiles`.
- **(decisions 2026-10-01) Team (C1, M2; BRD B29)**: owners see "N of L contributors" (`L = clientSettings.owner_contributor_limit`, `contributorSlotsLeft(N, L)` places left; N = active contributor memberships, pending invitations included). With no place left, disable "Invite" / "Reactivate" and explain with `contributorLimitMessage(N)` — check BEFORE creating the Auth account, so a refused invitation leaves no orphan account; the database's P0001 refusal still reaches the form through `toActionError`. Deactivating frees a place. Super Admins (`/admin/users`, `/admin/companies/[id]`) are not limited.
- **(decisions 2026-10-01) Settings (A5, M4)**: a Super Admin field for `owner_contributor_limit` — "Contributors per company (owner invitations)", whole number 0–`OWNER_CONTRIBUTOR_LIMIT_MAX` (100), default `DEFAULT_OWNER_CONTRIBUTOR_LIMIT` (4), help text "The most active contributors a company owner can have, pending invitations included. ScaleUp can always add more." (a plain `platform_settings` update; 23514 outside 0–100).
- **(B30) Company revenue segments page `/portal/[companyId]/segments` (C3; owners)**: list the company's own segments
  (`config.companySegments`) with add, rename, remove and reorder, and the history (`config.retiredCompanySegments`: name and
  `retired_at`, "no longer used"). Validate with `companySegmentListError` (zod limits `REVENUE_SEGMENTS_MAX`,
  `REVENUE_SEGMENT_NAME_MAX`); before saving, `diffCompanySegments(config.companySegments, list)` — when
  `affectsComparability`, show `REVENUE_SEGMENT_CHANGE_WARNING` in a `ConfirmDialog` with what changes (added / removed /
  renamed) and save only once confirmed (a pure reorder can save directly). Save with `setCompanyRevenueSegments` in a Server
  Action (`assertCompanyAccess(companyId, ['owner'])`; ScaleUp's on-behalf variant uses `assertScaleUp(['super_admin',
  'fund_admin'])`), `revalidatePath` the page, the company's update routes and home. Mention that ScaleUp's revenue lines
  (`config.scaleupSegments`, read-only here) are separate and need not add up. Contributors and owners of exited / written-off
  companies see the page read-only. Stale ids → the RPC's "have changed … Reload the page" message.
- **(B30) Monthly form (M5)**: two blocks. **Revenue segments** (`segmentsForMonth(config, values, editable).company`): when
  there are any, total revenue is **calculated** (read-only input = `sumSegmentAmounts(those, draft.segments)`), and every
  save that changes a company segment amount also sends `revenue_total` (and a stale stored total — e.g. after the owner
  removed a segment — is recalculated and saved); without company segments total revenue is entered directly. **ScaleUp
  revenue lines** (`segmentsForMonth(...).scaleup`, label `REVENUE_SEGMENT_KIND_META.scaleup`): required amounts that need
  not add up — never part of the total. `editable` = status draft / changes_requested (the same for the read-only view of an
  open month); read-only months show exactly the segments they have figures for (retired names included). Labels for
  comment targets / issue lists keep covering every segment in `config.segments` (retired ones included).
- **(B30) Review (M6) and exports (M9)**: comparison rows per kind — the month's company segments then total revenue, and
  the ScaleUp lines as a separate group (no total) — from `segmentsForMonth(bundle.config, values, isOpen)` of each month
  shown; pass `scaleupLinesTotal: sumSegmentAmounts(segmentsForMonth(...).scaleup, bundle.current.segments)` to
  `computeFlags`. The C4 workbook's "Revenue Lines" sheet lists the company's own segments (as revenue by segment) and the
  ScaleUp revenue lines (labelled as such), each from the months' figures (retired ones only where they have figures).
- **(B30) Admin company page (M1)**: the revenue lines tab manages **ScaleUp revenue lines only** — filter
  `kind = 'scaleup'` when loading (`config.scaleupSegments` or `.eq('kind', 'scaleup')`), insert with `kind: 'scaleup'`;
  unique names are now case-insensitive among active lines (23505 on `revenue_segments_active_name_key`, also when
  reactivating a line whose name is taken). Show the company's own segments read-only (or edit them on the owner's behalf
  through `setCompanyRevenueSegments`, with the same warning).
- **C4 export (A13)**: workbook with sheets `C4` (rows = narrative sections, columns = half-years + "Input Here", a "Last Updated" row), `Revenue Lines` (segments, total revenue, GP, GP%, NP, NP%, cash, monthly burn, YoY — monthly columns + half totals), `KPIs` (KPI × member rows, monthly columns), `Monthly Grid` (one row per month, all numbers). Only **approved** months feed LP-facing figures; others are marked.
  **(updated)** Map narrative rows by section title with `flattenTemplateFields`; RM = amount × `fx_rate_to_myr` (null = unknown rate); log each export and download with `log_audit_event` (`export` / `download`).
  **(updated, integration)** The Revenue Lines sheet has a "Company revenue segments (add up to total revenue)" block,
  then total revenue, then "ScaleUp revenue lines (need not add up to total revenue)"; retired segments only where an
  included month has a figure. The portfolio Excel extract adds a long-format "Revenue segments" sheet (the CSV is
  unchanged). With `include=all` / `status=all`, months still open for changes show total revenue as the sum of the
  company's own segments (`shownRevenueTotal`). Owners get approved months only from the history page's link.

**(updated, integration) Rules settled while wiring the modules together (1 Oct 2026):**
- **Months still requested** (BRD B5, B16) — one rule for the company home, the monthly updates list and the tracker:
  months sent back (changes requested) always; drafts from the company's reporting start month on; without a start
  month, only the drafts before a month sent back (`monthsNeedingAction` in
  `src/app/portal/[companyId]/_components/home-model.ts`). Drafts left from before a start month that ScaleUp moved later
  are never overdue, never the home's or the updates list's "next month", and are marked **"Not required"** on
  `/portal/<id>/updates` (they stay openable). The tracker's summary cards, attention counts and status filters count
  only awaited months (`isAwaited` in `src/app/admin/tracker/_lib/tracker-model.ts`: drafts of active companies from
  their start month on, months sent back while the company is active, every submitted or approved month — B21); other
  months are dimmed with the reason in the tooltip.
- **Company home (M7):** ScaleUp people who sent a month back are named "<name> (ScaleUp)" (`getStaffDisplayNames`, one
  call, falling back to `SCALEUP_LABEL`); comments appear as counts only ("Open comment threads", which also counts the
  owner's own amendment requests); the next month's due date is omitted once it would depend on `backfill_grace_days`
  (company users cannot read it); with exactly one open quarter / half close, "Go to documents" opens it
  (`/portal/<id>/documents?close=<closeId>`).
- **Total revenue of a month still open for changes (B30):** the monthly form while editing (live), the read-only form of
  an open month (ScaleUp viewers, exited companies), the review page's comparison and flags (`shownFinancials` in
  `src/components/review/comparison.ts`) and the exports all show the sum of the company's own segments once one has an
  amount — the stored total can be out of date after the owner changed the segments, until the month is next saved. While
  none has an amount the stored total stays ("Entered earlier as …" in the form). Submitted and approved months always show
  their stored total.
- **Revenue segments page (SEG):** `saveRevenueSegmentsAction({ companyId, expected: { id, name }[], segments: { id?, name
  }[] }) → { segments: { id, name }[] }` (`src/app/portal/[companyId]/segments/actions.ts`): owner of an active company
  (`canManageCompanySegments`), the database's own list checks (`companySegmentListError`), and `expected` (the segments the
  editor was opened with, in order) must still match the segments in use, else "The revenue segments have changed since
  this page was opened. Reload the page and try again." (checked just before the RPC, outside its lock). No
  comparability warning for a pure reorder or the very first set-up; otherwise `REVENUE_SEGMENT_CHANGE_WARNING` with the
  months concerned. Revalidates the segments page, the updates list and month pages, the portal home and the admin company
  page.
- **ScaleUp revenue lines (M1, B30):** every revenue-line action on `/admin/companies/[companyId]` filters `kind =
  'scaleup'` (load, rename, move, activate, delete) and inserts with `kind: 'scaleup'`, so the company's own segments are
  never renumbered or touched there; reactivating a line whose name another active line uses (case-insensitive, 23505
  `revenue_segments_active_name_key`) says "Another active revenue line already has this name. Rename one of them first,
  then try again."
- **Extending a deadline** (M4 `/admin/cycles`, M6 review page; same rules and messages): the new due date must be after
  the current one (`extend_due_date`), **not in the past** ("The new due date cannot be in the past. Choose today (1 Oct
  2026) or a later date.": an overdue month moved to a past date would stay overdue) and at most **365 days** after the
  later of the current due date and today ("Choose a date up to …", a typo guard). Quick choices count from the current
  due date, or from today once it has passed. The database still only enforces "after the current due date".
- **Document pack (M8, M9):** a close whose files (every version) add up to more than `DOCUMENT_PACK_MAX_BYTES` (100 MB)
  shows "Too large to download as one pack (… MB): download the files one at a time" instead of "Download all".
- **Downloads by plain link** (history → C4 workbook, close → document pack, document → download): when the session has
  ended the proxy sends the browser to `/login?next=<the page the link was on>`; an export that fails answers with a small
  HTML page with "Go back" (M9 `exportErrorResponse`); `fetch()` buttons on `/admin/exports` keep getting JSON.
- **Error boundaries:** every ScaleUp page and every company page without a boundary of its own falls back to
  `src/app/admin/error.tsx` / `src/app/portal/[companyId]/error.tsx` ("Try again", inside the layout so the sidebar stays).

---

## 7. Change log **(updated, new)**
- **2026-10-01 — B30: two revenue breakdowns (segments core step, before the B30 UI step).** BRD §6.1 and §13 B30 (product
  owner, 1 Oct 2026). New migration `supabase/migrations/20261001000200_revenue_segments_b30.sql` — **to push** (`npm run
  db:push` by the lead; dry run PASS on the hosted PostgreSQL 17.6 with `npm run db:verify`: 10 deployed, 1 pending, 23
  checks incl. a new B30 check, rolled back). `20261001000100_decisions_b28_b29.sql` is now pinned as deployed.
  1. **Schema:** `revenue_segments.kind` (`company` | `scaleup`, default `scaleup`; every existing row is a ScaleUp line; never
     changes) and `retired_at` (trigger `private.revenue_segments_guard()`, check `revenue_segments_retired_at_check`); the
     unique `(company_id, name)` constraint is replaced by the partial unique index `revenue_segments_active_name_key on
     (company_id, kind, lower(name)) where is_active`; index `revenue_segments_company_idx`.
  2. **RLS:** direct INSERT / UPDATE / DELETE by Super Admins and Fund Admins for `kind = 'scaleup'` rows only; company rows
     change only through the RPC.
  3. **`set_company_revenue_segments(p_company_id, p_segments)`** (new, §2.4): owner of an active company, or ScaleUp admins
     on behalf; rename in place vs. new series, open months follow, submitted / approved months never change.
  4. **`save_submission_values`:** amounts only for active segments (friendly P0001 for retired ones; clearing allowed); a
     save also clears the month's figures for retired company segments. **`validate_submission`:** company segments carry the
     sum rule ("… your revenue segments …"), ScaleUp lines are only required; order company → sum → ScaleUp lines (§2.6;
     mirror `src/lib/validation.ts`, `ValidationInput.segments[].kind`).
  5. **Libraries:** `CompanyConfig.companySegments` / `scaleupSegments` / `retiredCompanySegments`; `segmentsForMonth`,
     `sumSegmentAmounts`, `partitionRevenueSegments`, `segmentKind`, `isCompanySegment`, `normaliseSegmentName`,
     `companySegmentListError`, `diffCompanySegments` (`@/lib/types/domain`); `setCompanyRevenueSegments` (`@/lib/data`);
     `computeFlags({ scaleupLinesTotal })` → `segments_exceed_total` warning; constants `REVENUE_SEGMENT_KINDS`,
     `REVENUE_SEGMENT_KIND_META`, `REVENUE_SEGMENTS_MAX`, `REVENUE_SEGMENT_NAME_MAX`, `REVENUE_SEGMENT_CHANGE_WARNING`.
  6. **Tests:** `tests/db/revenue-segments-b30.test.ts` (18); updated `validation`, `mirror-parity` (both kinds),
     `permissions-parity` (RPC + no direct company writes), `migrations` (B28/B29 file pinned), `types` / `conformance`
     typechecks; `tests/unit/{validation,metrics,constants}`; `tests/data` (fixtures with `kind` / `retired_at`, config split,
     `setCompanyRevenueSegments`, the pure helpers). `scripts/db-verify.ts`: B30 check on Postgres 17.
  7. **For feature modules:** §6 "(B30)". Test fixtures that build a `RevenueSegmentRow` need `kind` and `retired_at`, and a
     `CompanyConfig` the three new lists (`...partitionRevenueSegments(segments)`).
- **2026-10-01 — product-owner decisions B28, B29 (decisions step before the feature modules).** BRD §13 B24, B28, B29 updated
  by the product owner the same day. New migration `supabase/migrations/20261001000100_decisions_b28_b29.sql` — **to push**
  (`npm run db:push` by the lead; dry-run PASS on the hosted PostgreSQL 17.6 with `npm run db:verify`, 22 checks, rolled back).
  1. **B28 — ScaleUp people named on the company side:** `public.staff_display_names(p_ids uuid[]) returns table (id uuid,
     display_name text)` (security definer, stable; signed-in, active + MFA + current terms; ≤ 500 ids; EXECUTE granted to
     authenticated, never anon or PUBLIC; service-role calls are refused for lack of a user) returns
     "<full name> (ScaleUp)" (or "ScaleUp") for ScaleUp staff ids and nothing else. Profiles, emails, roles and
     `company_internal` stay hidden from company users (unchanged RLS). Data layer: `getStaffDisplayNames(sb, ids)`;
     `listSubmissionEvents` / `getSubmissionBundle` fill `actor_name` for actors whose profile the caller cannot read (company
     users: "Name (ScaleUp)"; ScaleUp viewers unchanged). `SCALEUP_LABEL`, `SCALEUP_STAFF_SUFFIX` in `src/lib/constants.ts`.
  2. **B29 — owners' contributor limit:** `platform_settings.owner_contributor_limit smallint not null default 4` (0–100, Super
     Admin setting); `get_client_settings()` returns it (dropped and recreated: the return shape changed; same privileges);
     trigger `company_members_contributor_limit` refuses (P0001) an owner's insert / reactivation / move that would exceed it
     (ScaleUp staff and system callers exempt; non-owners left to RLS). `ClientSettings.owner_contributor_limit`;
     `contributorSlotsLeft`, `contributorLimitMessage` (`@/lib/types/domain`); `DEFAULT_OWNER_CONTRIBUTOR_LIMIT`,
     `OWNER_CONTRIBUTOR_LIMIT_MAX` (`src/lib/constants.ts`).
  3. **`db:verify` on a deployed database:** replays only the migrations not yet recorded in
     `supabase_migrations.schema_migrations` (+ the seed) in one always-rolled-back transaction (TLS verification and
     secret-free output unchanged); FAIL for recorded versions missing locally or out-of-order pending files; best-effort check
     that the deployed files still match the recorded statements (9 of 9) and the seed hash; data-dependent checks WARN on a
     deployed database; new B28 / B29 checks on Postgres 17. `tests/db/migrations.test.ts` pins the sha256 of the nine deployed
     `20260930…` files and accepts later timestamps.
  4. **Tests:** `tests/db/decisions-2026-10-01.test.ts` (17 tests); updated `settings-terms`, `partner-in-charge`,
     `patch-review`, `isolation` (wording), `migrations`, `types.typecheck.ts`, `conformance-review.typecheck.ts`; `tests/data`
     (names for company users, `getStaffDisplayNames`, the limit helpers), `tests/unit/constants.test.ts`.
  5. **For feature modules:** see §6 "(decisions 2026-10-01)" (M2 team limit, M4 settings field, B28 names in M2/M5–M9). Test
     fixtures that build a full `PlatformSettingsRow` or `ClientSettings` need `owner_contributor_limit: 4`.
- **2026-09-30 — second patch (independent review of the contract patch).** `tests/db/patch-review.test.ts` is now a
  permanent regression test with no expected failures.
  1. **Partner-in-charge via approvals (BRD B24, B28):** company users can no longer read any ScaleUp staff profile
     (`profiles_select`), so whoever approved, reopened, sent back or commented shows as "ScaleUp"; ScaleUp staff ids in
     company-visible rows resolve to nothing. The data layer's timeline actors are null for company users (tests/data);
     the claims in §1, §5.5 and `src/lib/types/domain.ts` are now exact. Tests: `partner-in-charge.test.ts`,
     `isolation.test.ts` (corrected: it pinned the old visibility), `patch-review.test.ts`. *(Superseded in part on
     2026-10-01: the profiles stay hidden, but the company side now shows ScaleUp people as "Name (ScaleUp)" — BRD B28.)*
  2. **Owner-issued access links (BRD B14, B29):** the database decides who may hold a link for whom
     (`private.access_links_guard()`, `private.access_link_issuer_ok()`: a Super Admin for anyone; an owner only for
     contributors confined to that owner's active companies — re-checked when the link is used); links never change once
     issued; validity capped by `access_links_max_validity` (7 days / 24 hours) from a `created_at` never in the future.
     The M2 flow for existing accounts: add the membership, no link.
  3. **Single use:** `public.claim_access_link(p_token_hash)` (service role only) claims a link in one conditional UPDATE;
     the accept action calls it before `generateLink` / `verifyOtp`.
  4. **Exited companies' period closes:** `reopen_period_close` raises the read-only P0001 for exited / written-off
     companies (after the role check); `canReopenPeriodClose(ctx, companyStatus?)`.
  5. **`db:verify` TLS:** the server certificate is always verified, host name included (Supabase's root CA in
     `supabase/certs/prod-ca-2021.crt`, or `SUPABASE_DB_CA_FILE` / `sslrootcert`); sslmode values that skip verification
     are refused. `supabase/README.md` shows the verified `db push` connection string.
  6. **`db:verify` transaction guard:** files with top-level BEGIN / COMMIT / END / ROLLBACK / SAVEPOINT are refused before
     connecting (`scripts/sql-transaction-control.ts`; `tests/unit/sql-transaction-control.test.ts`,
     `tests/db/migrations.test.ts`), and the transaction id is compared after every file.
  Verified: `npm run typecheck`, `npm test` (36 files, 501 tests: unit 210, db 266, data 25; no expected failures),
  `npx eslint src tests scripts`, `npm run build`, `npm run db:types -- --check`, `npm run db:verify` (PostgreSQL 17.6,
  TLS verified against Supabase Root 2021 CA with the host name checked; 18 checks PASS, rolled back).
- **2026-09-30 — contract patch (pending-contract-changes A–L applied).**
  A. `companies.reporting_start_month` is nullable: null = "Not yet reporting" (BRD B16) — no months or closes are opened;
     setting it later opens the missing ones on the next `open_due_periods()`; clearing it keeps the history and opens
     nothing new; never overdue; `prior_months` counts every earlier draft; a period close counts from the company's first
     month in the period. `NOT_YET_REPORTING_META` in `src/lib/constants.ts`.
  B. Seed: the whole launch portfolio (BRD Appendix A, block `portfolio_h1_2026_v1`): 18 companies (SV1 7, SFF 11), fund
     mapping of every company, Huddle's KPIs; StayHere written off; i-Motorbike USD (iMotorbike Pte Ltd, Singapore).
  C. `public.access_links` (BRD B14): service role only, not row-audited; `/access` public in the proxy (and self-managed;
     `tests/unit/proxy.test.ts`); M2 owns `src/app/access/**`.
  D. Partner-in-charge moved to `company_internal.partner_in_charge_id` (ScaleUp-only; Super Admins assign it; the row
     always exists and is never inserted or deleted through the API). `getCompanyInternal`; `canApprove` / `canReopen` /
     `canEditInternal` take the internal row (`PartnerAssignment`); `canAssignPartner`; the portal no longer shows "Your
     ScaleUp partner" (`PortalSidebar` lost its `partner` prop).
  E. `platform_settings` SELECT is ScaleUp-only; `get_client_settings()` for every signed-in session; `getClientSettings`;
     `SubmissionBundle.clientSettings` + `settings: PlatformSettingsRow | null`; `getAuthSettings()` and the login action use
     the RPC.
  F. Terms of use enforced by the database (`private.terms_ok()` in every access helper); exempt: own profile,
     `get_client_settings`, `accept_terms`. Test users accept the terms by default (`createUser({ acceptTerms: false })`).
     A Super Admin publishes a new version with a plain `platform_settings` update (M4) and then accepts it on `/terms`
     like everyone else (from the next request on, their data is hidden until they do).
  G. `request_changes`, `reopen_submission`, `extend_due_date` refused for exited / written-off companies (P0001 read-only
     message); `approve_submission` still allowed. `canRequestChanges`, `canExtendDueDate` (company status),
     `canReopen(ctx, internal, companyStatus?)`; `canManageCycles` now means `open_period` only.
  H. Generated types: `PostgrestVersion "14"` (generator default, pinned in `tests/db/types.typecheck.ts`); RETURNS TABLE
     functions render multi-line.
  I. `npm run db:verify` (`scripts/db-verify.ts`): all migrations + seed in one always-rolled-back transaction on the hosted
     Postgres 17.6 + 17 checks — PASS (falls back to the IPv4 session pooler: the direct host is IPv6-only).
  J. `supabase/config.toml` Auth: minimum password length 12, secure password change, rate limits sized for server-side
     auth; matching dashboard settings in `supabase/README.md`.
  K. Data-layer tests moved into `tests/data/` (fake PostgREST; `npm test`).
- **2026-09-30 — foundation integration.** Contract updated to the built foundation (all "(updated)" items). Aligned
  across modules: `src/lib/validation.ts` now returns exactly the SQL issues (order, segment and sum-mismatch wording,
  `negative` for `allow_negative: false` / `min: 0`, validation settings on system fields); `periodTotals` rounds margins to
  4 dp like `computed_totals`; `permissions.ts` treats exited/written-off companies as read-only for replies, resolving and
  team management and gains `canReopenPeriodClose`; `toActionError` shows friendly RPC 42501 messages, maps 23001 and uses
  the database message inside a `DataError`; auth code no longer casts query results (tsc checks the select strings);
  `toValidationInput` no longer takes the currency. Added parity tests (`tests/db/mirror-parity.test.ts`,
  `tests/db/permissions-parity.test.ts`, `tests/unit/action-result.test.ts`) and the §5.7 stubs.
