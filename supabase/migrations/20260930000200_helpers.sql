-- =============================================================================================
-- Private helper functions (used by RLS policies, views and RPCs) and data-integrity triggers.
-- Contract: docs/ARCHITECTURE.md §2.2 (triggers), §2.7 (helpers).
--
-- Every security definer function sets search_path = '' and uses schema-qualified names.
-- Access helpers only grant access to an ACTIVE profile whose session satisfies MFA
-- (JWT aal = 'aal2' while platform_settings.require_mfa is true) and who has accepted the CURRENT
-- terms of use (profiles.terms_version = platform_settings.terms_version, BRD B25). Until then a
-- signed-in user reads only their own profile and public.get_client_settings(), and may call
-- public.accept_terms().
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Dates (Malaysia time). app.today is a test hook: set_config('app.today', '2026-10-20', false).
-- ---------------------------------------------------------------------------------------------
create or replace function private.today_myt()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('app.today', true), '')::date,
    (now() at time zone 'Asia/Kuala_Lumpur')::date
  )
$$;

create or replace function private.month_start(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(extract(year from p_date)::int, extract(month from p_date)::int, 1)
$$;

-- 'Sep 2026'
create or replace function private.month_label(p_month date)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_month, 'Mon YYYY')
$$;

-- '30 Sep 2026'
create or replace function private.date_label(p_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_date, 'FMDD Mon YYYY')
$$;

-- '1,234.50' / '-1,234.50'
create or replace function private.amount_label(p_amount numeric)
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(to_char(round(p_amount, 2), 'FM999,999,999,999,999,990.00'))
$$;

-- '1,234.5' / '-0.25' / '0' (grouped, up to 4 decimals, no trailing zeros). Validation messages.
create or replace function private.number_label(p_value numeric)
returns text
language sql
stable
set search_path = ''
as $$
  select rtrim(rtrim(to_char(round(p_value, 4), 'FM999,999,999,999,999,999,999,990.0000'), '0'), '.')
$$;

-- Safe text → uuid (null on bad input). Used for storage object folders.
create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null
     or p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p_value::uuid;
end;
$$;

-- True when a JSON value is missing or JSON null.
create or replace function private.json_is_null(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is null or jsonb_typeof(p_value) = 'null'
$$;

-- ---------------------------------------------------------------------------------------------
-- Caller identity
-- ---------------------------------------------------------------------------------------------

-- A trusted backend caller with no end user: service_role key, pg_cron or a direct database
-- connection. anon/authenticated sessions are never "system".
create or replace function private.is_system()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null
     and coalesce(auth.role(), 'service_role') not in ('anon', 'authenticated')
$$;

-- MFA satisfied: require_mfa is off, or the JWT carries aal2. A missing settings row counts as required.
create or replace function private.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not s.require_mfa from public.platform_settings s where s.id = 1), false)
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Signed in, profile active, MFA satisfied — the terms of use may still be pending. Only for the few
-- things a user must be able to do before accepting the terms (public.accept_terms()).
create or replace function private.is_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
     and private.mfa_ok()
$$;

-- The caller has accepted the CURRENT terms of use (BRD B25). Changing
-- platform_settings.terms_version makes everyone accept again. A missing settings row fails closed.
create or replace function private.terms_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.platform_settings s on s.id = 1
    where p.id = auth.uid()
      and p.terms_accepted_at is not null
      and p.terms_version = s.terms_version
  )
$$;

-- Signed in, profile active, MFA satisfied and the current terms accepted: the base of every
-- access helper below.
create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_session() and private.terms_ok()
$$;

-- The caller's ScaleUp role; null unless the profile is active, MFA is satisfied and the current
-- terms are accepted.
create or replace function private.scaleup_role()
returns public.scaleup_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.scaleup_role
  from public.profiles p
  where p.id = auth.uid()
    and private.is_active_user()
$$;

create or replace function private.is_scaleup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.scaleup_role() is not null
$$;

create or replace function private.has_role(variadic p_roles public.scaleup_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.scaleup_role() = any (p_roles), false)
$$;

