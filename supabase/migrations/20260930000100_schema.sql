-- =============================================================================================
-- ScaleUp Portfolio Reporting Platform — core schema
-- Contract: docs/ARCHITECTURE.md §2.1 (enums) and §2.2 (tables).
--
-- Conventions
--   * public  = tables, views and app-callable RPCs (exposed through the Data API).
--   * private = helper and trigger functions (never exposed).
--   * A "month" is a date on the first day of the month (2026-09-01).
--   * Every table has created_at; tables marked † in the contract also have updated_at, maintained
--     by private.set_updated_at() (see 20260930000200_helpers.sql).
--   * No table relies on Supabase's default privileges: 20260930000800_grants.sql revokes everything
--     from anon/authenticated and grants back only what the RLS policies need.
-- =============================================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Enums (§2.1)
-- ---------------------------------------------------------------------------------------------
create type public.scaleup_role as enum ('super_admin', 'fund_admin', 'partner', 'viewer');
create type public.company_role as enum ('owner', 'contributor');
create type public.company_status as enum ('active', 'exited', 'written_off');
create type public.submission_status as enum ('draft', 'submitted', 'changes_requested', 'approved');
create type public.internal_rating as enum ('on_track', 'watch', 'at_risk');
create type public.kpi_frequency as enum ('monthly', 'half_yearly');
create type public.kpi_value_type as enum ('number', 'integer', 'currency', 'percent', 'boolean', 'text');
create type public.field_type as enum (
  'currency', 'number', 'integer', 'percent', 'text', 'long_text', 'rating', 'picklist', 'tags', 'boolean'
);
create type public.section_kind as enum ('financials', 'headcount', 'kpis', 'custom_numbers', 'narrative', 'pulse');
create type public.template_status as enum ('draft', 'published', 'archived');
create type public.comment_visibility as enum ('shared', 'internal');
create type public.close_period_type as enum ('quarter', 'half');
create type public.period_close_status as enum ('open', 'confirmed');
create type public.document_type as enum ('management_accounts', 'supporting');

-- ---------------------------------------------------------------------------------------------
-- Platform settings † (singleton)
-- ---------------------------------------------------------------------------------------------
create table public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  due_day smallint not null default 15 check (due_day between 1 and 28),
  escalation_days smallint not null default 14 check (escalation_days >= 0),
  backfill_grace_days smallint not null default 14 check (backfill_grace_days >= 0),
  revenue_swing_pct numeric not null default 30 check (revenue_swing_pct >= 0),
  min_runway_months numeric not null default 6 check (min_runway_months >= 0),
  require_mfa boolean not null default true,
  default_reporting_start date not null default '2026-07-01'
    check (extract(day from default_reporting_start) = 1),
  declaration_text text not null
    default 'I confirm that the figures submitted are accurate to the best of my knowledge.'
    check (btrim(declaration_text) <> ''),
  terms_version text not null default '2026-09' check (btrim(terms_version) <> ''),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.platform_settings is
  'Singleton (id = 1). Readable by ScaleUp staff and updated by Super Admins. Every signed-in session reads require_mfa, terms_version, declaration_text and due_day through public.get_client_settings().';

-- ---------------------------------------------------------------------------------------------
-- Profiles † (one per auth.users row, created by private.handle_new_user())
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  job_title text,
  scaleup_role public.scaleup_role,
  is_active boolean not null default true,
  terms_accepted_at timestamptz,
  terms_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.profiles.scaleup_role is 'ScaleUp staff role; null for company users. Never taken from user metadata.';

-- ---------------------------------------------------------------------------------------------
-- Funds †, companies †, fund investments †
-- ---------------------------------------------------------------------------------------------
create table public.funds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  legal_name text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  legal_name text,
  registration_no text,
  sector text,
  country text default 'Malaysia',
  website text,
  description text,
  reporting_currency char(3) not null default 'MYR' check (reporting_currency ~ '^[A-Z]{3}$'),
  status public.company_status not null default 'active',
  status_changed_at timestamptz,
  status_reason text,
  reporting_start_month date check (extract(day from reporting_start_month) = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.companies.reporting_start_month is
  'First month the company must report on the platform (first day of the month). Null = "Not yet reporting" (BRD B16): no months are opened for the company; months it already has are kept.';

create table public.fund_investments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete cascade,
  investment_date date,
  instrument text,
  ownership_pct numeric(7, 4) check (ownership_pct between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, company_id)
);

