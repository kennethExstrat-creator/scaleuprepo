-- =============================================================================================
-- Reporting cycle settings for Fund Admins (BRD A5 "set the due day", B10 "Fund Admin manages … cycles and
-- deadlines") and two-factor authentication that stays on for everyone (BRD §11 "2FA for all users", B11
-- "enforced at database level"). Contract: docs/ARCHITECTURE.md §1, §2.2 (platform_settings), §2.4.
--
-- 1. public.set_cycle_settings(p_due_day, p_backfill_grace_days, p_escalation_days, p_expected_updated_at):
--    Super Admins and Fund Admins (and system callers) change the reporting-cycle columns of
--    platform_settings — due_day, backfill_grace_days, escalation_days — and nothing else. The table itself
--    stays writable by Super Admins only (RLS platform_settings_update). Same ranges as the Settings page
--    (due day 1–28, grace period 1–365 days, escalation 0–365 days); an optional lost-update guard on
--    updated_at. Audited as a row update of platform_settings by the caller ("Reporting cycle settings
--    changed").
-- 2. Trigger platform_settings_mfa_guard: require_mfa can be switched on by anyone allowed to update the
--    row, but switched off only by a trusted system caller (a direct database connection or the service
--    role: the operators' emergency path). Someone who lost their authenticator app gets a 2FA reset
--    instead (Super Admin, /admin/users).
--
-- Applied on top of 20260930000100–000900 and 20261001000100–000300. Idempotent: every statement can run
-- again on a database that already has this file. New objects start closed (20260930000800_grants.sql), so
-- this file grants exactly what the app needs. No transaction control (db push wraps the file; db:verify
-- replays it inside its own rolled-back transaction). No data changes.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. set_cycle_settings
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_cycle_settings(
  p_due_day integer,
  p_backfill_grace_days integer,
  p_escalation_days integer,
  p_expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.platform_settings%rowtype;
  v_changes text[] := '{}'::text[];
begin
  if not (private.has_role('super_admin', 'fund_admin') or private.is_system()) then
    raise exception using errcode = '42501',
      message = 'Only Super Admins and Fund Admins can change the reporting cycle settings.';
  end if;
  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception 'Choose a due day from 1 to 28.';
  end if;
  if p_backfill_grace_days is null or p_backfill_grace_days < 1 or p_backfill_grace_days > 365 then
    raise exception 'Enter a grace period from 1 to 365 days.';
  end if;
  if p_escalation_days is null or p_escalation_days < 0 or p_escalation_days > 365 then
    raise exception 'Enter an escalation period from 0 to 365 days.';
  end if;

  select * into v_row from public.platform_settings s where s.id = 1 for update;
  if not found then
    raise exception 'The platform settings are missing. Ask a Super Admin to check the database.';
  end if;
  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Someone else changed the settings while you were editing. Reload the page to see their changes, then try again.';
  end if;

  if v_row.due_day <> p_due_day then
    v_changes := v_changes || format('due day %s → %s', v_row.due_day, p_due_day);
  end if;
  if v_row.backfill_grace_days <> p_backfill_grace_days then
    v_changes := v_changes || format('grace period %s → %s days', v_row.backfill_grace_days, p_backfill_grace_days);
  end if;
  if v_row.escalation_days <> p_escalation_days then
    v_changes := v_changes || format('escalation %s → %s days', v_row.escalation_days, p_escalation_days);
  end if;
  if cardinality(v_changes) = 0 then
    return v_row.updated_at; -- nothing to change, nothing audited
  end if;

  perform private.set_audit_context(
    null, 'Reporting cycle settings changed: ' || array_to_string(v_changes, ', '), null);
  update public.platform_settings
     set due_day = p_due_day,
         backfill_grace_days = p_backfill_grace_days,
         escalation_days = p_escalation_days
   where id = 1
  returning updated_at into v_row.updated_at;
  perform private.clear_audit_context();
  return v_row.updated_at;
end;
$$;
comment on function public.set_cycle_settings(integer, integer, integer, timestamptz) is
  'BRD A5, B10: Super Admins and Fund Admins set the reporting-cycle columns of platform_settings (due_day 1–28, backfill_grace_days 1–365, escalation_days 0–365) and nothing else; optional lost-update guard on updated_at. Returns the new updated_at. Audited as an update of platform_settings.';

revoke all on function public.set_cycle_settings(integer, integer, integer, timestamptz) from public, anon;
grant execute on function public.set_cycle_settings(integer, integer, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Two-factor authentication stays on (BRD §11, B11)
-- ---------------------------------------------------------------------------------------------
create or replace function private.platform_settings_mfa_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.require_mfa and not new.require_mfa and not private.is_system() then
    raise exception 'Two-factor authentication is required for everyone and can''t be turned off. If someone has lost their authenticator app, reset their two-factor authentication on the Users page.';
  end if;
  return new;
end;
$$;
comment on function private.platform_settings_mfa_guard() is
  'BRD §11, B11: platform_settings.require_mfa can be switched on, but off only by a trusted system caller.';

revoke all on function private.platform_settings_mfa_guard() from public, anon, authenticated;

drop trigger if exists platform_settings_mfa_guard on public.platform_settings;
create trigger platform_settings_mfa_guard
  before update of require_mfa on public.platform_settings
  for each row execute function private.platform_settings_mfa_guard();

-- ---------------------------------------------------------------------------------------------
-- The Data API (PostgREST) must see the new function at once. NOTIFY is transactional: it is delivered on
-- commit (never by db:verify's rolled-back run).
-- ---------------------------------------------------------------------------------------------
notify pgrst, 'reload schema';