-- has_role(...) or a trusted system caller (used by admin-only RPCs).
create or replace function private.has_role_or_system(variadic p_roles public.scaleup_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_system() or private.has_role(variadic p_roles)
$$;

-- The caller's role in a company (active membership + active profile + MFA + current terms), else null.
create or replace function private.company_role(p_company_id uuid)
returns public.company_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.company_members m
  where m.company_id = p_company_id
    and m.user_id = auth.uid()
    and m.is_active
    and private.is_active_user()
$$;

create or replace function private.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.company_role(p_company_id) is not null
$$;

-- Caller is a (active, MFA, terms accepted) partner and the company's partner-in-charge
-- (company_internal.partner_in_charge_id, ScaleUp-internal). Only ever describes the caller.
create or replace function private.is_partner_of(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.scaleup_role() = 'partner', false)
     and exists (
       select 1 from public.company_internal ci
       where ci.company_id = p_company_id and ci.partner_in_charge_id = auth.uid()
     )
$$;

create or replace function private.can_view_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_company_id is not null
     and (private.is_scaleup() or private.is_company_member(p_company_id))
$$;

create or replace function private.submission_company(p_submission_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.company_id from public.submissions s where s.id = p_submission_id
$$;

create or replace function private.dimension_company(p_dimension_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.company_id from public.kpi_dimensions d where d.id = p_dimension_id
$$;

-- The caller may change this submission's values right now (status, company state and role).
create or replace function private.can_edit_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.submissions s
    join public.companies c on c.id = s.company_id
    where s.id = p_submission_id
      and s.status in ('draft', 'changes_requested')
      and c.status = 'active'
      and (private.is_company_member(s.company_id) or private.has_role('fund_admin'))
  )
$$;

-- The caller (active, MFA) shares at least one company with p_user_id (profile visibility).
create or replace function private.shares_company_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
     and exists (
       select 1
       from public.company_members me
       join public.company_members other on other.company_id = me.company_id
       where me.user_id = auth.uid()
         and me.is_active
         and other.user_id = p_user_id
     )
$$;

-- A company-side account: the profile exists and has no ScaleUp role. Company owners may only
-- add such users as contributors (never ScaleUp staff, whose access is governed by their role).
create or replace function private.is_company_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_user_id and p.scaleup_role is null)
$$;

-- The company exists and is active. Exited and written-off companies are read-only (BRD B15).
create or replace function private.is_active_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.companies c where c.id = p_company_id and c.status = 'active')
$$;

-- Documents may be added for ACTIVE companies by their members or by fund admins (on behalf).
create or replace function private.can_upload_company_document(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_company(p_company_id)
     and (private.is_company_member(p_company_id) or private.has_role('fund_admin'))
$$;

-- The shape of a document's storage path: <company_id>/<period_close_id or 'general'>/<file name>
-- with lower-case ids, exactly three segments and a plain file name (no '.', '..', empty segment or
-- control character). Downloads are signed with the service role from this path, so it must never
-- be able to point outside the company's folder.
create or replace function private.is_document_path(p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_path ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
              || '/(general|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
              || '/[^/[:cntrl:]]+$')
      and split_part(p_path, '/', 3) not in ('.', '..'),
    false)
$$;

-- storage.objects INSERT policy: a well-formed document path whose period-close folder (if any)
-- belongs to the company, uploaded by a member of that active company or a Fund Admin.
create or replace function private.can_upload_document_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_folder text;
begin
  if not private.is_document_path(p_name) then
    return false;
  end if;
  v_company_id := split_part(p_name, '/', 1)::uuid;
  v_folder := split_part(p_name, '/', 2);
  if v_folder <> 'general' and not exists (
    select 1 from public.period_closes pc
    where pc.id = v_folder::uuid and pc.company_id = v_company_id
  ) then
    return false;
  end if;
  return private.can_upload_company_document(v_company_id);
end;
$$;

create or replace function private.template_version_is_draft(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.template_versions v where v.id = p_version_id and v.status = 'draft'
  )
$$;

