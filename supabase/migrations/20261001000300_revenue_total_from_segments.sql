-- =============================================================================================
-- BRD B30 hardening (follow-up, 1 Oct 2026): the database keeps total revenue in step with the
-- company's own revenue segments, and segment changes can be checked for concurrent edits.
-- Contract: docs/ARCHITECTURE.md §2.4 (save_submission_values, set_company_revenue_segments) and §2.6.
--
-- 1. Total revenue follows the company's own revenue segments (revenue_segments.kind = 'company') in
--    every month still open for changes (draft, changes requested): when the figures of the company's
--    segments change in such a month, revenue_total becomes the sum of the amounts present for the
--    company's ACTIVE company segments (and is removed when none is present):
--      * save_submission_values() — after a save that adds, changes or clears company-segment figures
--        (also the figures of retired company segments it clears). Two exceptions keep a total revenue a
--        person gave: a save that sends revenue_total itself keeps exactly what it sends, and a total
--        revenue the month already had while it had no company-segment figures at all (e.g. entered
--        before the company defined its segments) is kept by the save that enters the first ones; after
--        that it follows the figures. The validation still compares total and sum (sum_mismatch).
--      * set_company_revenue_segments() — every open month whose figures it moves (a rename that starts
--        a new series) or clears (a removed segment).
--    A company without active segments of its own keeps whatever total revenue was entered. Submitted
--    and approved months never change. ScaleUp revenue lines (kind = 'scaleup') never count.
-- 2. set_company_revenue_segments(p_company_id, p_segments, p_expected_ids uuid[] default null):
--    optimistic concurrency. With p_expected_ids — the ids of the company segments the caller's list is
--    based on — the call is refused (P0001 "Your revenue segments were changed by someone else. Reload the
--    page to see the latest version.") unless they are, as a set, exactly the company's active company
--    segments at that moment (checked under the function's existing per-company lock). Calls without it
--    behave as before. Adding a parameter changes the signature, so the function is dropped and created
--    again with exactly its previous privileges (EXECUTE: authenticated; never anon or PUBLIC; the service
--    role keeps Supabase's default access), in the same transaction.
--
-- Why the two RPCs and not a trigger on submission_segment_values: set_company_revenue_segments() changes
-- figures in several statements (one segment at a time), so a row trigger would recalculate from
-- half-applied states (e.g. removing every segment would leave the total of the last one standing); a
-- trigger cannot tell a save that sends total revenue itself; and it would also rewrite totals during
-- trusted direct writes (e.g. a data import of historical months). Replacing the two functions keeps the
-- change exactly where segment figures change through the app. Both bodies are those of
-- 20261001000200_revenue_segments_b30.sql with only the additions marked "(B30 hardening)": same
-- signatures (plus the new optional parameter), security definer, search_path, privileges and checks.
--
-- Applied on top of 20260930000100–000900, 20261001000100 and 20261001000200 (deployed). Idempotent: every
-- statement can run again on a database that already has this file. No transaction control (db push
-- wraps the file; db:verify replays it inside its own rolled-back transaction). No data is changed when
-- it is applied (no backfill): open months are recalculated the next time their segment figures change.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Total revenue of one month from the company's own revenue segments (BRD B30): the sum of the amounts
-- present for the company's ACTIVE company segments; removed when there is none. Does nothing for a month
-- that is not open for changes, or when the company has no active segments of its own (total revenue is
-- then entered directly). Writes only when the value changes (no audit row otherwise). Called by the two
-- RPCs below (security definer); not callable through the API. Invoker rights on purpose: called
-- directly by anyone else it could write nothing (no table privilege, RLS).
-- ---------------------------------------------------------------------------------------------
create or replace function private.set_revenue_total_from_segments(p_submission_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_sum numeric;
begin
  select * into v_submission from public.submissions s where s.id = p_submission_id;
  if not found or v_submission.status not in ('draft', 'changes_requested') then
    return; -- submitted and approved months never change
  end if;
  if not exists (
    select 1
    from public.revenue_segments rs
    where rs.company_id = v_submission.company_id and rs.kind = 'company' and rs.is_active
  ) then
    return; -- no segments of its own: total revenue is entered directly
  end if;

  select sum(ssv.amount)
    into v_sum
  from public.submission_segment_values ssv
  join public.revenue_segments rs on rs.id = ssv.segment_id
  where ssv.submission_id = p_submission_id
    and rs.company_id = v_submission.company_id
    and rs.kind = 'company'
    and rs.is_active;

  if v_sum is null then
    delete from public.submission_values sv
    where sv.submission_id = p_submission_id and sv.field_key = 'revenue_total';
    return;
  end if;
  -- What save_submission_values() accepts for total revenue (|value| < 1e15).
  if abs(v_sum) >= 1e15 then
    raise exception 'The revenue segments of % add up to more than total revenue can hold. Check the amounts.',
      private.month_label(v_submission.month);
  end if;
  insert into public.submission_values as sv (
    submission_id, field_key, value_number, value_text, value_json, updated_at, updated_by
  ) values (
    p_submission_id, 'revenue_total', v_sum, null, null, now(), auth.uid()
  )
  on conflict (submission_id, field_key) do update
    set value_number = excluded.value_number,
        value_text = excluded.value_text,
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    where (sv.value_number, sv.value_text, sv.value_json)
          is distinct from (excluded.value_number, excluded.value_text, excluded.value_json);
end;
$$;
comment on function private.set_revenue_total_from_segments(uuid) is
  'BRD B30: sets a month''s revenue_total to the sum of the amounts present for the company''s active company revenue segments (removed when none); nothing for months not open for changes or companies without segments of their own. Used by save_submission_values() and set_company_revenue_segments().';

revoke all on function private.set_revenue_total_from_segments(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- save_submission_values (§2.4) — the body of 20261001000200_revenue_segments_b30.sql, plus (B30
-- hardening) total revenue following the company's own revenue segments: after a save that changed
-- company-segment figures of the month (including the figures of retired company segments it clears),
-- revenue_total is recalculated — unless the save sends revenue_total itself (kept as sent), or the month
-- already had a total revenue but no company-segment figures before this save (kept: a figure entered by
-- a person, before the breakdown). The validation still compares total and sum in those cases.
-- ---------------------------------------------------------------------------------------------
create or replace function public.save_submission_values(
  p_submission_id uuid,
  p_values jsonb default '[]'::jsonb,
  p_segments jsonb default '[]'::jsonb,
  p_kpis jsonb default '[]'::jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_submission public.submissions%rowtype;
  v_company public.companies%rowtype;
  v_item jsonb;
  v_key text;
  v_field public.template_fields%rowtype;
  v_value record;
  v_segment_id uuid;
  v_segment public.revenue_segments%rowtype;
  v_amount numeric;
  v_kpi public.company_kpis%rowtype;
  v_member_id uuid;
  v_dimension_name text;
  v_rows integer;                          -- (B30 hardening) rows written by the last statement
  v_sends_total boolean := false;          -- (B30 hardening) p_values carries revenue_total
  v_had_company_figures boolean;           -- (B30 hardening) company-segment figures before this save
  v_company_figures_changed boolean := false; -- (B30 hardening)
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Please sign in to save this monthly update.';
  end if;

  v_submission := private.require_submission(p_submission_id);
  if not (private.is_company_member(v_submission.company_id) or private.has_role('fund_admin')) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this monthly update.';
  end if;
  v_company := private.require_active_company(v_submission.company_id);
  if v_submission.status = 'submitted' then
    raise exception '% has been submitted and is awaiting review, so it can no longer be edited.',
      private.month_label(v_submission.month);
  elsif v_submission.status = 'approved' then
    raise exception '% is approved and locked. Request an amendment if something needs to change.',
      private.month_label(v_submission.month);
  end if;

  p_values := coalesce(nullif(p_values, 'null'::jsonb), '[]'::jsonb);
  p_segments := coalesce(nullif(p_segments, 'null'::jsonb), '[]'::jsonb);
  p_kpis := coalesce(nullif(p_kpis, 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(p_values) <> 'array' or jsonb_typeof(p_segments) <> 'array' or jsonb_typeof(p_kpis) <> 'array' then
    raise exception 'Values, segments and KPIs must each be sent as a list.';
  end if;

  -- Template fields
  for v_item in select e from jsonb_array_elements(p_values) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'key') is distinct from 'string' then
      raise exception 'Each value needs a field key.';
    end if;
    v_key := v_item ->> 'key';
    select * into v_field
    from public.template_fields f
    where f.template_version_id = v_submission.template_version_id and f.key = v_key;
    if not found then
      raise exception 'Unknown field "%" for this month''s form.', v_key;
    end if;
    if v_key = 'revenue_total' then
      v_sends_total := true; -- (B30 hardening) the caller's own total revenue is kept as sent
    end if;

    select * into v_value from private.coerce_field_value(v_field, v_item);
    if v_value.value_number is null and v_value.value_text is null and v_value.value_json is null then
      delete from public.submission_values sv
      where sv.submission_id = p_submission_id and sv.field_key = v_key;
    else
      insert into public.submission_values as sv (
        submission_id, field_key, value_number, value_text, value_json, updated_at, updated_by
      ) values (
        p_submission_id, v_key, v_value.value_number, v_value.value_text, v_value.value_json, v_now, v_uid
      )
      on conflict (submission_id, field_key) do update
        set value_number = excluded.value_number,
            value_text = excluded.value_text,
            value_json = excluded.value_json,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        where (sv.value_number, sv.value_text, sv.value_json)
              is distinct from (excluded.value_number, excluded.value_text, excluded.value_json);
    end if;
  end loop;

  -- (B30 hardening) Did the month have figures for the company's own segments (active or retired)
  -- before this save?
  v_had_company_figures := exists (
    select 1
    from public.submission_segment_values ssv
    join public.revenue_segments rs on rs.id = ssv.segment_id
    where ssv.submission_id = p_submission_id
      and rs.company_id = v_submission.company_id
      and rs.kind = 'company'
  );

  -- Revenue segments: company segments and ScaleUp lines of this company; amounts only for ACTIVE ones.
  for v_item in select e from jsonb_array_elements(p_segments) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each revenue segment entry must be an object.';
    end if;
    v_segment_id := private.try_uuid(v_item ->> 'segment_id');
    select * into v_segment
    from public.revenue_segments rs
    where rs.id = v_segment_id and rs.company_id = v_submission.company_id;
    if v_segment_id is null or not found then
      raise exception 'That revenue segment does not belong to %.', v_company.name;
    end if;

    if private.json_is_null(v_item -> 'amount') then
      delete from public.submission_segment_values ssv
      where ssv.submission_id = p_submission_id and ssv.segment_id = v_segment_id;
      get diagnostics v_rows = row_count;
    else
      if not v_segment.is_active then
        raise exception '"%" is no longer in use, so revenue can no longer be entered for it. Reload the page to see the current revenue segments.',
          v_segment.name;
      end if;
      if jsonb_typeof(v_item -> 'amount') <> 'number' then
        raise exception 'Segment revenue must be a number.';
      end if;
      v_amount := (v_item ->> 'amount')::numeric;
      if abs(v_amount) >= 1e15 then
        raise exception 'The segment revenue is too large.';
      end if;
      insert into public.submission_segment_values as ssv (submission_id, segment_id, amount, updated_at, updated_by)
      values (p_submission_id, v_segment_id, v_amount, v_now, v_uid)
      on conflict (submission_id, segment_id) do update
        set amount = excluded.amount,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        where ssv.amount is distinct from excluded.amount;
      get diagnostics v_rows = row_count;
    end if;
    if v_rows > 0 and v_segment.kind = 'company' then
      v_company_figures_changed := true; -- (B30 hardening)
    end if;
  end loop;

  -- An open month follows the company's current segments (BRD B30): figures it still holds for retired
  -- company segments (from before it was sent back) are cleared.
  if exists (
    select 1
    from public.submission_segment_values ssv
    join public.revenue_segments rs on rs.id = ssv.segment_id
    where ssv.submission_id = p_submission_id and rs.kind = 'company' and not rs.is_active
  ) then
    perform private.set_audit_context(null, 'Figures of revenue segments no longer in use cleared', null);
    delete from public.submission_segment_values ssv
     using public.revenue_segments rs
     where ssv.submission_id = p_submission_id
       and rs.id = ssv.segment_id
       and rs.kind = 'company'
       and not rs.is_active;
    perform private.clear_audit_context();
    v_company_figures_changed := true; -- (B30 hardening)
  end if;

  -- (B30 hardening) Total revenue follows the company's own revenue segments: recalculated after a change
  -- to their figures, unless this save sends total revenue itself, or the month had a total revenue but no
  -- company-segment figures before this save (a figure a person entered; the validation compares it).
  if v_company_figures_changed and not v_sends_total and (
    v_had_company_figures
    or not exists (
      select 1
      from public.submission_values sv
      where sv.submission_id = p_submission_id and sv.field_key = 'revenue_total' and sv.value_number is not null
    )
  ) then
    perform private.set_audit_context(null, 'Total revenue recalculated from the revenue segments', null);
    perform private.set_revenue_total_from_segments(p_submission_id);
    perform private.clear_audit_context();
  end if;

  -- Company KPIs (KPI of this company; member must belong to the KPI's dimension)
  for v_item in select e from jsonb_array_elements(p_kpis) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each KPI entry must be an object.';
    end if;
    select * into v_kpi
    from public.company_kpis k
    where k.id = private.try_uuid(v_item ->> 'kpi_id') and k.company_id = v_submission.company_id;
    if not found then
      raise exception 'That KPI does not belong to %.', v_company.name;
    end if;

    v_member_id := private.try_uuid(v_item ->> 'dimension_member_id');
    if v_member_id is null and not private.json_is_null(v_item -> 'dimension_member_id') then
      raise exception 'That dimension member is not valid.';
    end if;
    if v_kpi.dimension_id is null then
      if v_member_id is not null then
        raise exception '"%" is not reported per dimension member.', v_kpi.name;
      end if;
    elsif v_member_id is null or not exists (
      select 1 from public.kpi_dimension_members m
      where m.id = v_member_id and m.dimension_id = v_kpi.dimension_id
    ) then
      select d.name into v_dimension_name from public.kpi_dimensions d where d.id = v_kpi.dimension_id;
      raise exception 'Choose a valid % for "%".', lower(coalesce(v_dimension_name, 'dimension member')), v_kpi.name;
    end if;

    select * into v_value from private.coerce_kpi_value(v_kpi, v_item);
    if v_value.value_number is null and v_value.value_text is null and v_value.value_bool is null then
      delete from public.submission_kpi_values kv
      where kv.submission_id = p_submission_id
        and kv.kpi_id = v_kpi.id
        and kv.dimension_member_id is not distinct from v_member_id;
    else
      if v_kpi.frequency = 'half_yearly' and extract(month from v_submission.month)::int not in (6, 12) then
        raise exception '"%" is reported in June and December only.', v_kpi.name;
      end if;
      insert into public.submission_kpi_values as kv (
        submission_id, kpi_id, dimension_member_id, value_number, value_text, value_bool, updated_at, updated_by
      ) values (
        p_submission_id, v_kpi.id, v_member_id, v_value.value_number, v_value.value_text, v_value.value_bool, v_now, v_uid
      )
      on conflict (submission_id, kpi_id, dimension_member_id) do update
        set value_number = excluded.value_number,
            value_text = excluded.value_text,
            value_bool = excluded.value_bool,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        where (kv.value_number, kv.value_text, kv.value_bool)
              is distinct from (excluded.value_number, excluded.value_text, excluded.value_bool);
    end if;
  end loop;

  update public.submissions
     set last_saved_at = v_now, last_saved_by = v_uid
   where id = p_submission_id;
  return v_now;
end;
$$;
comment on function public.save_submission_values(uuid, jsonb, jsonb, jsonb) is
  'Company members of an active company, or a Fund Admin on behalf, while the month is draft / changes_requested. Upserts values, segment amounts (active segments only, BRD B30) and KPI cells; empty entries delete. Clears figures of retired company segments from the month. Total revenue follows the company''s own segments: recalculated after their figures change, unless the save sends revenue_total or the month had a total but no segment figures before. Returns last_saved_at.';

-- ---------------------------------------------------------------------------------------------
-- set_company_revenue_segments (BRD B30) — the body of 20261001000200_revenue_segments_b30.sql, plus
-- (B30 hardening):
--   * p_expected_ids uuid[] default null — the ids of the company's segments the caller's list is based
--     on. When given, they must be (as a set: order and repeats do not matter) exactly the company's
--     active company segments once the per-company lock is held, else P0001 "Your revenue segments were
--     changed by someone else. Reload the page to see the latest version." (null elements never match).
--     Without it the call behaves as before.
--   * the total revenue of every month still open for changes whose figures it moves or clears is
--     recalculated from the segments in use afterwards (left as it is when none are left).
-- The new parameter changes the signature: dropped and created again with exactly the privileges it had
-- (same transaction, so there is no moment without the function).
-- ---------------------------------------------------------------------------------------------
drop function if exists public.set_company_revenue_segments(uuid, jsonb);

create or replace function public.set_company_revenue_segments(
  p_company_id uuid,
  p_segments jsonb,
  p_expected_ids uuid[] default null
)
returns setof public.revenue_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner boolean;
  v_on_behalf boolean;
  v_company public.companies%rowtype;
  v_item jsonb;
  v_pos integer;
  v_raw jsonb;
  v_name text;
  v_id uuid;
  v_items jsonb := '[]'::jsonb;    -- the validated list: [{ pos, id, name }]
  v_open uuid[];                   -- the company's months still open for changes
  v_current public.revenue_segments%rowtype;
  v_new_id uuid;
  v_kept uuid[] := '{}'::uuid[];   -- current segments that stay (unchanged or renamed in place)
  v_reorders jsonb := '[]'::jsonb; -- [{ id, pos }]
  v_renames jsonb := '[]'::jsonb;  -- renamed in place: [{ id, pos, name, old_name }]
  v_replaces jsonb := '[]'::jsonb; -- renamed with submitted figures (new series): [{ id, pos, name, old_name }]
  v_inserts jsonb := '[]'::jsonb;  -- added: [{ pos, name }]
  v_whitespace constant text := ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13);
  v_changed constant text := 'The revenue segments have changed since this page was opened. Reload the page and try again.';
  v_touched uuid[] := '{}'::uuid[]; -- (B30 hardening) open months whose figures move or are cleared
  v_month uuid;                    -- (B30 hardening)
begin
  -- Who: the company's owner, or ScaleUp (Super Admin, Fund Admin) on the owner's behalf. Anyone else
  -- learns nothing about the company (42501 before any lookup).
  v_owner := private.company_role(p_company_id) is not distinct from 'owner'::public.company_role;
  if not (v_owner or private.has_role('super_admin', 'fund_admin') or private.is_system()) then
    raise exception using errcode = '42501', message = 'Only the company owner can change its revenue segments.';
  end if;
  -- Exited / written-off companies are read-only (BRD B21), for ScaleUp too.
  v_company := private.require_active_company(p_company_id);
  v_on_behalf := not v_owner and not private.is_system();

  -- The list.
  if p_segments is null or jsonb_typeof(p_segments) <> 'array' then
    raise exception 'Send the revenue segments as a list.';
  end if;
  if jsonb_array_length(p_segments) > 50 then
    raise exception 'A company can have at most 50 revenue segments.';
  end if;
  for v_item, v_pos in select t.e, t.o::integer from jsonb_array_elements(p_segments) with ordinality as t(e, o) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'name') is distinct from 'string' then
      raise exception 'Each revenue segment needs a name.';
    end if;
    v_name := btrim(v_item ->> 'name', v_whitespace);
    if v_name = '' then
      raise exception 'Each revenue segment needs a name.';
    end if;
    if char_length(v_name) > 80 then
      raise exception 'Revenue segment names can be at most 80 characters.';
    end if;
    if v_name ~ '[\x01-\x1f\x7f]' then
      raise exception 'Revenue segment names cannot contain line breaks or tabs.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) as x(e) where lower(x.e ->> 'name') = lower(v_name)) then
      raise exception 'There are two revenue segments called "%". Give each segment a different name.', v_name;
    end if;

    v_raw := v_item -> 'id';
    v_id := null;
    if not private.json_is_null(v_raw) then
      if jsonb_typeof(v_raw) = 'string' then
        v_id := private.try_uuid(v_raw #>> '{}');
      end if;
      if v_id is null then
        raise exception '%', v_changed;
      end if;
      if exists (select 1 from jsonb_array_elements(v_items) as x(e) where x.e ->> 'id' = v_id::text) then
        raise exception 'Each revenue segment can only be listed once.';
      end if;
    end if;
    v_items := v_items || jsonb_build_object('pos', v_pos, 'id', v_id, 'name', v_name);
  end loop;

  -- One change at a time per company. The months still open for changes are locked like
  -- save_submission_values() locks them, so a save in progress finishes first and later saves see the
  -- new segments.
  perform pg_advisory_xact_lock(hashtextextended('revenue_segments:' || p_company_id::text, 0));
  select coalesce(array_agg(x.id order by x.month), '{}'::uuid[])
    into v_open
  from (
    select s.id, s.month
    from public.submissions s
    where s.company_id = p_company_id and s.status in ('draft', 'changes_requested')
    order by s.month
    for update
  ) as x;
  perform 1
  from public.revenue_segments rs
  where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
  order by rs.id
  for update;

  -- (B30 hardening) Optimistic concurrency: the segments the caller's list is based on must still be the
  -- company's active company segments (compared as sets, now that nobody else can change them).
  if p_expected_ids is not null and exists (
    (select e.id from unnest(p_expected_ids) as e(id)
     except
     select rs.id from public.revenue_segments rs
      where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active)
    union all
    (select rs.id from public.revenue_segments rs
      where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
     except
     select e.id from unnest(p_expected_ids) as e(id))
  ) then
    raise exception 'Your revenue segments were changed by someone else. Reload the page to see the latest version.';
  end if;

  -- What changes.
  for v_item in select x.e from jsonb_array_elements(v_items) as x(e) order by (x.e ->> 'pos')::integer loop
    v_pos := (v_item ->> 'pos')::integer;
    v_name := v_item ->> 'name';
    v_id := (v_item ->> 'id')::uuid;
    if v_id is null then
      -- Named like a current segment that is not listed by id: that segment.
      select rs.id into v_id
      from public.revenue_segments rs
      where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
        and lower(rs.name) = lower(v_name)
        and not exists (select 1 from jsonb_array_elements(v_items) as y(e) where y.e ->> 'id' = rs.id::text);
      if v_id is null then
        v_inserts := v_inserts || jsonb_build_object('pos', v_pos, 'name', v_name);
        continue;
      end if;
    end if;

    select * into v_current
    from public.revenue_segments rs
    where rs.id = v_id and rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active;
    if not found then
      raise exception '%', v_changed;
    end if;

    if v_current.name = v_name then
      v_kept := v_kept || v_id;
      if v_current.sort_order <> v_pos then
        v_reorders := v_reorders || jsonb_build_object('id', v_id, 'pos', v_pos);
      end if;
    elsif not exists (
      select 1
      from public.submission_segment_values ssv
      join public.submissions s on s.id = ssv.submission_id
      where ssv.segment_id = v_id and s.status in ('submitted', 'approved')
    ) then
      v_kept := v_kept || v_id;
      v_renames := v_renames || jsonb_build_object('id', v_id, 'pos', v_pos, 'name', v_name, 'old_name', v_current.name);
    else
      v_replaces := v_replaces || jsonb_build_object('id', v_id, 'pos', v_pos, 'name', v_name, 'old_name', v_current.name);
    end if;
  end loop;

  -- (B30 hardening) The open months holding figures of the segments that are removed (step 1: cleared) or
  -- replaced by a new series (step 5: moved), i.e. every active company segment not kept: their total
  -- revenue is recalculated at the end.
  select coalesce(array_agg(distinct ssv.submission_id), '{}'::uuid[])
    into v_touched
  from public.submission_segment_values ssv
  join public.revenue_segments rs on rs.id = ssv.segment_id
  where ssv.submission_id = any (v_open)
    and rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
    and rs.id <> all (v_kept);

  -- 1. Removed: retired; their figures in months still open for changes are cleared.
  for v_current in
    select rs.*
    from public.revenue_segments rs
    where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
      and rs.id <> all (v_kept)
      and not exists (select 1 from jsonb_array_elements(v_replaces) as x(e) where x.e ->> 'id' = rs.id::text)
    order by rs.sort_order, rs.name, rs.id
  loop
    perform private.set_audit_context(
      null, format('Revenue segment "%s" removed', v_current.name), v_on_behalf, p_company_id);
    update public.revenue_segments set is_active = false where id = v_current.id;
    delete from public.submission_segment_values ssv
    where ssv.segment_id = v_current.id and ssv.submission_id = any (v_open);
  end loop;

  -- 2. Renamed with submitted figures: the old segment is retired (its replacement is added in step 5,
  --    once the names it may take over are free).
  for v_item in select x.e from jsonb_array_elements(v_replaces) as x(e) loop
    perform private.set_audit_context(
      null,
      format('Revenue segment "%s" renamed to "%s" as a new series (submitted months keep "%s")',
        v_item ->> 'old_name', v_item ->> 'name', v_item ->> 'old_name'),
      v_on_behalf, p_company_id);
    update public.revenue_segments set is_active = false where id = (v_item ->> 'id')::uuid;
  end loop;

  -- 3. Renamed in place (no submitted figures). A segment whose current name another one takes over gets
  --    a temporary name first (longer than any real name), so names can be swapped.
  for v_item in select x.e from jsonb_array_elements(v_renames) as x(e) loop
    if exists (
      select 1 from jsonb_array_elements(v_renames) as y(e)
      where y.e ->> 'id' <> v_item ->> 'id' and lower(y.e ->> 'name') = lower(v_item ->> 'old_name')
    ) then
      perform private.set_audit_context(
        null, format('Revenue segment "%s" renamed (temporary name while names are swapped)', v_item ->> 'old_name'),
        v_on_behalf, p_company_id);
      update public.revenue_segments
         set name = '(renaming) ' || id::text || ' ' || id::text
       where id = (v_item ->> 'id')::uuid;
    end if;
  end loop;
  for v_item in select x.e from jsonb_array_elements(v_renames) as x(e) loop
    perform private.set_audit_context(
      null, format('Revenue segment "%s" renamed to "%s"', v_item ->> 'old_name', v_item ->> 'name'),
      v_on_behalf, p_company_id);
    update public.revenue_segments
       set name = v_item ->> 'name', sort_order = (v_item ->> 'pos')::integer
     where id = (v_item ->> 'id')::uuid;
  end loop;

  -- 4. New positions of unchanged segments.
  if jsonb_array_length(v_reorders) > 0 then
    perform private.set_audit_context(null, 'Revenue segments reordered', v_on_behalf, p_company_id);
    update public.revenue_segments rs
       set sort_order = x.pos
      from jsonb_to_recordset(v_reorders) as x(id uuid, pos integer)
     where rs.id = x.id;
  end if;

  -- 5. Replacements of renamed segments (the figures of months still open for changes move to them),
  --    then the new segments.
  for v_item in select x.e from jsonb_array_elements(v_replaces) as x(e) loop
    perform private.set_audit_context(
      null,
      format('Revenue segment "%s" renamed to "%s" as a new series (submitted months keep "%s")',
        v_item ->> 'old_name', v_item ->> 'name', v_item ->> 'old_name'),
      v_on_behalf, p_company_id);
    insert into public.revenue_segments (company_id, kind, name, sort_order)
    values (p_company_id, 'company', v_item ->> 'name', (v_item ->> 'pos')::integer)
    returning id into v_new_id;
    update public.submission_segment_values ssv
       set segment_id = v_new_id
     where ssv.segment_id = (v_item ->> 'id')::uuid
       and ssv.submission_id = any (v_open);
  end loop;
  for v_item in select x.e from jsonb_array_elements(v_inserts) as x(e) loop
    perform private.set_audit_context(
      null, format('Revenue segment "%s" added', v_item ->> 'name'), v_on_behalf, p_company_id);
    insert into public.revenue_segments (company_id, kind, name, sort_order)
    values (p_company_id, 'company', v_item ->> 'name', (v_item ->> 'pos')::integer);
  end loop;

  -- 6. (B30 hardening) Total revenue of the open months whose figures moved or were cleared follows the
  --    segments now in use (left as it is when the company has no segments of its own any more).
  if cardinality(v_touched) > 0 then
    perform private.set_audit_context(
      null, 'Total revenue recalculated from the revenue segments', v_on_behalf, p_company_id);
    foreach v_month in array v_touched loop
      perform private.set_revenue_total_from_segments(v_month);
    end loop;
  end if;
  perform private.clear_audit_context();

  return query
    select rs.*
    from public.revenue_segments rs
    where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
    order by rs.sort_order, rs.name, rs.id;
end;
$$;
comment on function public.set_company_revenue_segments(uuid, jsonb, uuid[]) is
  'BRD B30: the company owner (active company) or a Super Admin / Fund Admin on behalf sets the complete ordered list of the company''s own revenue segments [{ id?, name }]. Unchanged names keep their id; a rename is in place unless the segment has figures in a submitted or approved month (then a new series replaces it and open months move to it); removed segments are retired and cleared from open months, whose total revenue then follows the segments in use. Submitted and approved months never change. Optional p_expected_ids: the ids the list is based on; refused when they are no longer, as a set, the active company segments. Returns the active company segments in order.';

revoke all on function public.set_company_revenue_segments(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.set_company_revenue_segments(uuid, jsonb, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The Data API (PostgREST) must see the recreated function at once. Supabase's DDL event triggers
-- normally ask for this; asking again is harmless. NOTIFY is transactional: it is delivered on commit
-- (never by db:verify's rolled-back run).
-- ---------------------------------------------------------------------------------------------
notify pgrst, 'reload schema';