-- ---------------------------------------------------------------------------------------------
-- Company members †, company internal † (ScaleUp only)
-- ---------------------------------------------------------------------------------------------
create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.company_role not null,
  is_active boolean not null default true,
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.company_internal (
  company_id uuid primary key references public.companies (id) on delete cascade,
  partner_in_charge_id uuid references public.profiles (id) on delete set null,
  internal_rating public.internal_rating,
  exit_strategy_status text,
  exit_strategy_notes text,
  notes text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.company_internal is
  'ScaleUp-internal fields (BRD §6.3). Never visible to company users. Exactly one row per company: created with the company, updated in place, never inserted or deleted through the API.';
comment on column public.company_internal.partner_in_charge_id is
  'The ScaleUp partner in charge of the company (assigned by Super Admins only). Only an active partner who is partner-in-charge gets partner rights (approve, reopen, internal fields).';

-- ---------------------------------------------------------------------------------------------
-- Company configuration: revenue segments, KPI dimensions/members, company KPIs †
-- ---------------------------------------------------------------------------------------------
create table public.revenue_segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.kpi_dimensions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table public.kpi_dimension_members (
  id uuid primary key default gen_random_uuid(),
  dimension_id uuid not null references public.kpi_dimensions (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (dimension_id, name)
);

create table public.company_kpis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  unit text,
  value_type public.kpi_value_type not null default 'number',
  frequency public.kpi_frequency not null default 'monthly',
  dimension_id uuid references public.kpi_dimensions (id) on delete restrict,
  is_required boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
comment on column public.company_kpis.frequency is 'Half-yearly KPIs are collected in the June and December submissions only.';

-- ---------------------------------------------------------------------------------------------
-- Templates (versioned). Sections/fields of non-draft versions are immutable (guard trigger).
-- ---------------------------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index templates_single_default on public.templates (is_default) where is_default;

create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  version_no int not null check (version_no > 0),
  status public.template_status not null default 'draft',
  notes text,
  created_by uuid,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now(),
  unique (template_id, version_no)
);
create unique index template_versions_single_draft on public.template_versions (template_id) where status = 'draft';
create unique index template_versions_single_published on public.template_versions (template_id) where status = 'published';

create table public.template_sections (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_versions (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  title text not null check (btrim(title) <> ''),
  description text,
  kind public.section_kind not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (template_version_id, key)
);
-- A version has at most one Financials, Headcount and Company KPIs section.
create unique index template_sections_single_system_kind
  on public.template_sections (template_version_id, kind)
  where kind in ('financials', 'headcount', 'kpis');

create table public.template_fields (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.template_versions (id) on delete cascade,
  section_id uuid not null references public.template_sections (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null check (btrim(label) <> ''),
  help_text text,
  field_type public.field_type not null,
  is_required boolean not null default false,
  is_system boolean not null default false,
  options jsonb,
  validation jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (template_version_id, key)
);
comment on column public.template_fields.options is
  'picklist/tags: {"options": ["..."]}; rating: {"min": 1, "max": 5, "labels": {"1": "Very low", "5": "Very high"}}';
comment on column public.template_fields.validation is
  '{"min": 0} / {"allow_negative": true} / {"max_length": 4000}';

-- ---------------------------------------------------------------------------------------------
-- Reporting periods (one per month, portfolio-wide) and submissions † (one per company per month)
-- ---------------------------------------------------------------------------------------------
create table public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  due_date date not null,
  template_version_id uuid not null references public.template_versions (id),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  created_at timestamptz not null default now()
);
comment on column public.reporting_periods.opened_by is 'null = opened automatically by open_due_periods().';

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_id uuid not null references public.reporting_periods (id),
  month date not null check (extract(day from month) = 1),
  template_version_id uuid not null references public.template_versions (id),
  status public.submission_status not null default 'draft',
  due_date date not null,
  original_due_date date,
  extension_reason text,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id),
  declaration_text text,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  revision int not null default 0,
  last_saved_at timestamptz,
  last_saved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month)
);
comment on table public.submissions is 'Written only through RPCs (open_due_periods, save_submission_values, submit_submission, …).';