-- The canonical system fields (key → type, the kind of section they live in, whether they may be
-- negative). Used by the template guard, publishing and validation.
create or replace function private.system_fields()
returns table (key text, field_type public.field_type, sort_order int, section_kind public.section_kind, non_negative boolean)
language sql
immutable
set search_path = ''
as $$
  values
    ('revenue_total', 'currency'::public.field_type, 1, 'financials'::public.section_kind, true),
    ('gross_profit', 'currency'::public.field_type, 2, 'financials'::public.section_kind, false),
    ('net_profit', 'currency'::public.field_type, 3, 'financials'::public.section_kind, false),
    ('cash_in_bank', 'currency'::public.field_type, 4, 'financials'::public.section_kind, true),
    ('burn_rate', 'currency'::public.field_type, 5, 'financials'::public.section_kind, true),
    ('headcount_ft', 'integer'::public.field_type, 6, 'headcount'::public.section_kind, true),
    ('headcount_pt', 'integer'::public.field_type, 7, 'headcount'::public.section_kind, true)
$$;

-- ---------------------------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger set_updated_at before update on public.platform_settings
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.funds
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fund_investments
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_internal
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_kpis
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.submissions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.submission_values
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.submission_segment_values
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.submission_kpi_values
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.period_closes
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fx_rates
  for each row execute function private.set_updated_at();

create trigger set_updated_by before insert or update on public.platform_settings
  for each row execute function private.set_updated_by();
create trigger set_updated_by before insert or update on public.company_internal
  for each row execute function private.set_updated_by();
create trigger set_updated_by before insert or update on public.fx_rates
  for each row execute function private.set_updated_by();

-- Clients never choose row timestamps on the tables they write directly: created_at (and
-- updated_at, where the table has it) is set by the database on insert and created_at never
-- changes afterwards. Trusted system callers (data migrations, the seed) keep full control.
-- documents and comments do the same in their own insert triggers.
--   tg_argv[0] = 'updated_at' when the table also has an updated_at column
create or replace function private.pin_row_timestamps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_system() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    if tg_argv[0] = 'updated_at' then
      new.updated_at := now();
    end if;
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger pin_row_timestamps before insert or update on public.platform_settings
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.funds
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.companies
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.fund_investments
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.company_members
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.company_internal
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.revenue_segments
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.kpi_dimensions
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.kpi_dimension_members
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.company_kpis
  for each row execute function private.pin_row_timestamps('updated_at');
create trigger pin_row_timestamps before insert or update on public.templates
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.template_versions
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.template_sections
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.template_fields
  for each row execute function private.pin_row_timestamps();
create trigger pin_row_timestamps before insert or update on public.fx_rates
  for each row execute function private.pin_row_timestamps('updated_at');

-- ---------------------------------------------------------------------------------------------
-- Companies: status timestamp, month normalisation and the company_internal row
-- ---------------------------------------------------------------------------------------------
-- Invoker rights on purpose: it runs as the writing user, so it only calls built-in functions.
create or replace function private.companies_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reporting_start_month is not null then
    new.reporting_start_month := date_trunc('month', new.reporting_start_month)::date;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' and new.status_changed_at is null then
      new.status_changed_at := now();
    end if;
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create trigger companies_before_write before insert or update on public.companies
  for each row execute function private.companies_before_write();

create or replace function private.companies_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.company_internal (company_id) values (new.id)
  on conflict (company_id) do nothing;
  return null;
end;
$$;

create trigger companies_after_insert after insert on public.companies
  for each row execute function private.companies_after_insert();

