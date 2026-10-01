-- =============================================================================================
-- Audit log: row-change trigger on every business table, append-only enforcement,
-- public.log_audit_event() for app events (exports, downloads, invites, MFA resets).
-- Contract: docs/ARCHITECTURE.md §2.2 (audit_log).
--
-- RPCs describe what they are doing through a transaction-local "audit context"
-- (private.set_audit_context): the action name (e.g. 'submit'), a summary, an explicit on_behalf
-- flag, a fallback company id and an "as system" flag (automatic work such as opening the months
-- of every company from one user's page load is recorded as the system, not as that user). The
-- row trigger picks it up; RPCs clear it after the statement.
-- =============================================================================================

create or replace function private.set_audit_context(
  p_action text default null,
  p_summary text default null,
  p_on_behalf boolean default null,
  p_company_id uuid default null,
  p_as_system boolean default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('app.audit_action', coalesce(p_action, ''), true);
  perform set_config('app.audit_summary', coalesce(p_summary, ''), true);
  perform set_config('app.audit_on_behalf', coalesce(p_on_behalf::text, ''), true);
  perform set_config('app.audit_company_id', coalesce(p_company_id::text, ''), true);
  perform set_config('app.audit_as_system', case when p_as_system then 'on' else '' end, true);
end;
$$;

create or replace function private.clear_audit_context()
returns void
language sql
set search_path = ''
as $$
  select private.set_audit_context()
$$;

-- Who is acting: (actor_id, actor_email, actor_role). actor_role is the ScaleUp role, else
-- company_owner / company_contributor: for a row of a known company only from a membership in THAT
-- company (null otherwise, never a role held in another company); for rows without a company from
-- the user's active memberships (owner first). No signed-in user: 'system'.
create or replace function private.audit_actor(
  p_company_id uuid,
  out actor_id uuid,
  out actor_email text,
  out actor_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_member_role public.company_role;
begin
  actor_id := auth.uid();
  if actor_id is null then
    actor_role := 'system';
    actor_email := nullif(auth.jwt() ->> 'email', '');
    return;
  end if;

  select * into v_profile from public.profiles p where p.id = actor_id;
  actor_email := coalesce(v_profile.email, nullif(auth.jwt() ->> 'email', ''));

  if v_profile.scaleup_role is not null then
    actor_role := v_profile.scaleup_role::text;
    return;
  end if;

  if p_company_id is not null then
    select m.role into v_member_role
    from public.company_members m
    where m.company_id = p_company_id and m.user_id = actor_id;
  else
    select m.role into v_member_role
    from public.company_members m
    where m.user_id = actor_id and m.is_active
    order by (m.role = 'owner') desc
    limit 1;
  end if;

  actor_role := case v_member_role
    when 'owner' then 'company_owner'
    when 'contributor' then 'company_contributor'
  end;
end;
$$;

-- Append one audit row for the current caller.
create or replace function private.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_company_id uuid,
  p_summary text,
  p_old_data jsonb,
  p_new_data jsonb,
  p_on_behalf boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
begin
  select * into v_actor from private.audit_actor(p_company_id);
  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, company_id, on_behalf, summary, old_data, new_data
  ) values (
    v_actor.actor_id, v_actor.actor_email, v_actor.actor_role, p_action, p_entity, p_entity_id, p_company_id,
    coalesce(p_on_behalf, false), p_summary, p_old_data, p_new_data
  );
end;
$$;

-- AFTER INSERT/UPDATE/DELETE row trigger.
--   tg_argv[0] company source: 'self' (companies.id) | 'company_id' | 'submission' | 'dimension' | 'none'
--   tg_argv[1] primary-key columns joined by ',' (entity_id = values joined by ':'), default 'id'
--   tg_argv[2] extra columns to ignore when diffing updates (updated_at is always ignored)
-- UPDATE rows store only the changed columns; updates that change nothing (apart from ignored
-- columns) are not logged. on_behalf = a ScaleUp user writing company data.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_source text := coalesce(nullif(tg_argv[0], ''), 'none');
  v_pk_columns text[] := string_to_array(coalesce(nullif(tg_argv[1], ''), 'id'), ',');
  v_ignored text[] := array['updated_at'] || coalesce(string_to_array(nullif(tg_argv[2], ''), ','), array[]::text[]);
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_old_diff jsonb;
  v_new_diff jsonb;
  v_entity_id text;
  v_company_id uuid;
  v_actor record;
  v_context_on_behalf text;
  v_on_behalf boolean;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_old_diff, v_new_diff
    from jsonb_object_keys(v_new) as k
    where k <> all (v_ignored)
      and (v_old -> k) is distinct from (v_new -> k);
    if v_new_diff is null then
      return null; -- no-op update
    end if;
    v_old := v_old_diff;
    v_new := v_new_diff;
  end if;

  select string_agg(v_row ->> c.col, ':' order by c.ord)
    into v_entity_id
  from unnest(v_pk_columns) with ordinality as c(col, ord);

  v_company_id := case v_company_source
    when 'self' then (v_row ->> 'id')::uuid
    when 'company_id' then (v_row ->> 'company_id')::uuid
    when 'submission' then private.submission_company((v_row ->> 'submission_id')::uuid)
    when 'dimension' then private.dimension_company((v_row ->> 'dimension_id')::uuid)
  end;
  v_company_id := coalesce(v_company_id, nullif(current_setting('app.audit_company_id', true), '')::uuid);

  if coalesce(current_setting('app.audit_as_system', true), '') = 'on' then
    select null::uuid as actor_id, null::text as actor_email, 'system'::text as actor_role into v_actor;
  else
    select * into v_actor from private.audit_actor(v_company_id);
  end if;

  v_context_on_behalf := nullif(current_setting('app.audit_on_behalf', true), '');
  if v_context_on_behalf is not null then
    v_on_behalf := v_context_on_behalf::boolean;
  else
    v_on_behalf := tg_table_name in ('submission_values', 'submission_segment_values', 'submission_kpi_values', 'documents')
      and coalesce(v_actor.actor_role in ('super_admin', 'fund_admin', 'partner', 'viewer'), false);
  end if;

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, entity, entity_id, company_id, on_behalf, summary, old_data, new_data
  ) values (
    v_actor.actor_id,
    v_actor.actor_email,
    v_actor.actor_role,
    coalesce(nullif(current_setting('app.audit_action', true), ''), lower(tg_op)),
    tg_table_name,
    v_entity_id,
    v_company_id,
    v_on_behalf,
    nullif(current_setting('app.audit_summary', true), ''),
    case when tg_op = 'INSERT' then null else v_old end,
    case when tg_op = 'DELETE' then null else v_new end
  );
  return null;
end;
$$;

create trigger audit_row_change after insert or update or delete on public.platform_settings
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.funds
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.companies
  for each row execute function private.audit_row_change('self', 'id');
create trigger audit_row_change after insert or update or delete on public.fund_investments
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.company_members
  for each row execute function private.audit_row_change('company_id', 'company_id,user_id');
create trigger audit_row_change after insert or update or delete on public.company_internal
  for each row execute function private.audit_row_change('company_id', 'company_id', 'updated_by');
create trigger audit_row_change after insert or update or delete on public.revenue_segments
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.kpi_dimensions
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.kpi_dimension_members
  for each row execute function private.audit_row_change('dimension', 'id');
create trigger audit_row_change after insert or update or delete on public.company_kpis
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.templates
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.template_versions
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.template_sections
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.template_fields
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.reporting_periods
  for each row execute function private.audit_row_change('none', 'id');
create trigger audit_row_change after insert or update or delete on public.submissions
  for each row execute function private.audit_row_change('company_id', 'id', 'last_saved_at,last_saved_by');
create trigger audit_row_change after insert or update or delete on public.submission_values
  for each row execute function private.audit_row_change('submission', 'submission_id,field_key', 'updated_by');
create trigger audit_row_change after insert or update or delete on public.submission_segment_values
  for each row execute function private.audit_row_change('submission', 'submission_id,segment_id', 'updated_by');
create trigger audit_row_change after insert or update or delete on public.submission_kpi_values
  for each row execute function private.audit_row_change('submission', 'id', 'updated_by');
create trigger audit_row_change after insert or update or delete on public.submission_events
  for each row execute function private.audit_row_change('submission', 'id');
create trigger audit_row_change after insert or update or delete on public.comments
  for each row execute function private.audit_row_change('submission', 'id');
create trigger audit_row_change after insert or update or delete on public.period_closes
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.documents
  for each row execute function private.audit_row_change('company_id', 'id');
create trigger audit_row_change after insert or update or delete on public.fx_rates
  for each row execute function private.audit_row_change('none', 'currency,month', 'updated_by');

-- ---------------------------------------------------------------------------------------------
-- Append-only: UPDATE / DELETE / TRUNCATE fail for every role (statement-level, so even a
-- statement that matches no rows is rejected).
-- ---------------------------------------------------------------------------------------------
create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'The audit log is append-only: entries cannot be changed or deleted.';
end;
$$;

create trigger audit_log_immutable before update or delete or truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- ---------------------------------------------------------------------------------------------
-- public.log_audit_event: app events for the caller that no table change records. Only these
-- actions exist (an allowlist, so nobody can write look-alike workflow entries such as "approved";
-- workflow actions are always written by the database itself):
--   export         any active user (company users only for companies they can see)
--   download       any active user (same)
--   invite, invite_revoke, sign_in_link
--                  Super Admins; a company owner for their own company (p_company_id required)
--   mfa_reset      Super Admins
-- Trusted system callers (service role) may log any of them. The actor is always the caller.
-- ---------------------------------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_company_id uuid default null,
  p_summary text default null,
  p_data jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system boolean := private.is_system();
begin
  if not (v_system or private.is_active_user()) then
    raise exception using errcode = '42501', message = 'Please sign in first.';
  end if;
  if p_action is null
     or p_action not in ('export', 'download', 'invite', 'invite_revoke', 'sign_in_link', 'mfa_reset') then
    raise exception 'The audit action "%" cannot be logged by the app. Use one of: export, download, invite, invite_revoke, sign_in_link, mfa_reset.',
      coalesce(p_action, '');
  end if;
  if p_entity is null or p_entity !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'The audit entity must be a lower-case name of up to 64 characters, such as "documents".';
  end if;
  if p_company_id is not null and not (v_system or private.can_view_company(p_company_id)) then
    raise exception using errcode = '42501', message = 'You do not have access to that company.';
  end if;
  if not v_system then
    if p_action = 'mfa_reset' and not private.has_role('super_admin') then
      raise exception using errcode = '42501', message = 'Only Super Admins can reset two-factor authentication.';
    end if;
    if p_action in ('invite', 'invite_revoke', 'sign_in_link')
       and not (private.has_role('super_admin')
                or (p_company_id is not null and private.company_role(p_company_id) is not distinct from 'owner')) then
      raise exception using errcode = '42501', message = 'Only Super Admins and company owners can manage invitations.';
    end if;
  end if;
  if p_data is not null and octet_length(p_data::text) > 65536 then
    raise exception 'The audit details are too large (64 KB maximum).';
  end if;

  perform private.write_audit(
    p_action, p_entity, p_entity_id, p_company_id, left(p_summary, 2000), null, p_data, false
  );
end;
$$;
