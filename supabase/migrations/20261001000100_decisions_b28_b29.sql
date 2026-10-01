-- =============================================================================================
-- Product-owner decisions of 1 Oct 2026 (BRD §13 B28, B29). Contract: docs/ARCHITECTURE.md §1, §2.2,
-- §2.4, §2.7 (items marked "decisions 2026-10-01").
--
-- B28 — On the company side, ScaleUp people are shown by name with a "(ScaleUp)" label, e.g.
--   "Renuka Sena (ScaleUp)", on comments, timelines, approvals and documents. Never their email or
--   role. Company users still cannot read any ScaleUp staff profile (profiles_select is unchanged) and
--   the partner-in-charge assignment (company_internal) stays ScaleUp-internal: the names come only from
--   public.staff_display_names(ids), which returns nothing but a display name.
-- B29 — Company owners invite new contributors up to platform_settings.owner_contributor_limit
--   (default 4) ACTIVE contributors per company. A pending invitation counts: inviting someone creates
--   their active membership. ScaleUp (staff, i.e. Super Admins as far as RLS lets them write, and
--   system / service-role callers) is not limited. The limit is a Super Admin setting.
--
-- Applied on top of 20260930000100–000900 (deployed). Idempotent: every statement can run again on a
-- database that already has this file. New objects start closed (20260930000800_grants.sql), so this
-- file grants exactly what the app needs. No transaction control (db push wraps the file; db:verify
-- replays it inside its own rolled-back transaction).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- B29: the owners' contributor limit (Super Admin setting; platform_settings is ScaleUp-only, and
-- every signed-in session reads the limit through get_client_settings() below). authenticated's
-- table-level SELECT/UPDATE on platform_settings covers the new column; RLS keeps updates to Super
-- Admins and the row trigger audits changes.
-- ---------------------------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists owner_contributor_limit smallint not null default 4
    constraint platform_settings_owner_contributor_limit_check check (owner_contributor_limit between 0 and 100);

comment on column public.platform_settings.owner_contributor_limit is
  'BRD B29: the most ACTIVE contributors a company owner can have on their team (a pending invitation is an active membership, so it counts); ScaleUp can add more. Super Admin setting, 0–100 (default 4). Enforced by private.company_members_contributor_limit().';
comment on table public.platform_settings is
  'Singleton (id = 1). Readable by ScaleUp staff and updated by Super Admins. Every signed-in session reads require_mfa, terms_version, declaration_text, due_day and owner_contributor_limit through public.get_client_settings().';

-- ---------------------------------------------------------------------------------------------
-- get_client_settings(): what every signed-in session needs from the (ScaleUp-only) settings, now
-- with owner_contributor_limit (the team page shows owners how many places are left). The return
-- shape changes, so the function is dropped and created again with exactly its previous privileges:
-- any session with a user id — also aal1, terms-pending and deactivated ones — or a system caller;
-- never anon. (Same transaction: no moment without the function.)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.get_client_settings();