-- Backfill: every company has its internal row (a no-op on a fresh database; supabase/seed.sql
-- ensures it too).
insert into public.company_internal (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- company_internal: the row never moves to another company, and only Super Admins (or trusted
-- system callers) assign the partner-in-charge. Fund Admins and the partner-in-charge may still
-- edit the other internal fields; sending the unchanged partner back (whole-row forms) is fine.
-- ---------------------------------------------------------------------------------------------
create or replace function private.company_internal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_changed boolean;
begin
  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id then
      raise exception 'Company settings cannot be moved to another company.';
    end if;
    v_partner_changed := new.partner_in_charge_id is distinct from old.partner_in_charge_id;
  else
    v_partner_changed := new.partner_in_charge_id is not null;
  end if;
  if v_partner_changed and not (private.is_system() or private.has_role('super_admin')) then
    raise exception using errcode = '42501', message = 'Only Super Admins can assign the partner-in-charge.';
  end if;
  return new;
end;
$$;

create trigger company_internal_guard before insert or update on public.company_internal
  for each row execute function private.company_internal_guard();

-- ---------------------------------------------------------------------------------------------
-- Company members: invited_by is always the inserting user
-- ---------------------------------------------------------------------------------------------
create or replace function private.company_members_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.invited_by := auth.uid();
    end if;
  else
    new.invited_by := old.invited_by;
  end if;
  return new;
end;
$$;

create trigger company_members_before_write before insert or update on public.company_members
  for each row execute function private.company_members_before_write();

-- ---------------------------------------------------------------------------------------------
-- Access links (BRD B14): who may issue a link for whom, and links never change once issued.
-- Whoever holds a link can sign in as its account (the inviter copies and sends it), so an owner
-- must never get one for an account that also reaches another company, belongs to a co-owner or
-- to ScaleUp staff: ScaleUp issues those, or the person simply signs in as usual.
-- ---------------------------------------------------------------------------------------------

-- p_created_by may hold a link for p_user_id:
--   * null: a trusted script (e.g. scripts/create-user.ts bootstrapping the first Super Admin);
--   * an active Super Admin: any account;
--   * an active company owner (no ScaleUp role): only a company-side account with at least one active
--     membership, where EVERY membership (active or not) is a contributor membership of an active
--     company that the issuer actively owns.
-- Checked when the link is issued (access_links_guard) and again when it is used
-- (public.claim_access_link), because memberships can change in between.
create or replace function private.access_link_issuer_ok(p_created_by uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_created_by is null then true
    when exists (
      select 1 from public.profiles c
      where c.id = p_created_by and c.is_active and c.scaleup_role = 'super_admin'
    ) then true
    else
      exists (select 1 from public.profiles c where c.id = p_created_by and c.is_active and c.scaleup_role is null)
      and exists (select 1 from public.profiles t where t.id = p_user_id and t.scaleup_role is null)
      and exists (select 1 from public.company_members m where m.user_id = p_user_id and m.is_active)
      and not exists (
        select 1
        from public.company_members m
        where m.user_id = p_user_id
          and not (
            m.role = 'contributor'
            and exists (
              select 1
              from public.company_members o
              join public.companies co on co.id = o.company_id
              where o.company_id = m.company_id
                and o.user_id = p_created_by
                and o.role = 'owner'
                and o.is_active
                and co.status = 'active'
            )
          )
      )
  end
$$;

-- Issuing: created_at is never in the future (the validity cap counts from it) and the issuer may
-- hold a link for the account (42501 otherwise). Afterwards a link never changes: only used_at and
-- revoked_at are set, each once. (Service role only: anon and authenticated cannot reach the table.)
create or replace function private.access_links_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at > now() then
      raise exception using errcode = '23514', message = 'An access link cannot be dated in the future.';
    end if;
    if not private.access_link_issuer_ok(new.created_by, new.user_id) then
      if exists (
        select 1 from public.profiles c
        where c.id = new.created_by and c.is_active and c.scaleup_role is null
          and exists (
            select 1 from public.company_members o join public.companies co on co.id = o.company_id
            where o.user_id = c.id and o.role = 'owner' and o.is_active and co.status = 'active'
          )
      ) then
        raise exception using errcode = '42501',
          message = 'Only ScaleUp can send this person a link, because they are not just a contributor of your company. Ask them to sign in as usual.';
      end if;
      raise exception using errcode = '42501', message = 'Only Super Admins and company owners can issue invitation and sign-in links.';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.user_id <> old.user_id or new.purpose <> old.purpose
     or new.token_hash <> old.token_hash or new.expires_at <> old.expires_at
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'An access link cannot be changed. Revoke it and issue a new one.';
  end if;
  if old.used_at is not null and new.used_at is distinct from old.used_at then
    raise exception 'This link has already been used.';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'This link has already been revoked.';
  end if;
  return new;
end;
$$;

create trigger access_links_guard before insert or update on public.access_links
  for each row execute function private.access_links_guard();

-- ---------------------------------------------------------------------------------------------
-- Company configuration integrity: rows never move between companies; a KPI's dimension must
-- belong to the KPI's company. (Moving rows would attach one company's figures to another.)
-- ---------------------------------------------------------------------------------------------
create or replace function private.company_config_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'kpi_dimension_members' then
    if tg_op = 'UPDATE' and new.dimension_id <> old.dimension_id then
      raise exception 'A dimension member cannot be moved to another dimension.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'Company settings cannot be moved to another company.';
  end if;

  -- (Nested: PL/pgSQL evaluates every column reference in a condition, and only company_kpis
  -- has dimension_id.)
  if tg_table_name = 'company_kpis' then
    if new.dimension_id is not null and not exists (
      select 1 from public.kpi_dimensions d
      where d.id = new.dimension_id and d.company_id = new.company_id
    ) then
      raise exception 'The KPI dimension must belong to the same company as the KPI.';
    end if;
  end if;
  return new;
end;
$$;

create trigger company_config_guard before update on public.revenue_segments
  for each row execute function private.company_config_guard();
create trigger company_config_guard before update on public.kpi_dimensions
  for each row execute function private.company_config_guard();
create trigger company_config_guard before update on public.kpi_dimension_members
  for each row execute function private.company_config_guard();
create trigger company_config_guard before insert or update on public.company_kpis
  for each row execute function private.company_config_guard();

-- Deleting a KPI dimension removes its members first, while the dimension still exists, so their
-- audit rows can still name the company (after a plain ON DELETE CASCADE the parent is already gone).
-- Members with stored KPI values still block the delete (ON DELETE RESTRICT), as before.
create or replace function private.kpi_dimensions_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.kpi_dimension_members m where m.dimension_id = old.id;
  return old;
end;
$$;

create trigger kpi_dimensions_before_delete before delete on public.kpi_dimensions
  for each row execute function private.kpi_dimensions_before_delete();

-- ---------------------------------------------------------------------------------------------
-- Comments: replies attach to a root in the same submission and inherit target + visibility.
-- ---------------------------------------------------------------------------------------------
create or replace function private.comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root public.comments%rowtype;
  v_company_id uuid;
begin
  -- Exited / written-off companies are read-only for their own members (RLS refuses the row as
  -- well; this only gives members a clear message). Non-members are left to RLS, so nothing about
  -- another company leaks. ScaleUp reviewers may still comment.
  if not private.is_system() and not private.has_role('super_admin', 'fund_admin', 'partner') then
    v_company_id := private.submission_company(new.submission_id);
    if private.is_company_member(v_company_id) and not private.is_active_company(v_company_id) then
      raise exception '% is no longer an active portfolio company, so its records are read-only.',
        (select c.name from public.companies c where c.id = v_company_id);
    end if;
  end if;

  if new.parent_id is not null then
    select * into v_root from public.comments c where c.id = new.parent_id;
    if not found or v_root.submission_id <> new.submission_id then
      raise exception 'You can only reply to a comment on the same monthly update.';
    end if;
    if v_root.parent_id is not null then
      raise exception 'Replies can only be added to the first comment of a thread.';
    end if;
    new.target := v_root.target;
    new.visibility := v_root.visibility;
  else
    new.target := coalesce(nullif(btrim(new.target), ''), 'general');
    if new.target ~* '^(segment|kpi):' then
      new.target := lower(new.target); -- ids are stored in lower case
    end if;
    if new.target !~ ('^(general'
        || '|field:[a-z][a-z0-9_]*'
        || '|segment:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        || '|kpi:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        || '(:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$') then
      raise exception 'That comment target is not recognised.';
    end if;
  end if;

  if not private.is_system() then
    new.resolved_at := null;
    new.resolved_by := null;
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger comments_before_insert before insert on public.comments
  for each row execute function private.comments_before_insert();

-- Comments are immutable apart from resolved_at/resolved_by (changed through resolve_comment()).
create or replace function private.comments_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.submission_id, new.parent_id, new.target, new.visibility, new.author_id, new.body, new.created_at)
     is distinct from
     (old.submission_id, old.parent_id, old.target, old.visibility, old.author_id, old.body, old.created_at) then
    raise exception 'Comments cannot be edited.';
  end if;
  return new;