create table public.submission_values (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  field_key text not null,
  value_number numeric(20, 4),
  value_text text,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (submission_id, field_key)
);
comment on table public.submission_values is
  'currency/number/integer/percent/rating → value_number; text/long_text/picklist → value_text; tags/boolean → value_json.';

create table public.submission_segment_values (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  segment_id uuid not null references public.revenue_segments (id) on delete restrict,
  amount numeric(18, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (submission_id, segment_id)
);

create table public.submission_kpi_values (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  kpi_id uuid not null references public.company_kpis (id) on delete restrict,
  dimension_member_id uuid references public.kpi_dimension_members (id) on delete restrict,
  value_number numeric(20, 4),
  value_text text,
  value_bool boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint submission_kpi_values_cell_key unique nulls not distinct (submission_id, kpi_id, dimension_member_id)
);

create table public.submission_events (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  event text not null check (event in (
    'submitted', 'resubmitted', 'changes_requested', 'approved', 'reopened', 'amendment_requested', 'deadline_extended'
  )),
  actor_id uuid references public.profiles (id),
  message text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Comments (threads are one level deep; replies inherit the root's target and visibility)
-- ---------------------------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  target text not null default 'general',
  visibility public.comment_visibility not null default 'shared',
  author_id uuid not null default auth.uid() references public.profiles (id),
  body text not null check (char_length(body) between 1 and 5000 and btrim(body) <> ''),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Period closes † (calendar quarters and halves per company) and documents
-- ---------------------------------------------------------------------------------------------
create table public.period_closes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_type public.close_period_type not null,
  period_start date not null check (extract(day from period_start) = 1),
  period_end date not null,
  label text not null,
  status public.period_close_status not null default 'open',
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  computed_totals jsonb,
  restated_totals jsonb,
  restatement_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, period_type, period_start),
  check (period_end > period_start)
);
comment on column public.period_closes.period_end is 'Last calendar day of the period (e.g. 2026-09-30 for Q3 2026).';

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  period_close_id uuid references public.period_closes (id) on delete set null,
  doc_type public.document_type not null default 'management_accounts',
  file_name text not null check (btrim(file_name) <> ''),
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  version int not null default 1,
  uploaded_by uuid default auth.uid() references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on column public.documents.version is 'Set by trigger: 1 + max(version) for the same company / period close / document type.';

-- ---------------------------------------------------------------------------------------------
-- FX rates and the audit log
-- ---------------------------------------------------------------------------------------------
create table public.fx_rates (
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  month date not null check (extract(day from month) = 1),
  rate_to_myr numeric(18, 8) not null check (rate_to_myr > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (currency, month)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  company_id uuid,
  on_behalf boolean not null default false,
  summary text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
comment on table public.audit_log is 'Append-only. UPDATE / DELETE / TRUNCATE raise an exception for every role.';
comment on column public.audit_log.company_id is 'No foreign key on purpose: audit rows survive company deletion.';

-- ---------------------------------------------------------------------------------------------
-- Access links (BRD B14): our own single-use invitation and sign-in links, independent of Supabase
-- Auth's email OTP expiry. Auth plumbing, not business data: only server code with the secret
-- (service-role) key reads and writes them. RLS is enabled with no policies and anon/authenticated
-- have no privileges (20260930000400_rls.sql, 20260930000800_grants.sql). Deliberately NOT audited
-- by the row trigger (token hashes must never be copied into audit_log): the app records invite,
-- sign_in_link and invite_revoke with public.log_audit_event().
--   token_hash = lower-case hex sha256 of the random token; the token itself only ever appears in
--   the link (/access/<token>). Invitations are valid for at most 7 days, sign-in links for at most
--   24 hours (BRD B14, B23), counted from created_at (never in the future: access_links_guard()).
--   Who may issue a link for whom (created_by) is enforced by private.access_links_guard(); a link is
--   used through public.claim_access_link() only, which claims it atomically (single use).
-- ---------------------------------------------------------------------------------------------
create table public.access_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('invite', 'signin')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  constraint access_links_max_validity check (
    expires_at <= created_at + case when purpose = 'invite' then interval '7 days' else interval '24 hours' end
  )
);
comment on table public.access_links is
  'Single-use invitation / sign-in links (BRD B14). Service role only: RLS on, no policies, no API grants, not row-audited. Used only through public.claim_access_link().';
comment on column public.access_links.token_hash is 'Lower-case hex sha256 of the token in the link; the token itself is never stored.';
comment on column public.access_links.created_by is
  'Who issued the link (null = a trusted script). Must be an active Super Admin, or an active company owner issuing it for a contributor whose only companies are active companies that this owner owns (private.access_link_issuer_ok).';

-- ---------------------------------------------------------------------------------------------
-- Seed bookkeeping (private schema, never exposed, no API privileges): one row per one-time block
-- of supabase/seed.sql. `supabase db push --include-seed` re-runs the seed whenever the file
-- changes; the markers stop it from re-creating bootstrap rows (funds, pilot companies, KPIs) that
-- admins have deleted since.
-- ---------------------------------------------------------------------------------------------
create table private.seed_markers (
  key text primary key,
  applied_at timestamptz not null default now()
);
alter table private.seed_markers enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Indexes (foreign keys used in policies/joins and common queries)
-- ---------------------------------------------------------------------------------------------
create index companies_status_idx on public.companies (status);
create index company_internal_partner_in_charge_idx on public.company_internal (partner_in_charge_id);
create index fund_investments_company_idx on public.fund_investments (company_id);
create index company_members_user_idx on public.company_members (user_id);
create index company_members_invited_by_idx on public.company_members (invited_by);
create index company_kpis_dimension_idx on public.company_kpis (dimension_id);
create index template_fields_section_idx on public.template_fields (section_id);
create index reporting_periods_template_version_idx on public.reporting_periods (template_version_id);
create index submissions_period_idx on public.submissions (period_id);
create index submissions_month_idx on public.submissions (month);
create index submissions_status_idx on public.submissions (status);
create index submissions_template_version_idx on public.submissions (template_version_id);
create index submissions_submitted_by_idx on public.submissions (submitted_by);
create index submissions_approved_by_idx on public.submissions (approved_by);
create index submissions_last_saved_by_idx on public.submissions (last_saved_by);
create index submission_segment_values_segment_idx on public.submission_segment_values (segment_id);
create index submission_kpi_values_kpi_idx on public.submission_kpi_values (kpi_id);
create index submission_kpi_values_member_idx on public.submission_kpi_values (dimension_member_id);
create index submission_events_submission_idx on public.submission_events (submission_id, created_at);
create index submission_events_actor_idx on public.submission_events (actor_id);
create index comments_submission_idx on public.comments (submission_id);
create index comments_parent_idx on public.comments (parent_id);
create index comments_author_idx on public.comments (author_id);
create index comments_resolved_by_idx on public.comments (resolved_by);
create index period_closes_confirmed_by_idx on public.period_closes (confirmed_by);
create index documents_company_idx on public.documents (company_id);
create index documents_period_close_idx on public.documents (period_close_id);
create index documents_uploaded_by_idx on public.documents (uploaded_by);
create index fx_rates_month_idx on public.fx_rates (month);
create index audit_log_company_occurred_idx on public.audit_log (company_id, occurred_at desc);
create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index access_links_user_idx on public.access_links (user_id);
create index access_links_created_by_idx on public.access_links (created_by);