create function public.get_client_settings()
returns table (
  require_mfa boolean,
  terms_version text,
  declaration_text text,
  due_day smallint,
  owner_contributor_limit smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null and not private.is_system() then
    raise exception using errcode = '42501', message = 'Please sign in first.';
  end if;
  return query
    select s.require_mfa, s.terms_version, s.declaration_text, s.due_day, s.owner_contributor_limit
    from public.platform_settings s
    where s.id = 1;
end;
$$;
comment on function public.get_client_settings() is
  'Any signed-in session (also aal1 / terms pending): require_mfa, terms_version, declaration_text, due_day, owner_contributor_limit from platform_settings (one row).';

revoke all on function public.get_client_settings() from public, anon;
grant execute on function public.get_client_settings() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- B28: display names of ScaleUp staff for the company side.
-- Company-visible rows hold ScaleUp staff ids (submission_events.actor_id, submissions.approved_by,
-- comments.author_id / resolved_by, documents.uploaded_by, period_closes.confirmed_by,
-- company_members.invited_by, …) that company users cannot resolve: their profiles stay hidden
-- (profiles_select), so emails, roles and the partner-in-charge assignment never reach them. This
-- returns, for the ids that belong to ScaleUp staff (a profile WITH a scaleup_role, active or not, so
-- history keeps its names), only "<full name> (ScaleUp)" — or "ScaleUp" when the name is blank — and
-- nothing for any other id. For any signed-in, active user with MFA and the current terms accepted;
-- at most 500 ids per call.
-- ---------------------------------------------------------------------------------------------
create or replace function public.staff_display_names(p_ids uuid[])
returns table (id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'Please sign in first.';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'Ask for at most 500 names at a time.';
  end if;
  return query
    select pr.id,
           coalesce(nullif(btrim(pr.full_name), '') || ' (ScaleUp)', 'ScaleUp')
    from public.profiles pr
    where pr.id = any (p_ids)
      and pr.scaleup_role is not null;
end;
$$;
comment on function public.staff_display_names(uuid[]) is
  'BRD B28: "<full name> (ScaleUp)" (or "ScaleUp" without a name) for the ids that belong to ScaleUp staff; nothing for other ids; never email or role. Signed-in, active, MFA and current terms; at most 500 ids.';

revoke all on function public.staff_display_names(uuid[]) from public, anon;
grant execute on function public.staff_display_names(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- B29: an owner (any caller who is not ScaleUp staff and not a system caller) cannot make the company
-- exceed platform_settings.owner_contributor_limit ACTIVE contributors: inserting an active
-- contributor, reactivating one, changing a member to contributor or moving one to the company.
-- Counts the company's OTHER active contributor rows. Callers who may not manage the company's team
-- are left to Row Level Security (which refuses them), so nothing about another company's team is
-- revealed. Concurrent invitations to one company are serialised (advisory lock), so two of them
-- cannot both take the last place.
-- ---------------------------------------------------------------------------------------------
create or replace function private.company_members_contributor_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_user_id uuid;
  v_limit integer;
  v_others integer;
begin
  -- Only a row that ends up as an ACTIVE contributor can exceed the limit.
  if new.role <> 'contributor' or not new.is_active then
    return new;
  end if;
  -- ScaleUp and trusted system callers (service role, data fixes, the seed) are not limited.
  if private.is_system() or private.is_scaleup() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Already an active contributor of this company: the number of contributors does not change.
    if old.company_id = new.company_id and old.role = 'contributor' and old.is_active then
      return new;
    end if;
    v_old_user_id := old.user_id;
  elsif exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id
      and m.user_id = new.user_id
      and m.role = 'contributor'
      and m.is_active
  ) then
    -- The same active contributor again: a plain insert fails on the primary key, an upsert is
    -- checked as the update it becomes.
    return new;
  end if;

  -- Only owners of the company get this far without being refused by RLS anyway.
  if private.company_role(new.company_id) is distinct from 'owner'::public.company_role then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company_members:contributors:' || new.company_id::text, 0));

  select s.owner_contributor_limit into v_limit from public.platform_settings s where s.id = 1;
  v_limit := coalesce(v_limit, 4); -- the column default, should the settings row ever be missing

  select count(*)::integer into v_others
  from public.company_members m
  where m.company_id = new.company_id
    and m.role = 'contributor'
    and m.is_active
    and m.user_id <> new.user_id
    and m.user_id is distinct from v_old_user_id;

  if v_others >= v_limit then
    if v_others = 0 then
      raise exception 'Only ScaleUp can add contributors to your team. Ask ScaleUp to add them.';
    end if;
    raise exception 'Your team already has % %. Deactivate one, or ask ScaleUp to add more.',
      v_others, case when v_others = 1 then 'contributor' else 'contributors' end;
  end if;
  return new;
end;
$$;
comment on function private.company_members_contributor_limit() is
  'BRD B29: refuses (P0001) a company_members row that would give the company more than platform_settings.owner_contributor_limit active contributors, unless the caller is ScaleUp staff or a system caller.';

revoke all on function private.company_members_contributor_limit() from public, anon, authenticated;

drop trigger if exists company_members_contributor_limit on public.company_members;
create trigger company_members_contributor_limit
  before insert or update on public.company_members
  for each row execute function private.company_members_contributor_limit();

-- ---------------------------------------------------------------------------------------------
-- The Data API (PostgREST) must see the recreated get_client_settings() and the new
-- staff_display_names() at once. Supabase's DDL event triggers normally ask for this; asking again is
-- harmless. NOTIFY is transactional: it is delivered on commit (never by db:verify's rolled-back run).
-- ---------------------------------------------------------------------------------------------
notify pgrst, 'reload schema';
