-- =============================================================================================
-- BRD B30 (product owner, 1 Oct 2026): two revenue breakdowns per company. Contract:
-- docs/ARCHITECTURE.md §2.2 (revenue_segments), §2.4 (set_company_revenue_segments,
-- save_submission_values), §2.6 (validation), §2.7 (RLS) — items marked "(B30)".
--
-- * Company revenue segments (revenue_segments.kind = 'company'): the company's OWN breakdown, defined
--   by its owner in the portal (or by a Super Admin / Fund Admin on the owner's behalf), only through
--   public.set_company_revenue_segments(). They add up to total revenue (validation: sum_mismatch) and
--   carry over every month. Months already submitted or approved never change: a renamed segment that
--   already has figures in such a month is retired and continues as a NEW row (a new series), and the
--   months still open for changes (draft, changes requested) switch to the new set.
-- * ScaleUp revenue lines (kind = 'scaleup', which every row that existed before this file becomes):
--   defined by Super Admins and Fund Admins per company with direct table writes, as before. Required
--   every month, but they need not add up to total revenue.
--
-- Applied on top of 20260930000100–000900 and 20261001000100 (deployed). Idempotent: every statement
-- can run again on a database that already has this file. New objects start closed
-- (20260930000800_grants.sql), so this file grants exactly what the app needs. No transaction control
-- (db push wraps the file; db:verify replays it inside its own rolled-back transaction).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- revenue_segments: kind and retired_at
-- ---------------------------------------------------------------------------------------------
alter table public.revenue_segments
  add column if not exists kind text not null default 'scaleup'
    constraint revenue_segments_kind_check check (kind in ('scaleup', 'company'));
alter table public.revenue_segments
  add column if not exists retired_at timestamptz;

-- Segments deactivated before this file: retired when the audit log saw them deactivated (else when
-- they were created).
update public.revenue_segments rs
   set retired_at = coalesce(
         (select max(a.occurred_at)
            from public.audit_log a
           where a.entity = 'revenue_segments'
             and a.entity_id = rs.id::text
             and a.action = 'update'
             and a.new_data ->> 'is_active' = 'false'),
         rs.created_at)
 where not rs.is_active
   and rs.retired_at is null;

alter table public.revenue_segments drop constraint if exists revenue_segments_retired_at_check;
alter table public.revenue_segments
  add constraint revenue_segments_retired_at_check check (is_active = (retired_at is null));

comment on column public.revenue_segments.kind is
  'BRD B30: company = the company''s own revenue segment (defined by its owner through set_company_revenue_segments(); the active ones add up to total revenue); scaleup = a ScaleUp revenue line (Super Admins / Fund Admins; need not add up to total revenue). Never changes.';
comment on column public.revenue_segments.retired_at is
  'When the segment stopped being used (is_active false); maintained by the database. Retired company segments are never reactivated: a renamed segment with submitted figures continues as a new row.';

-- Names are unique per company and kind among the ACTIVE segments, ignoring case (a retired name can be
-- used again). Replaces unique (company_id, name). company_id keeps a plain index (foreign key, lookups).
alter table public.revenue_segments drop constraint if exists revenue_segments_company_id_name_key;
create unique index if not exists revenue_segments_active_name_key
  on public.revenue_segments (company_id, kind, lower(name))
  where is_active;
create index if not exists revenue_segments_company_idx on public.revenue_segments (company_id);

-- ---------------------------------------------------------------------------------------------
-- Guard: the kind never changes; retired_at follows is_active (every caller; trusted system callers
-- may record when a segment was retired, e.g. a data migration).
-- ---------------------------------------------------------------------------------------------
create or replace function private.revenue_segments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'A revenue segment cannot switch between a company segment and a ScaleUp revenue line. Add a new one instead.';
  end if;

  if new.is_active then
    new.retired_at := null;
  elsif tg_op = 'INSERT' or old.is_active then
    if new.retired_at is null or not private.is_system() then
      new.retired_at := now();
    end if;
  elsif new.retired_at is null or not private.is_system() then
    -- Still retired: it keeps the time it was retired.
    new.retired_at := coalesce(old.retired_at, now());
  end if;
  return new;
end;
$$;
comment on function private.revenue_segments_guard() is
  'BRD B30: revenue_segments.kind never changes; retired_at is set when a segment is deactivated and cleared when it is active.';

revoke all on function private.revenue_segments_guard() from public, anon, authenticated;

drop trigger if exists revenue_segments_guard on public.revenue_segments;
create trigger revenue_segments_guard
  before insert or update on public.revenue_segments
  for each row execute function private.revenue_segments_guard();

-- ---------------------------------------------------------------------------------------------
-- RLS: everyone who sees the company reads both kinds (unchanged). Super Admins and Fund Admins still
-- write ScaleUp revenue lines directly; company segments change only through
-- set_company_revenue_segments() (security definer), never through direct writes.
-- ---------------------------------------------------------------------------------------------
drop policy if exists revenue_segments_insert on public.revenue_segments;
create policy revenue_segments_insert on public.revenue_segments
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')) and kind = 'scaleup');

drop policy if exists revenue_segments_update on public.revenue_segments;
create policy revenue_segments_update on public.revenue_segments
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')) and kind = 'scaleup')
  with check ((select private.has_role('super_admin', 'fund_admin')) and kind = 'scaleup');

drop policy if exists revenue_segments_delete on public.revenue_segments;
create policy revenue_segments_delete on public.revenue_segments
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')) and kind = 'scaleup');

-- ---------------------------------------------------------------------------------------------
-- Validation (§2.6) — replaces the segment rules of private.validate_submission():
--   * company revenue segments (kind company): every active one needs a non-negative amount, and total
--     revenue must equal their sum (±0.01) once all have one (sum_mismatch, "… your revenue segments …");
--   * ScaleUp revenue lines (kind scaleup): every active one needs a non-negative amount; no sum rule.
-- Order: system numbers, company segments, sum_mismatch, ScaleUp lines, other template fields, KPI
-- cells, prior_months. Everything else is unchanged. src/lib/validation.ts mirrors it.
-- ---------------------------------------------------------------------------------------------
create or replace function private.validate_submission(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_system record;
  v_label text;
  v_value numeric;
  v_total numeric;
  v_segment record;
  v_segment_count integer := 0;
  v_segment_missing boolean := false;
  v_segment_sum numeric := 0;
  v_field record;
  v_kpi record;
  v_prior text;
begin
  select * into v_submission from public.submissions s where s.id = p_submission_id;
  if not found then
    return null;
  end if;

  -- Rules 1 and 3: required system numbers; non-negative; whole-number headcounts; plus the
  -- field's own validation.min / max.
  for v_system in
    select sf.key, coalesce(f.label, initcap(replace(sf.key, '_', ' '))) as label, sv.value_number,
           sf.field_type, sf.non_negative, f.validation
    from private.system_fields() sf
    left join public.template_fields f
      on f.template_version_id = v_submission.template_version_id and f.key = sf.key
    left join public.submission_values sv
      on sv.submission_id = p_submission_id and sv.field_key = sf.key
    order by sf.sort_order
  loop
    if v_system.value_number is null then
      v_errors := v_errors || jsonb_build_object(
        'target', 'field:' || v_system.key, 'code', 'required', 'message', v_system.label || ' is required.');
    else
      v_errors := v_errors || private.number_issues(
        'field:' || v_system.key, v_system.label, v_system.value_number,
        v_system.field_type = 'integer', v_system.non_negative, v_system.validation);
    end if;
  end loop;

  -- Rules 2 and 3 (BRD B30): every active COMPANY revenue segment needs a non-negative amount, and total
  -- revenue must equal their sum (±0.01). The sum is only compared once every one has an amount.
  for v_segment in
    select rs.id, rs.name, ssv.amount
    from public.revenue_segments rs
    left join public.submission_segment_values ssv
      on ssv.submission_id = p_submission_id and ssv.segment_id = rs.id
    where rs.company_id = v_submission.company_id and rs.is_active and rs.kind = 'company'
    order by rs.sort_order, rs.name, rs.id
  loop
    v_segment_count := v_segment_count + 1;
    if v_segment.amount is null then
      v_segment_missing := true;
      v_errors := v_errors || jsonb_build_object(
        'target', 'segment:' || v_segment.id, 'code', 'required',
        'message', 'Revenue for ' || v_segment.name || ' is required.');
    else
      v_segment_sum := v_segment_sum + v_segment.amount;
      if v_segment.amount < 0 then
        v_errors := v_errors || jsonb_build_object(
          'target', 'segment:' || v_segment.id, 'code', 'negative',
          'message', 'Revenue for ' || v_segment.name || ' cannot be negative.');
      end if;
    end if;
  end loop;

  if v_segment_count > 0 and not v_segment_missing then
    select sv.value_number into v_total
    from public.submission_values sv
    where sv.submission_id = p_submission_id and sv.field_key = 'revenue_total';
    if v_total is not null and abs(v_total - v_segment_sum) > 0.01 then
      select coalesce(f.label, 'Total revenue') into v_label
      from public.template_fields f
      where f.template_version_id = v_submission.template_version_id and f.key = 'revenue_total';
      v_errors := v_errors || jsonb_build_object(
        'target', 'field:revenue_total', 'code', 'sum_mismatch',
        'message', coalesce(v_label, 'Total revenue') || ' (' || private.amount_label(v_total)
          || ') must equal the sum of your revenue segments (' || private.amount_label(v_segment_sum) || ').');
    end if;
  end if;

  -- ScaleUp revenue lines (BRD B30): every active one needs a non-negative amount every month; they
  -- need not add up to total revenue.
  for v_segment in
    select rs.id, rs.name, ssv.amount
    from public.revenue_segments rs
    left join public.submission_segment_values ssv
      on ssv.submission_id = p_submission_id and ssv.segment_id = rs.id
    where rs.company_id = v_submission.company_id and rs.is_active and rs.kind = 'scaleup'
    order by rs.sort_order, rs.name, rs.id
  loop
    if v_segment.amount is null then
      v_errors := v_errors || jsonb_build_object(
        'target', 'segment:' || v_segment.id, 'code', 'required',
        'message', 'Revenue for ' || v_segment.name || ' is required.');
    elsif v_segment.amount < 0 then
      v_errors := v_errors || jsonb_build_object(
        'target', 'segment:' || v_segment.id, 'code', 'negative',
        'message', 'Revenue for ' || v_segment.name || ' cannot be negative.');
    end if;
  end loop;

  -- Rule 4: any other template field marked required needs a value. Number fields that have a
  -- value also follow their type (integer) and validation settings (allow_negative, min, max).
  for v_field in
    select f.key, f.label, f.field_type, f.is_required, f.validation, sv.value_number, sv.value_text, sv.value_json
    from public.template_fields f
    join public.template_sections sec on sec.id = f.section_id
    left join public.submission_values sv on sv.submission_id = p_submission_id and sv.field_key = f.key
    where f.template_version_id = v_submission.template_version_id
      and not exists (select 1 from private.system_fields() sf where sf.key = f.key)
    order by sec.sort_order, sec.key, f.sort_order, f.key
  loop
    if not (
      v_field.value_number is not null
      or coalesce(btrim(v_field.value_text), '') <> ''
      or (v_field.value_json is not null
          and jsonb_typeof(v_field.value_json) <> 'null'
          and v_field.value_json not in ('[]'::jsonb, '{}'::jsonb, '""'::jsonb))
    ) then
      if v_field.is_required then
        v_errors := v_errors || jsonb_build_object(
          'target', 'field:' || v_field.key, 'code', 'required', 'message', v_field.label || ' is required.');
      end if;
    elsif v_field.field_type in ('currency', 'number', 'integer', 'percent', 'rating') then
      v_errors := v_errors || private.number_issues(
        'field:' || v_field.key, v_field.label, v_field.value_number,
        v_field.field_type = 'integer', false, v_field.validation);
    end if;
  end loop;

  -- Rule 5: every active, required KPI (half-yearly only in June and December) needs a value,
  -- per active dimension member when the KPI has a dimension.
  for v_kpi in
    select k.id as kpi_id, k.name as kpi_name, m.id as member_id, m.name as member_name,
           kv.value_number, kv.value_text, kv.value_bool
    from public.company_kpis k
    left join public.kpi_dimension_members m on m.dimension_id = k.dimension_id and m.is_active
    left join public.submission_kpi_values kv
      on kv.submission_id = p_submission_id
     and kv.kpi_id = k.id
     and kv.dimension_member_id is not distinct from m.id
    where k.company_id = v_submission.company_id
      and k.is_active
      and k.is_required
      and (k.frequency = 'monthly' or extract(month from v_submission.month)::int in (6, 12))
      and (k.dimension_id is null or m.id is not null)
    order by k.sort_order, k.name, m.sort_order, m.name
  loop
    if v_kpi.value_number is null and coalesce(btrim(v_kpi.value_text), '') = '' and v_kpi.value_bool is null then
      v_errors := v_errors || jsonb_build_object(
        'target', 'kpi:' || v_kpi.kpi_id || coalesce(':' || v_kpi.member_id, ''),
        'code', 'required',
        'message', v_kpi.kpi_name || coalesce(' (' || v_kpi.member_name || ')', '') || ' is required.');
    end if;
  end loop;

  -- Rule 6: earlier months (from the company's reporting start month) must have been submitted
  -- ("submit months in order"). Without a start month (not yet reporting, months kept from an
  -- earlier start) every earlier draft counts, so the months still go in order.
  select string_agg(private.month_label(s.month), ', ' order by s.month)
    into v_prior
  from public.submissions s
  join public.companies c on c.id = s.company_id
  where s.company_id = v_submission.company_id
    and s.month < v_submission.month
    and (c.reporting_start_month is null or s.month >= c.reporting_start_month)
    and s.status = 'draft';
  if v_prior is not null then
    v_errors := v_errors || jsonb_build_object(
      'target', 'general', 'code', 'prior_months', 'message', 'Submit earlier months first: ' || v_prior || '.');
  end if;

  return v_errors;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- save_submission_values (§2.4) — unchanged except for revenue segments (BRD B30):
--   * an amount can only be entered for an ACTIVE segment of the submission's company (either kind):
--     retired ones are refused with a friendly message (clearing one, amount null, is still allowed);
--   * saving a month that is open for changes also clears the figures it still holds for RETIRED
--     company segments (left from before the month was sent back, after the company changed its
--     segments): an open month follows the company's current segments. ScaleUp lines are left alone
--     (an admin may reactivate a line).
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
  'Company members of an active company, or a Fund Admin on behalf, while the month is draft / changes_requested. Upserts values, segment amounts (active segments only, BRD B30) and KPI cells; empty entries delete. Clears figures of retired company segments from the month. Returns last_saved_at.';

-- ---------------------------------------------------------------------------------------------
-- set_company_revenue_segments (BRD B30): the company owner (of an ACTIVE company, B21) — or a Super
-- Admin / Fund Admin on the owner's behalf, or a trusted system caller — sets the COMPLETE, ordered
-- list of the company's own revenue segments: p_segments = [{ "id"?: uuid, "name": text }, …]
-- (0–50 items; names trimmed, 1–80 characters, no line breaks or tabs, unique ignoring case).
--   * A current segment listed by id with its name unchanged keeps its id (its position is updated).
--   * A current segment listed by id with a NEW name is renamed in place only when it has no figures in
--     a submitted or approved month. Otherwise it is retired and a new segment with the new name
--     replaces it (a new series): the figures of the company's months still open for changes (draft,
--     changes requested) move to the new segment; submitted and approved months keep the old name and
--     figures.
--   * An item without id is added — unless a current segment of that name (ignoring case) is not listed
--     by id: then it is that segment (taken out and put back in the form), so nothing is lost.
--   * Current segments missing from the list are retired; their figures in months still open for
--     changes are cleared.
-- Submitted and approved months never change. Returns the company's active segments, in order.
-- Audited as row changes with a summary per change (on behalf when ScaleUp acts for the owner).
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_company_revenue_segments(p_company_id uuid, p_segments jsonb)
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
  perform private.clear_audit_context();

  return query
    select rs.*
    from public.revenue_segments rs
    where rs.company_id = p_company_id and rs.kind = 'company' and rs.is_active
    order by rs.sort_order, rs.name, rs.id;
end;
$$;
comment on function public.set_company_revenue_segments(uuid, jsonb) is
  'BRD B30: the company owner (active company) or a Super Admin / Fund Admin on behalf sets the complete ordered list of the company''s own revenue segments [{ id?, name }]. Unchanged names keep their id; a rename is in place unless the segment has figures in a submitted or approved month (then a new series replaces it and open months move to it); removed segments are retired and cleared from open months. Submitted and approved months never change. Returns the active company segments in order.';

revoke all on function public.set_company_revenue_segments(uuid, jsonb) from public, anon;
grant execute on function public.set_company_revenue_segments(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The Data API (PostgREST) must see the new function and columns at once. Supabase's DDL event
-- triggers normally ask for this; asking again is harmless. NOTIFY is transactional: it is delivered on
-- commit (never by db:verify's rolled-back run).
-- ---------------------------------------------------------------------------------------------
notify pgrst, 'reload schema';