end;
$$;

create trigger comments_before_update before update on public.comments
  for each row execute function private.comments_before_update();

-- ---------------------------------------------------------------------------------------------
-- Documents describe a real upload (applies to every role):
--   * the period close belongs to the same company;
--   * storage_path is exactly <company_id>/<period_close_id or 'general'>/<file name> for this row;
--   * the object exists in the company-documents bucket, and size_bytes / mime_type come from its
--     storage metadata (the client's values are only kept when the metadata lacks them);
--   * version = 1 + max(version) for the same company / period close / type;
--   * uploaded_at and created_at are set by the database (except for trusted system callers).
-- ---------------------------------------------------------------------------------------------
create or replace function private.documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
begin
  if new.period_close_id is not null and not exists (
    select 1 from public.period_closes pc
    where pc.id = new.period_close_id and pc.company_id = new.company_id
  ) then
    raise exception 'That period close belongs to a different company.';
  end if;

  if split_part(new.storage_path, '/', 1) <> new.company_id::text then
    raise exception 'The file must be stored in the company''s own folder.';
  end if;
  if not private.is_document_path(new.storage_path)
     or split_part(new.storage_path, '/', 2) <> coalesce(new.period_close_id::text, 'general') then
    raise exception 'The file must be stored as <company>/<period close or "general">/<file name>.';
  end if;

  select o.metadata into v_metadata
  from storage.objects o
  where o.bucket_id = 'company-documents' and o.name = new.storage_path;
  if not found then
    raise exception 'The file has not been uploaded yet. Upload it first, then save the document.';
  end if;
  if jsonb_typeof(v_metadata -> 'size') = 'number' then
    new.size_bytes := trunc((v_metadata ->> 'size')::numeric)::bigint;
  end if;
  if jsonb_typeof(v_metadata -> 'mimetype') = 'string' and btrim(v_metadata ->> 'mimetype') <> '' then
    new.mime_type := v_metadata ->> 'mimetype';
  end if;

  -- Serialise concurrent uploads for the same slot so versions stay unique.
  perform pg_advisory_xact_lock(hashtextextended(
    'documents:' || new.company_id::text || ':' || coalesce(new.period_close_id::text, 'general')
      || ':' || new.doc_type::text, 0));

  select coalesce(max(d.version), 0) + 1
    into new.version
  from public.documents d
  where d.company_id = new.company_id
    and d.period_close_id is not distinct from new.period_close_id
    and d.doc_type = new.doc_type;

  if not private.is_system() then
    new.uploaded_at := now();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger documents_before_insert before insert on public.documents
  for each row execute function private.documents_before_insert();

-- ---------------------------------------------------------------------------------------------
-- Template guards
--   * New versions created by users always start as drafts (version_no = max + 1).
--   * Status/publication columns only change inside publish_template_version() (or system).
--   * Published and archived versions cannot be deleted.
--   * Sections/fields can only change while their version is a draft (every role).
--   * System fields keep key, type and is_system and cannot be deleted; system sections
--     (financials, headcount, kpis) keep their kind and cannot be deleted.
-- ---------------------------------------------------------------------------------------------
create or replace function private.guard_template_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publishing boolean := coalesce(current_setting('app.template_publish', true), '') = 'on';
  v_system boolean := private.is_system();
begin
  if tg_op = 'INSERT' then
    if not v_system then
      new.status := 'draft';
      new.published_at := null;
      new.published_by := null;
      new.created_by := auth.uid();
      select coalesce(max(v.version_no), 0) + 1
        into new.version_no
      from public.template_versions v
      where v.template_id = new.template_id;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.template_id <> old.template_id or new.version_no <> old.version_no then
      raise exception 'A template version cannot be moved or renumbered.';
    end if;
    if (new.status, new.published_at, new.published_by) is distinct from (old.status, old.published_at, old.published_by)
       and not (v_publishing or v_system) then
      raise exception 'Use "Publish" to change the status of a template version.';
    end if;
    return new;
  else
    if old.status <> 'draft' then
      raise exception 'Published and archived template versions cannot be deleted.';
    end if;
    return old;
  end if;
end;
$$;

create trigger guard_template_version before insert or update or delete on public.template_versions
  for each row execute function private.guard_template_version();

create or replace function private.guard_template_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_status public.template_status;
  v_system_type public.field_type;
  v_system_kind public.section_kind;
  v_section_kind public.section_kind;
begin
  if tg_op = 'DELETE' then
    v_version_id := old.template_version_id;
  else
    v_version_id := new.template_version_id;
  end if;

  if tg_op = 'UPDATE' and new.template_version_id <> old.template_version_id then
    raise exception 'Template sections and fields cannot be moved to another version.';
  end if;

  select v.status into v_status from public.template_versions v where v.id = v_version_id;
  if not found then
    -- The version itself is being deleted (cascade), or the foreign key will reject the row.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_status <> 'draft' then
    raise exception 'This template version is %, so it cannot be changed. Create a new draft instead.', v_status;
  end if;

  if tg_table_name = 'template_sections' then
    if tg_op = 'DELETE' then
      if old.kind in ('financials', 'headcount', 'kpis') then
        raise exception 'The "%" section is a system section and cannot be deleted.', old.title;
      end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and new.kind <> old.kind
       and (old.kind in ('financials', 'headcount', 'kpis') or new.kind in ('financials', 'headcount', 'kpis')) then
      raise exception 'The type of a system section cannot be changed.';
    end if;
    return new;
  end if;

  -- template_fields
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception '"%" is a system field and cannot be deleted.', old.label;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_system and (new.key <> old.key or new.field_type <> old.field_type or not new.is_system) then
      raise exception 'System fields keep their key and type. You can change the label, help text and order.';
    end if;
    if not old.is_system and new.is_system then
      raise exception 'Only the built-in financial and headcount fields can be system fields.';
    end if;
  end if;

  if new.is_system then
    select sf.field_type, sf.section_kind into v_system_type, v_system_kind
    from private.system_fields() sf where sf.key = new.key;
    if v_system_type is null or v_system_type <> new.field_type then
      raise exception 'Only the built-in financial and headcount fields can be system fields.';
    end if;
  elsif exists (select 1 from private.system_fields() sf where sf.key = new.key) then
    raise exception 'The key "%" is reserved for a system field.', new.key;
  end if;

  select s.kind into v_section_kind
  from public.template_sections s
  where s.id = new.section_id and s.template_version_id = new.template_version_id;
  if not found then
    raise exception 'The section belongs to a different template version.';
  end if;
  -- System fields stay in their own section (financial figures in Financials, headcounts in
  -- Headcount): the form, validation and the tracker's "narrative filled" flag rely on it.
  if new.is_system and v_section_kind is distinct from v_system_kind then
    raise exception 'System fields must stay in the % section.', initcap(v_system_kind::text);
  end if;
  return new;
end;
$$;

create trigger guard_template_edit before insert or update or delete on public.template_sections
  for each row execute function private.guard_template_edit();
create trigger guard_template_edit before insert or update or delete on public.template_fields
  for each row execute function private.guard_template_edit();

-- ---------------------------------------------------------------------------------------------
-- Default template: new months are opened with the default template's published version, so
-- (for signed-in users) the default always has a published version and there is always one:
--   * a template needs a published version before it can become the default;
--   * the default flag cannot simply be removed; making another template the default switches it
--     in one statement (the previous default steps down first, which the partial unique index
--     templates_single_default needs). The switch applies to every caller.
-- Trusted system callers (seed, data fixes) are exempt from the first two rules.
-- ---------------------------------------------------------------------------------------------
create or replace function private.guard_default_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := private.is_system();
begin
  if tg_op = 'INSERT' then
    if new.is_default and not v_system then
      raise exception 'Publish a version of this template before making it the default.';
    end if;
    return new;
  end if;

  if new.is_default and not old.is_default then
    if not v_system and not exists (
      select 1 from public.template_versions v where v.template_id = new.id and v.status = 'published'
    ) then
      raise exception 'Publish a version of this template before making it the default.';
    end if;
    perform set_config('app.template_default_switch', 'on', true);
    update public.templates t set is_default = false where t.is_default and t.id <> new.id;
    perform set_config('app.template_default_switch', '', true);
  elsif old.is_default and not new.is_default and not v_system
        and coalesce(current_setting('app.template_default_switch', true), '') <> 'on' then
    raise exception 'There must always be a default template. Make another template the default instead.';
  end if;
  return new;
end;
$$;

create trigger guard_default_template before insert or update on public.templates
  for each row execute function private.guard_default_template();

-- ---------------------------------------------------------------------------------------------
-- Auth: create the profile for every new auth user; keep the email in sync.
-- Roles are never taken from user metadata (only full_name is read).
-- ---------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated after update of email on auth.users
  for each row execute function private.handle_user_email_change();
