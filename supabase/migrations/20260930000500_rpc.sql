-- =============================================================================================
-- RPC functions (public, security definer). Contract: docs/ARCHITECTURE.md §2.4 and §2.6.
--
-- Every function re-checks the caller's permission:
--   * permission failures raise SQLSTATE 42501 with a friendly message;
--   * business-rule failures raise P0001 (plain RAISE EXCEPTION) with a friendly British-English
--     message that the UI shows as-is.
-- "System" callers (service_role key, pg_cron, direct database sessions — no end user) may run the
-- admin-only functions; company-side actions always need a signed-in user.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Small shared helpers
-- ---------------------------------------------------------------------------------------------
create or replace function private.clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p_value), '')
$$;

-- Loads and locks a submission the caller may see; otherwise raises 42501 (no existence leak).
create or replace function private.require_submission(p_submission_id uuid)
returns public.submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
begin
  select * into v_submission from public.submissions s where s.id = p_submission_id for update;
  if not found or not (private.is_system() or private.can_view_company(v_submission.company_id)) then
    raise exception using
      errcode = '42501',
      message = 'This monthly update was not found or you do not have access to it.';
  end if;
  return v_submission;
end;
$$;

-- Raises when the company is not active (exited / written-off companies are read-only).
create or replace function private.require_active_company(p_company_id uuid)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
begin
  select * into v_company from public.companies c where c.id = p_company_id;
  if not found then
    raise exception 'That company was not found.';
  end if;
  if v_company.status <> 'active' then
    raise exception '% is no longer an active portfolio company, so its records are read-only.', v_company.name;
  end if;
  return v_company;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reporting periods
-- ---------------------------------------------------------------------------------------------

-- Ensures periods up to p_through (a month), submissions for every active company from its
-- reporting start month, and quarter/half period closes. Returns the number of rows created.
-- Companies without a reporting start month ("Not yet reporting", BRD B16) get no submissions and
-- no closes; once a start month is set, the next call creates the missing months (with the backfill
-- grace period) and closes. Clearing the start month again keeps what exists and opens nothing new.
-- The default template's published version is only looked up when a month's period row actually
-- has to be created, so submissions and closes for months that are already open never depend on
-- the template (e.g. a company onboarded while the default template is being changed).
create or replace function private.ensure_periods(p_through date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.platform_settings%rowtype;
  v_today date := private.today_myt();
  v_start date;
  v_through date := private.month_start(p_through);
  v_missing date[];
  v_version_id uuid;
  v_created integer := 0;
  v_rows integer;
begin
  select * into v_settings from public.platform_settings s where s.id = 1;
  if not found then
    raise exception 'Platform settings are missing. Please contact a Super Admin.';
  end if;

  -- least() ignores nulls, so companies without a start month never pull the start earlier.
  select private.month_start(least(v_settings.default_reporting_start, min(c.reporting_start_month)))
    into v_start
  from public.companies c;

  select array_agg(g.m::date order by g.m)
    into v_missing
  from generate_series(v_start::timestamp, v_through::timestamp, interval '1 month') as g(m)
  where not exists (select 1 from public.reporting_periods p where p.month = g.m::date);

  if v_missing is not null then
    select v.id into v_version_id
    from public.template_versions v
    join public.templates t on t.id = v.template_id
    where t.is_default and v.status = 'published';
    if v_version_id is null then
      raise exception 'Publish the default reporting template before opening reporting months.';
    end if;

    insert into public.reporting_periods (month, due_date, template_version_id)
    select m.month,
           (m.month + interval '1 month')::date + (v_settings.due_day - 1),
           v_version_id
    from unnest(v_missing) as m(month)
    on conflict (month) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end if;

  -- One submission per active, reporting company per open month from its reporting start month.
  -- Months that are already past their due date get a grace period instead (backfill).
  insert into public.submissions (company_id, period_id, month, template_version_id, due_date)
  select c.id,
         p.id,
         p.month,
         p.template_version_id,
         case when v_today > p.due_date then v_today + v_settings.backfill_grace_days else p.due_date end
  from public.companies c
  join public.reporting_periods p on p.month >= c.reporting_start_month
  where c.status = 'active'
    and c.reporting_start_month is not null
  on conflict (company_id, month) do nothing;
  get diagnostics v_rows = row_count;
  v_created := v_created + v_rows;

  -- Quarter closes at Mar/Jun/Sep/Dec, half closes at Jun/Dec (calendar year), once the
  -- period's last month is open for the (active, reporting) company.
  insert into public.period_closes (company_id, period_type, period_start, period_end, label)
  select s.company_id, x.period_type, x.period_start, x.period_end, x.label
  from public.submissions s
  join public.companies c
    on c.id = s.company_id
   and c.status = 'active'
   and c.reporting_start_month is not null
   and s.month >= c.reporting_start_month
  cross join lateral (
    select 'quarter'::public.close_period_type as period_type,
           (s.month - interval '2 months')::date as period_start,
           (s.month + interval '1 month' - interval '1 day')::date as period_end,
           'Q' || (extract(month from s.month)::int / 3) || ' ' || extract(year from s.month)::int as label
    where extract(month from s.month)::int % 3 = 0
    union all
    select 'half'::public.close_period_type,
           (s.month - interval '5 months')::date,
           (s.month + interval '1 month' - interval '1 day')::date,
           'H' || (extract(month from s.month)::int / 6) || ' ' || extract(year from s.month)::int
    where extract(month from s.month)::int % 6 = 0
  ) as x
  on conflict (company_id, period_type, period_start) do nothing;
  get diagnostics v_rows = row_count;
  v_created := v_created + v_rows;

  return v_created;
end;
$$;

create or replace function public.open_due_periods()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  -- Any signed-in, active user (MFA satisfied) or a trusted system caller (pg_cron, service role).
  if not (private.is_system() or private.is_active_user()) then
    raise exception using errcode = '42501', message = 'Please sign in first.';
  end if;

  -- Automatic work for the whole portfolio: audited as the system, not as whichever user's page
  -- load happened to trigger it (it creates other companies' months too).
  perform private.set_audit_context(null, 'Opened automatically', false, null, true);
  -- Up to the last completed month in Malaysia time.
  v_created := private.ensure_periods((private.month_start(private.today_myt()) - interval '1 month')::date);
  perform private.clear_audit_context();
  -- The count is portfolio-wide, so company users get 0 (it would reveal the portfolio size).
  if private.is_system() or private.is_scaleup() then
    return v_created;
  end if;
  return 0;
end;
$$;
comment on function public.open_due_periods() is
  'Idempotent. Opens every month up to the last completed month (MYT): periods, submissions for active companies with a reporting start month, quarter/half closes. Returns rows created (always 0 for company users).';

create or replace function public.open_period(p_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_current date := private.month_start(private.today_myt());
  v_start date;
  v_version_id uuid;
  v_settings public.platform_settings%rowtype;
  v_period_id uuid;
begin
  if not private.has_role_or_system('super_admin', 'fund_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins and Fund Admins can open reporting months.';
  end if;
  if p_month is null then
    raise exception 'Choose a month to open.';
  end if;

  v_month := private.month_start(p_month);
  if v_month > v_current then
    raise exception 'Only months up to the current month (%) can be opened.', private.month_label(v_current);
  end if;

  select * into v_settings from public.platform_settings s where s.id = 1;
  if not found then
    raise exception 'Platform settings are missing. Please contact a Super Admin.';
  end if;
  select private.month_start(least(v_settings.default_reporting_start, min(c.reporting_start_month)))
    into v_start
  from public.companies c;
  if v_month < v_start then
    raise exception 'Months before % cannot be opened.', private.month_label(v_start);
  end if;

  -- (The template is only needed when the month's period row does not exist yet.)
  if not exists (select 1 from public.reporting_periods p where p.month = v_month) then
    select v.id into v_version_id
    from public.template_versions v
    join public.templates t on t.id = v.template_id
    where t.is_default and v.status = 'published';
    if v_version_id is null then
      raise exception 'Publish the default reporting template before opening reporting months.';
    end if;

    perform private.set_audit_context('open_period', 'Opened ' || private.month_label(v_month) || ' early', false);
    insert into public.reporting_periods (month, due_date, template_version_id, opened_by)
    values (
      v_month,
      (v_month + interval '1 month')::date + (v_settings.due_day - 1),
      v_version_id,
      auth.uid()
    )
    on conflict (month) do nothing;
  end if;

  perform private.set_audit_context(null, 'Opened with ' || private.month_label(v_month), false);
  perform private.ensure_periods(greatest(v_month, (v_current - interval '1 month')::date));
  perform private.clear_audit_context();

  select p.id into v_period_id from public.reporting_periods p where p.month = v_month;
  return v_period_id;
end;
$$;
comment on function public.open_period(date) is
  'Super Admin / Fund Admin: opens a month early (up to the current MYT month) with the same side effects as open_due_periods(). Returns the period id.';

-- ---------------------------------------------------------------------------------------------
-- Validation (§2.6) — private.validate_submission() is the source of truth.
-- Returns a JSON array of { target, code, message } in a stable order:
--   system numbers (required / negative / not_integer / out_of_range), revenue segments
--   (required / negative), sum_mismatch, the other template fields in template order (required, or
--   negative / not_integer / out_of_range for numbers), company KPIs, prior_months.
-- ---------------------------------------------------------------------------------------------

-- Number rules for one stored value, in this order (src/lib/validation.ts mirrors them):
--   negative      below zero where the field cannot be negative: the non-negative system figures,
--                 validation {"allow_negative": false} or {"min": 0}
--   not_integer   integer fields (the headcounts and custom `integer` fields)
--   out_of_range  below validation.min / above validation.max (not repeated when already negative)
create or replace function private.number_issues(
  p_target text,
  p_label text,
  p_value numeric,
  p_whole boolean,
  p_non_negative boolean,
  p_validation jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_issues jsonb := '[]'::jsonb;
  v_min numeric;
  v_max numeric;
  v_negative boolean := false;
begin
  if p_value is null then
    return v_issues;
  end if;
  if jsonb_typeof(p_validation -> 'min') = 'number' then
    v_min := (p_validation ->> 'min')::numeric;
  end if;
  if jsonb_typeof(p_validation -> 'max') = 'number' then
    v_max := (p_validation ->> 'max')::numeric;
  end if;

  if p_value < 0 and (
    coalesce(p_non_negative, false)
    or coalesce(p_validation -> 'allow_negative' = 'false'::jsonb, false)
    or coalesce(v_min = 0, false)
  ) then
    v_negative := true;
    v_issues := v_issues || jsonb_build_object(
      'target', p_target, 'code', 'negative', 'message', p_label || ' cannot be negative.');
  end if;
  if coalesce(p_whole, false) and p_value <> trunc(p_value) then
    v_issues := v_issues || jsonb_build_object(
      'target', p_target, 'code', 'not_integer', 'message', p_label || ' must be a whole number.');
  end if;
  if not v_negative then
    if v_min is not null and v_max is not null and (p_value < v_min or p_value > v_max) then
      v_issues := v_issues || jsonb_build_object(
        'target', p_target, 'code', 'out_of_range',
        'message', p_label || ' must be between ' || private.number_label(v_min) || ' and ' || private.number_label(v_max) || '.');
    elsif v_min is not null and p_value < v_min then
      v_issues := v_issues || jsonb_build_object(
        'target', p_target, 'code', 'out_of_range',
        'message', p_label || ' must be at least ' || private.number_label(v_min) || '.');
    elsif v_max is not null and p_value > v_max then
      v_issues := v_issues || jsonb_build_object(
        'target', p_target, 'code', 'out_of_range',
        'message', p_label || ' must be at most ' || private.number_label(v_max) || '.');
    end if;
  end if;
  return v_issues;
end;
$$;

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

  -- Rules 2 and 3: every active revenue segment needs a non-negative amount, and total revenue must
  -- equal their sum (±0.01). The sum is only compared once every active segment has an amount.
  for v_segment in
    select rs.id, rs.name, ssv.amount
    from public.revenue_segments rs
    left join public.submission_segment_values ssv
      on ssv.submission_id = p_submission_id and ssv.segment_id = rs.id
    where rs.company_id = v_submission.company_id and rs.is_active
    order by rs.sort_order, rs.name
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
          || ') must equal the sum of the revenue segments (' || private.amount_label(v_segment_sum) || ').');
    end if;
  end if;

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

create or replace function public.get_submission_validation(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company_id uuid := private.submission_company(p_submission_id);
  v_errors jsonb;
begin
  if v_company_id is null or not (private.is_system() or private.can_view_company(v_company_id)) then
    raise exception using
      errcode = '42501',
      message = 'This monthly update was not found or you do not have access to it.';
  end if;
  v_errors := private.validate_submission(p_submission_id);
  return jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'errors', v_errors);
end;
$$;
comment on function public.get_submission_validation(uuid) is
  'Returns { ok, errors: [{ target, code, message }] } for a submission the caller can view. Codes: required, negative, not_integer, out_of_range, sum_mismatch, prior_months.';

-- ---------------------------------------------------------------------------------------------
-- Saving values
-- ---------------------------------------------------------------------------------------------

-- Validates one p_values entry against its template field and returns the typed storage columns
-- (all null = the entry is empty and the stored value is deleted).
create or replace function private.coerce_field_value(
  p_field public.template_fields,
  p_item jsonb,
  out value_number numeric,
  out value_text text,
  out value_json jsonb
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_number jsonb := p_item -> 'value_number';
  v_text jsonb := p_item -> 'value_text';
  v_json jsonb := p_item -> 'value_json';
  v_label text := p_field.label;
  v_options jsonb := p_field.options -> 'options';
  v_min numeric;
  v_max numeric;
  v_max_length integer;
  v_element jsonb;
begin
  if p_field.field_type in ('currency', 'number', 'integer', 'percent', 'rating') then
    if not private.json_is_null(v_text) or not private.json_is_null(v_json) then
      raise exception '"%" expects a number.', v_label;
    end if;
    if private.json_is_null(v_number) then
      return;
    end if;
    if jsonb_typeof(v_number) <> 'number' then
      raise exception '"%" expects a number.', v_label;
    end if;
    value_number := (v_number #>> '{}')::numeric;
    if abs(value_number) >= 1e15 then
      raise exception 'The value for "%" is too large.', v_label;
    end if;
    if p_field.field_type = 'rating' then
      v_min := coalesce((p_field.options ->> 'min')::numeric, 1);
      v_max := coalesce((p_field.options ->> 'max')::numeric, 5);
      if value_number <> trunc(value_number) or value_number < v_min or value_number > v_max then
        raise exception '"%" must be a whole number from % to %.', v_label, v_min, v_max;
      end if;
    end if;
    return;
  end if;

  if p_field.field_type in ('text', 'long_text', 'picklist') then
    if not private.json_is_null(v_number) or not private.json_is_null(v_json) then
      raise exception '"%" expects text.', v_label;
    end if;
    if private.json_is_null(v_text) then
      return;
    end if;
    if jsonb_typeof(v_text) <> 'string' then
      raise exception '"%" expects text.', v_label;
    end if;
    value_text := v_text #>> '{}';
    if btrim(value_text) = '' then
      value_text := null;
      return;
    end if;
    -- Explicit validation.max_length, else a generous safety cap.
    v_max_length := coalesce((p_field.validation ->> 'max_length')::integer, 20000);
    if char_length(value_text) > v_max_length then
      raise exception '"%" is too long (% characters maximum).', v_label, v_max_length;
    end if;
    if p_field.field_type = 'picklist' and jsonb_typeof(v_options) = 'array' and not (v_options ? value_text) then
      raise exception 'Choose one of the listed options for "%".', v_label;
    end if;
    return;
  end if;

  -- tags / boolean → value_json
  if not private.json_is_null(v_number) or not private.json_is_null(v_text) then
    raise exception '"%" has the wrong type of value.', v_label;
  end if;
  if private.json_is_null(v_json) then
    return;
  end if;
  if p_field.field_type = 'boolean' then
    if jsonb_typeof(v_json) <> 'boolean' then
      raise exception '"%" must be yes or no.', v_label;
    end if;
    value_json := v_json;
    return;
  end if;

  if jsonb_typeof(v_json) <> 'array' then
    raise exception '"%" expects a list of tags.', v_label;
  end if;
  if jsonb_array_length(v_json) = 0 then
    return;
  end if;
  if jsonb_array_length(v_json) > 50 then
    raise exception '"%" can have at most 50 tags.', v_label;
  end if;
  for v_element in select e from jsonb_array_elements(v_json) as t(e) loop
    if jsonb_typeof(v_element) <> 'string' then
      raise exception '"%" expects a list of tags.', v_label;
    end if;
    if jsonb_typeof(v_options) = 'array' and not (v_options ? (v_element #>> '{}')) then
      raise exception '"%" is not one of the tags for "%".', v_element #>> '{}', v_label;
    end if;
  end loop;
  value_json := v_json;
end;
$$;

-- Same for one p_kpis entry (value column chosen by the KPI's value_type).
create or replace function private.coerce_kpi_value(
  p_kpi public.company_kpis,
  p_item jsonb,
  out value_number numeric,
  out value_text text,
  out value_bool boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_number jsonb := p_item -> 'value_number';
  v_text jsonb := p_item -> 'value_text';
  v_bool jsonb := p_item -> 'value_bool';
begin
  if p_kpi.value_type in ('number', 'integer', 'currency', 'percent') then
    if not private.json_is_null(v_text) or not private.json_is_null(v_bool) then
      raise exception '"%" expects a number.', p_kpi.name;
    end if;
    if private.json_is_null(v_number) then
      return;
    end if;
    if jsonb_typeof(v_number) <> 'number' then
      raise exception '"%" expects a number.', p_kpi.name;
    end if;
    value_number := (v_number #>> '{}')::numeric;
    if abs(value_number) >= 1e15 then
      raise exception 'The value for "%" is too large.', p_kpi.name;
    end if;
    if p_kpi.value_type = 'integer' and value_number <> trunc(value_number) then
      raise exception '"%" must be a whole number.', p_kpi.name;
    end if;
  elsif p_kpi.value_type = 'text' then
    if not private.json_is_null(v_number) or not private.json_is_null(v_bool) then
      raise exception '"%" expects text.', p_kpi.name;
    end if;
    if private.json_is_null(v_text) then
      return;
    end if;
    if jsonb_typeof(v_text) <> 'string' then
      raise exception '"%" expects text.', p_kpi.name;
    end if;
    value_text := private.clean_text(v_text #>> '{}');
    if value_text is not null then
      value_text := v_text #>> '{}';
      if char_length(value_text) > 2000 then
        raise exception '"%" is too long (2,000 characters maximum).', p_kpi.name;
      end if;
    end if;
  else
    if not private.json_is_null(v_number) or not private.json_is_null(v_text) then
      raise exception '"%" must be yes or no.', p_kpi.name;
    end if;
    if private.json_is_null(v_bool) then
      return;
    end if;
    if jsonb_typeof(v_bool) <> 'boolean' then
      raise exception '"%" must be yes or no.', p_kpi.name;
    end if;
    value_bool := (v_bool #>> '{}')::boolean;
  end if;
end;
$$;

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

  -- Revenue segments (must belong to this company)
  for v_item in select e from jsonb_array_elements(p_segments) as t(e) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each revenue segment entry must be an object.';
    end if;
    v_segment_id := private.try_uuid(v_item ->> 'segment_id');
    if v_segment_id is null or not exists (
      select 1 from public.revenue_segments rs
      where rs.id = v_segment_id and rs.company_id = v_submission.company_id
    ) then
      raise exception 'That revenue segment does not belong to %.', v_company.name;
    end if;

    if private.json_is_null(v_item -> 'amount') then
      delete from public.submission_segment_values ssv
      where ssv.submission_id = p_submission_id and ssv.segment_id = v_segment_id;
    else
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
  'Company members of an active company, or a Fund Admin on behalf, while the month is draft / changes_requested. Upserts values, segment amounts and KPI cells; empty entries delete. Returns last_saved_at.';

-- ---------------------------------------------------------------------------------------------
-- Submission workflow
-- ---------------------------------------------------------------------------------------------

-- A month sent back to the company (request_changes, reopen_submission) is due no earlier than
-- backfill_grace_days from today, like a month that opens late (BRD B4). Otherwise it would be
-- overdue — and escalated — the moment ScaleUp sends it back after its original due date.
create or replace function private.send_back_due_date(p_due_date date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    p_due_date,
    private.today_myt() + coalesce((select s.backfill_grace_days from public.platform_settings s where s.id = 1), 14)::int
  )
$$;

-- A confirmed quarter / half close whose month is sent back no longer matches the data: it is
-- reopened (audited as action 'reopen' with the reason), so the company confirms it again once the
-- month is resubmitted. Restated totals and their reason are kept, as in reopen_period_close().
create or replace function private.reopen_confirmed_closes(p_company_id uuid, p_month date, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_close record;
begin
  for v_close in
    select pc.id, pc.label
    from public.period_closes pc
    where pc.company_id = p_company_id
      and pc.status = 'confirmed'
      and p_month between pc.period_start and pc.period_end
    order by pc.period_start desc, pc.period_type
    for update
  loop
    perform private.set_audit_context('reopen', 'Reopened ' || v_close.label || ': ' || p_why, false);
    update public.period_closes
       set status = 'open', confirmed_at = null, confirmed_by = null, computed_totals = null
     where id = v_close.id;
  end loop;
  perform private.clear_audit_context();
end;
$$;

create or replace function public.submit_submission(p_submission_id uuid, p_declaration_accepted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_errors jsonb;
  v_prior jsonb;
  v_count integer;
  v_revision integer;
  v_declaration text;
begin
  v_submission := private.require_submission(p_submission_id);
  if private.company_role(v_submission.company_id) is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Only the company owner can submit monthly updates.';
  end if;
  perform private.require_active_company(v_submission.company_id);
  if v_submission.status = 'submitted' then
    raise exception '% has already been submitted.', private.month_label(v_submission.month);
  elsif v_submission.status = 'approved' then
    raise exception '% is approved and locked.', private.month_label(v_submission.month);
  end if;
  if not coalesce(p_declaration_accepted, false) then
    raise exception 'Please confirm the declaration before submitting.';
  end if;

  v_errors := private.validate_submission(p_submission_id);
  v_count := jsonb_array_length(v_errors);
  if v_count > 0 then
    select e into v_prior from jsonb_array_elements(v_errors) as t(e) where e ->> 'code' = 'prior_months' limit 1;
    if v_prior is not null then
      raise exception '%', v_prior ->> 'message';
    elsif v_count = 1 then
      raise exception '%', v_errors -> 0 ->> 'message';
    else
      raise exception 'Please fix % issues before submitting, starting with: %', v_count, v_errors -> 0 ->> 'message';
    end if;
  end if;

  select s.declaration_text into v_declaration from public.platform_settings s where s.id = 1;
  v_revision := v_submission.revision + 1;

  perform private.set_audit_context(
    'submit',
    case when v_revision > 1
      then 'Resubmitted ' || private.month_label(v_submission.month) || ' (revision ' || v_revision || ')'
      else 'Submitted ' || private.month_label(v_submission.month)
    end,
    false);
  update public.submissions
     set status = 'submitted',
         submitted_at = now(),
         submitted_by = auth.uid(),
         declaration_text = v_declaration,
         revision = v_revision,
         approved_at = null,
         approved_by = null
   where id = p_submission_id;
  perform private.clear_audit_context();

  insert into public.submission_events (submission_id, event, actor_id)
  values (p_submission_id, case when v_revision > 1 then 'resubmitted' else 'submitted' end, auth.uid());
end;
$$;
comment on function public.submit_submission(uuid, boolean) is
  'Company owner: draft / changes_requested → submitted once the declaration is accepted and validation passes. revision += 1; event submitted (revision 1) or resubmitted.';

create or replace function public.request_changes(p_submission_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_message text := private.clean_text(p_message);
  v_due date;
begin
  v_submission := private.require_submission(p_submission_id);
  if not private.has_role('super_admin', 'fund_admin', 'partner') then
    raise exception using errcode = '42501', message = 'Only ScaleUp reviewers can request changes.';
  end if;
  -- Exited / written-off companies are read-only: nothing can be sent back (BRD B21).
  perform private.require_active_company(v_submission.company_id);
  if v_submission.status <> 'submitted' then
    raise exception 'Only submitted updates can be sent back for changes.';
  end if;
  if v_message is null then
    raise exception 'Please explain what needs to change.';
  end if;
  if char_length(v_message) > 5000 then
    raise exception 'Please keep the message under 5,000 characters.';
  end if;

  v_due := private.send_back_due_date(v_submission.due_date);
  perform private.set_audit_context(
    'request_changes', 'Changes requested for ' || private.month_label(v_submission.month), false);
  update public.submissions
     set status = 'changes_requested',
         original_due_date = case when v_due > due_date then coalesce(original_due_date, due_date) else original_due_date end,
         due_date = v_due
   where id = p_submission_id;
  perform private.clear_audit_context();

  perform private.reopen_confirmed_closes(
    v_submission.company_id, v_submission.month, private.month_label(v_submission.month) || ' was sent back for changes');

  insert into public.submission_events (submission_id, event, actor_id, message)
  values (p_submission_id, 'changes_requested', auth.uid(), v_message);
end;
$$;
comment on function public.request_changes(uuid, text) is
  'Super Admin / Fund Admin / Partner, active companies only: submitted → changes_requested with a required message. The month is due no earlier than backfill_grace_days from today; a confirmed close covering it is reopened.';

create or replace function public.approve_submission(p_submission_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_message text := private.clean_text(p_message);
begin
  v_submission := private.require_submission(p_submission_id);
  if not (private.has_role('super_admin') or private.is_partner_of(v_submission.company_id)) then
    raise exception using errcode = '42501',
      message = 'Only the partner-in-charge or a Super Admin can approve this update.';
  end if;
  if v_submission.status <> 'submitted' then
    raise exception 'Only submitted updates can be approved.';
  end if;
  if char_length(v_message) > 5000 then
    raise exception 'Please keep the message under 5,000 characters.';
  end if;

  perform private.set_audit_context('approve', 'Approved ' || private.month_label(v_submission.month), false);
  update public.submissions
     set status = 'approved', approved_at = now(), approved_by = auth.uid()
   where id = p_submission_id;
  perform private.clear_audit_context();

  insert into public.submission_events (submission_id, event, actor_id, message)
  values (p_submission_id, 'approved', auth.uid(), v_message);
end;
$$;
comment on function public.approve_submission(uuid, text) is
  'Super Admin, or the Partner who is the company''s partner-in-charge (company_internal): submitted → approved (month locked). Also for exited / written-off companies, so ScaleUp can finalise their history.';

create or replace function public.reopen_submission(p_submission_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_reason text := private.clean_text(p_reason);
  v_due date;
begin
  v_submission := private.require_submission(p_submission_id);
  if not (private.has_role_or_system('super_admin', 'fund_admin') or private.is_partner_of(v_submission.company_id)) then
    raise exception using errcode = '42501',
      message = 'Only a Super Admin, a Fund Admin or the partner-in-charge can reopen an approved month.';
  end if;
  -- Exited / written-off companies are read-only: nothing can be sent back (BRD B21).
  perform private.require_active_company(v_submission.company_id);
  if v_submission.status <> 'approved' then
    raise exception 'Only approved months can be reopened.';
  end if;
  if v_reason is null then
    raise exception 'Please give a reason for reopening this month.';
  end if;
  if char_length(v_reason) > 5000 then
    raise exception 'Please keep the reason under 5,000 characters.';
  end if;

  v_due := private.send_back_due_date(v_submission.due_date);
  perform private.set_audit_context(
    'reopen', 'Reopened ' || private.month_label(v_submission.month) || ': ' || v_reason, false);
  update public.submissions
     set status = 'changes_requested',
         approved_at = null,
         approved_by = null,
         original_due_date = case when v_due > due_date then coalesce(original_due_date, due_date) else original_due_date end,
         due_date = v_due
   where id = p_submission_id;
  perform private.clear_audit_context();

  perform private.reopen_confirmed_closes(
    v_submission.company_id, v_submission.month, private.month_label(v_submission.month) || ' was reopened');

  insert into public.submission_events (submission_id, event, actor_id, message)
  values (p_submission_id, 'reopened', auth.uid(), v_reason);
end;
$$;
comment on function public.reopen_submission(uuid, text) is
  'Super Admin / Fund Admin / partner-in-charge, active companies only: approved → changes_requested with a required reason. Needs re-approval. The month is due no earlier than backfill_grace_days from today; a confirmed close covering it is reopened.';

create or replace function public.request_amendment(p_submission_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_reason text := private.clean_text(p_reason);
begin
  v_submission := private.require_submission(p_submission_id);
  if private.company_role(v_submission.company_id) is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'Only the company owner can request an amendment.';
  end if;
  perform private.require_active_company(v_submission.company_id);
  if v_submission.status <> 'approved' then
    raise exception 'Amendments can only be requested for approved months.';
  end if;
  if v_reason is null then
    raise exception 'Please describe the amendment you need.';
  end if;
  if char_length(v_reason) > 4900 then
    raise exception 'Please keep the description under 4,900 characters.';
  end if;

  perform private.set_audit_context(
    'request_amendment', 'Amendment requested for ' || private.month_label(v_submission.month), false);
  insert into public.comments (submission_id, parent_id, target, visibility, author_id, body)
  values (p_submission_id, null, 'general', 'shared', auth.uid(), 'Amendment requested: ' || v_reason);
  perform private.clear_audit_context();

  insert into public.submission_events (submission_id, event, actor_id, message)
  values (p_submission_id, 'amendment_requested', auth.uid(), v_reason);
end;
$$;
comment on function public.request_amendment(uuid, text) is
  'Company owner, approved month: adds a shared "Amendment requested: …" thread and an amendment_requested event.';

create or replace function public.extend_due_date(p_submission_id uuid, p_new_due_date date, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_reason text := private.clean_text(p_reason);
begin
  v_submission := private.require_submission(p_submission_id);
  if not private.has_role_or_system('super_admin', 'fund_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins and Fund Admins can extend deadlines.';
  end if;
  -- Exited / written-off companies are read-only (BRD B21).
  perform private.require_active_company(v_submission.company_id);
  if v_submission.status = 'approved' then
    raise exception 'Approved months cannot have their deadline extended.';
  end if;
  if p_new_due_date is null then
    raise exception 'Choose the new due date.';
  end if;
  if p_new_due_date <= v_submission.due_date then
    raise exception 'The new due date must be after the current due date (%).', private.date_label(v_submission.due_date);
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'Please keep the reason under 2,000 characters.';
  end if;

  perform private.set_audit_context(
    'extend_due_date',
    'Due date for ' || private.month_label(v_submission.month) || ' extended to ' || private.date_label(p_new_due_date),
    false);
  update public.submissions
     set original_due_date = coalesce(original_due_date, due_date),
         due_date = p_new_due_date,
         extension_reason = v_reason
   where id = p_submission_id;
  perform private.clear_audit_context();

  insert into public.submission_events (submission_id, event, actor_id, message)
  values (
    p_submission_id,
    'deadline_extended',
    auth.uid(),
    'Due date extended to ' || private.date_label(p_new_due_date) || '.' || coalesce(' Reason: ' || v_reason, '')
  );
end;
$$;
comment on function public.extend_due_date(uuid, date, text) is
  'Super Admin / Fund Admin, active companies only, not for approved months: sets original_due_date (first time), due_date, extension_reason; event deadline_extended.';

-- ---------------------------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------------------------
create or replace function public.resolve_comment(p_comment_id uuid, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment public.comments%rowtype;
  v_found boolean;
  v_company_id uuid;
begin
  select * into v_comment from public.comments c where c.id = p_comment_id for update;
  v_found := found;
  if v_found then
    v_company_id := private.submission_company(v_comment.submission_id);
  end if;
  if not v_found or not (
    private.is_scaleup()
    or (v_comment.visibility = 'shared' and private.is_company_member(v_company_id))
  ) then
    raise exception using errcode = '42501', message = 'This comment was not found or you do not have access to it.';
  end if;
  if v_comment.parent_id is not null then
    raise exception 'Only whole threads can be resolved. Resolve the first comment of the thread instead.';
  end if;
  if not (
    private.has_role('super_admin', 'fund_admin', 'partner')
    or (v_comment.visibility = 'shared' and private.is_company_member(v_company_id))
  ) then
    raise exception using errcode = '42501', message = 'You do not have permission to resolve this thread.';
  end if;
  -- Company members act on their own company, which must still be active (read-only otherwise).
  if not private.has_role('super_admin', 'fund_admin', 'partner') then
    perform private.require_active_company(v_company_id);
  end if;

  perform private.set_audit_context(case when coalesce(p_resolved, false) then 'resolve' else 'unresolve' end, null, false);
  if coalesce(p_resolved, false) then
    update public.comments
       set resolved_at = coalesce(resolved_at, now()),
           resolved_by = case when resolved_at is null then auth.uid() else resolved_by end
     where id = p_comment_id;
  else
    update public.comments set resolved_at = null, resolved_by = null where id = p_comment_id;
  end if;
  perform private.clear_audit_context();
end;
$$;
comment on function public.resolve_comment(uuid, boolean) is
  'Root comments only. ScaleUp non-viewers: any thread; company members: shared threads of their own (active) company.';

-- ---------------------------------------------------------------------------------------------
-- Period close
-- ---------------------------------------------------------------------------------------------

-- PeriodTotals (docs/ARCHITECTURE.md §5.4): flows summed; cash and headcount at period end;
-- average burn; GP% / NP% as percentages (45 = 45 %). Uses submitted / approved months only (a
-- month sent back for changes is being corrected, so its figures are not final).
create or replace function private.compute_period_totals(p_company_id uuid, p_start date, p_end date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with months as (
    select s.id, s.month
    from public.submissions s
    where s.company_id = p_company_id
      and s.month between p_start and p_end
      and s.status in ('submitted', 'approved')
  ),
  monthly as (
    select m.month,
           max(sv.value_number) filter (where sv.field_key = 'revenue_total') as revenue_total,
           max(sv.value_number) filter (where sv.field_key = 'gross_profit') as gross_profit,
           max(sv.value_number) filter (where sv.field_key = 'net_profit') as net_profit,
           max(sv.value_number) filter (where sv.field_key = 'cash_in_bank') as cash_in_bank,
           max(sv.value_number) filter (where sv.field_key = 'burn_rate') as burn_rate,
           max(sv.value_number) filter (where sv.field_key = 'headcount_ft') as headcount_ft,
           max(sv.value_number) filter (where sv.field_key = 'headcount_pt') as headcount_pt
    from months m
    left join public.submission_values sv on sv.submission_id = m.id
    group by m.month
  ),
  totals as (
    select count(*)::int as months_count,
           sum(revenue_total) as revenue_total,
           sum(gross_profit) as gross_profit,
           sum(net_profit) as net_profit,
           avg(burn_rate) as avg_burn_rate,
           (array_agg(cash_in_bank order by month desc))[1] as cash_in_bank,
           (array_agg(headcount_ft order by month desc))[1] as headcount_ft,
           (array_agg(headcount_pt order by month desc))[1] as headcount_pt
    from monthly
  )
  select jsonb_build_object(
    'months_count', t.months_count,
    'revenue_total', t.revenue_total,
    'gross_profit', t.gross_profit,
    'net_profit', t.net_profit,
    'gp_pct', case when t.revenue_total is not null and t.revenue_total <> 0 and t.gross_profit is not null
                   then round(t.gross_profit / t.revenue_total * 100, 4) end,
    'np_pct', case when t.revenue_total is not null and t.revenue_total <> 0 and t.net_profit is not null
                   then round(t.net_profit / t.revenue_total * 100, 4) end,
    'cash_in_bank', t.cash_in_bank,
    'avg_burn_rate', round(t.avg_burn_rate, 4),
    'headcount_ft', t.headcount_ft,
    'headcount_pt', t.headcount_pt
  )
  from totals t
$$;

create or replace function public.confirm_period_close(
  p_close_id uuid,
  p_restated_totals jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_close public.period_closes%rowtype;
  v_company public.companies%rowtype;
  v_start date;
  v_missing text;
  v_restated jsonb := p_restated_totals;
  v_reason text := private.clean_text(p_reason);
  v_bad_key text;
  v_is_scaleup boolean;
begin
  select * into v_close from public.period_closes pc where pc.id = p_close_id for update;
  if not found or not private.can_view_company(v_close.company_id) then
    raise exception using errcode = '42501', message = 'This period close was not found or you do not have access to it.';
  end if;
  -- (company_role() is null for non-members: compare null-safely.)
  if not (private.company_role(v_close.company_id) is not distinct from 'owner' or private.has_role('fund_admin')) then
    raise exception using errcode = '42501',
      message = 'Only the company owner (or a Fund Admin on their behalf) can confirm a period close.';
  end if;
  v_company := private.require_active_company(v_close.company_id);
  if v_close.status = 'confirmed' then
    raise exception '% is already confirmed.', v_close.label;
  end if;

  -- Every month of the period (from the company's reporting start) must be submitted or approved
  -- (BRD B13). A month sent back for changes is being corrected, so it has to be resubmitted first.
  -- Without a start month (not yet reporting, the close kept from an earlier start) the period counts
  -- from the company's first month in it. (greatest() ignores nulls.)
  v_start := greatest(
    v_close.period_start,
    coalesce(
      v_company.reporting_start_month,
      (select min(s.month) from public.submissions s
        where s.company_id = v_close.company_id and s.month between v_close.period_start and v_close.period_end)
    )
  );
  select string_agg(
           private.month_label(g.m::date)
             || case when s.status = 'changes_requested' then ' (changes requested)' else '' end,
           ', ' order by g.m)
    into v_missing
  from generate_series(
         v_start::timestamp,
         private.month_start(v_close.period_end)::timestamp,
         interval '1 month') as g(m)
  left join public.submissions s on s.company_id = v_close.company_id and s.month = g.m::date
  where s.id is null or s.status not in ('submitted', 'approved');
  if v_missing is not null then
    raise exception 'Submit every month of % before confirming it. Still to submit: %.', v_close.label, v_missing;
  end if;

  -- A management accounts document whose file is really in storage.
  if not exists (
    select 1
    from public.documents d
    join storage.objects o on o.bucket_id = 'company-documents' and o.name = d.storage_path
    where d.period_close_id = v_close.id and d.doc_type = 'management_accounts'
  ) then
    raise exception 'Upload the management accounts for % before confirming it.', v_close.label;
  end if;

  if v_restated is not null and (jsonb_typeof(v_restated) = 'null' or v_restated = '{}'::jsonb) then
    v_restated := null;
  end if;
  if v_restated is not null then
    if jsonb_typeof(v_restated) <> 'object' then
      raise exception 'Restated totals must be a set of named figures.';
    end if;
    select k into v_bad_key
    from jsonb_each(v_restated) as e(k, v)
    where k not in ('revenue_total', 'gross_profit', 'net_profit', 'gp_pct', 'np_pct', 'cash_in_bank',
                    'avg_burn_rate', 'headcount_ft', 'headcount_pt')
       or jsonb_typeof(v) not in ('number', 'null')
    limit 1;
    if v_bad_key is not null then
      raise exception 'Restated totals can only contain figures such as revenue_total or cash_in_bank (problem with "%").', v_bad_key;
    end if;
    if v_reason is null then
      raise exception 'Please give a reason for restating the totals.';
    end if;
  end if;

  v_is_scaleup := private.is_scaleup();
  perform private.set_audit_context('confirm', 'Confirmed ' || v_close.label, v_is_scaleup);
  update public.period_closes
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by = auth.uid(),
         computed_totals = private.compute_period_totals(v_close.company_id, v_start, v_close.period_end),
         restated_totals = v_restated,
         restatement_reason = case when v_restated is null then null else v_reason end
   where id = v_close.id;
  perform private.clear_audit_context();
end;
$$;
comment on function public.confirm_period_close(uuid, jsonb, text) is
  'Company owner, or Fund Admin on behalf: needs every month submitted or approved (not sent back) and an uploaded management accounts document; stores computed_totals; restated totals need a reason.';

create or replace function public.reopen_period_close(p_close_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_close public.period_closes%rowtype;
  v_reason text := private.clean_text(p_reason);
begin
  if not private.has_role_or_system('super_admin', 'fund_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins and Fund Admins can reopen a period close.';
  end if;
  select * into v_close from public.period_closes pc where pc.id = p_close_id for update;
  if not found then
    raise exception 'That period close was not found.';
  end if;
  -- Exited / written-off companies are read-only (BRD B15, B21): their confirmed closes stay
  -- confirmed. A reopened close could never be confirmed again (confirm_period_close needs an active
  -- company) and would lose its computed totals. Raised after the role check, like request_changes.
  perform private.require_active_company(v_close.company_id);
  if v_close.status <> 'confirmed' then
    raise exception '% is not confirmed.', v_close.label;
  end if;
  if v_reason is null then
    raise exception 'Please give a reason for reopening this period.';
  end if;

  perform private.set_audit_context('reopen', 'Reopened ' || v_close.label || ': ' || v_reason, false);
  update public.period_closes
     set status = 'open', confirmed_at = null, confirmed_by = null, computed_totals = null
   where id = v_close.id;
  perform private.clear_audit_context();
end;
$$;
comment on function public.reopen_period_close(uuid, text) is
  'Super Admin / Fund Admin, active companies only: confirmed → open; the reason is recorded in the audit log.';

-- ---------------------------------------------------------------------------------------------
-- Access links (BRD B14)
-- ---------------------------------------------------------------------------------------------
-- The accept action of /access/[token] claims a link BEFORE it signs anyone in: ONE conditional
-- UPDATE marks it used only if it is unused, not revoked, not expired (database time), its account
-- is active and its issuer may still hold a link for that account (memberships can change after
-- issuing; private.access_link_issuer_ok). Two concurrent claims of the same token cannot both
-- succeed: the second waits for the first's row lock and then no longer matches (used_at is set).
-- Returns the account (user id, purpose, email for admin.generateLink) or NO row when the link is not
-- valid for any reason (the page then asks for a new link). Service role only: server code with the
-- secret key; anon and authenticated cannot execute it (20260930000800_grants.sql).
create or replace function public.claim_access_link(p_token_hash text)
returns table (user_id uuid, purpose text, email text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_purpose text;
begin
  if not private.is_system() then
    raise exception using errcode = '42501', message = 'Access links can only be used through the sign-in page.';
  end if;
  update public.access_links l
     set used_at = now()
   where l.token_hash = lower(p_token_hash)
     and l.used_at is null
     and l.revoked_at is null
     and l.expires_at > now()
     and exists (select 1 from public.profiles pr where pr.id = l.user_id and pr.is_active)
     and private.access_link_issuer_ok(l.created_by, l.user_id)
  returning l.user_id, l.purpose into v_user_id, v_purpose;
  if v_user_id is null then
    return;
  end if;
  return query select v_user_id, v_purpose, pr.email from public.profiles pr where pr.id = v_user_id;
end;
$$;
comment on function public.claim_access_link(text) is
  'Service role only (the /access accept action): atomically marks an unused, unrevoked, unexpired link of an active account as used and returns user_id, purpose, email — or no row.';

-- ---------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------
-- What every signed-in session needs from the (ScaleUp-only) platform settings, e.g. to route a
-- user through /mfa and /terms or to show the submission declaration: callable by ANY session with
-- a user id, including aal1, terms-pending and deactivated ones (BRD B27). Exactly these columns;
-- flag thresholds and escalation rules stay internal.
create or replace function public.get_client_settings()
returns table (require_mfa boolean, terms_version text, declaration_text text, due_day smallint)
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
    select s.require_mfa, s.terms_version, s.declaration_text, s.due_day
    from public.platform_settings s
    where s.id = 1;
end;
$$;
comment on function public.get_client_settings() is
  'Any signed-in session (also aal1 / terms pending): require_mfa, terms_version, declaration_text, due_day from platform_settings (one row).';

-- Exempt from the terms check (it is how the terms get accepted): an active account with MFA.
create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if auth.uid() is null or not private.is_active_session() then
    raise exception using errcode = '42501', message = 'Please sign in with an active account first.';
  end if;
  select s.terms_version into v_current from public.platform_settings s where s.id = 1;
  if p_version is distinct from v_current then
    raise exception 'The terms of use have been updated. Please reload the page and review the latest version.';
  end if;

  perform private.set_audit_context('accept_terms', 'Accepted terms of use ' || p_version, false);
  update public.profiles
     set terms_accepted_at = now(), terms_version = p_version
   where id = auth.uid();
  perform private.clear_audit_context();
end;
$$;
comment on function public.accept_terms(text) is 'Self: records acceptance of the current terms version (must equal platform_settings.terms_version).';

create or replace function public.update_my_profile(p_full_name text, p_job_title text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text := private.clean_text(p_full_name);
  v_job_title text := private.clean_text(p_job_title);
begin
  if auth.uid() is null or not private.is_active_user() then
    raise exception using errcode = '42501', message = 'Please sign in with an active account first.';
  end if;
  if v_full_name is null then
    raise exception 'Please enter your full name.';
  end if;
  if char_length(v_full_name) > 200 or char_length(v_job_title) > 200 then
    raise exception 'Names and job titles must be 200 characters or fewer.';
  end if;
  update public.profiles
     set full_name = v_full_name, job_title = v_job_title
   where id = auth.uid();
end;
$$;
comment on function public.update_my_profile(text, text) is 'Self: updates full name (required) and job title.';

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_full_name text,
  p_job_title text,
  p_scaleup_role public.scaleup_role default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_full_name text := private.clean_text(p_full_name);
  v_job_title text := private.clean_text(p_job_title);
begin
  if not private.has_role_or_system('super_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins can change user details, roles and access.';
  end if;
  select * into v_profile from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'That user was not found.';
  end if;
  if p_user_id = auth.uid()
     and (p_scaleup_role is distinct from 'super_admin'::public.scaleup_role or p_is_active is false) then
    raise exception 'You cannot remove your own Super Admin role or deactivate your own account.';
  end if;
  if char_length(v_full_name) > 200 or char_length(v_job_title) > 200 then
    raise exception 'Names and job titles must be 200 characters or fewer.';
  end if;

  update public.profiles
     set full_name = coalesce(v_full_name, full_name),
         job_title = v_job_title,
         scaleup_role = p_scaleup_role,
         is_active = coalesce(p_is_active, is_active)
   where id = p_user_id;
end;
$$;
comment on function public.admin_update_profile(uuid, text, text, public.scaleup_role, boolean) is
  'Super Admin: sets full name (blank keeps the current name), job title, ScaleUp role (null = company user) and is_active (null keeps the current value). Cannot demote or deactivate yourself.';

-- ---------------------------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_template_draft(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.templates%rowtype;
  v_existing uuid;
  v_published uuid;
  v_next_version integer;
  v_new_version uuid;
  v_section public.template_sections%rowtype;
  v_new_section uuid;
begin
  if not private.has_role_or_system('super_admin', 'fund_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins and Fund Admins can edit templates.';
  end if;
  select * into v_template from public.templates t where t.id = p_template_id for update;
  if not found then
    raise exception 'That template was not found.';
  end if;

  select v.id into v_existing from public.template_versions v where v.template_id = p_template_id and v.status = 'draft';
  if v_existing is not null then
    return v_existing;
  end if;

  select v.id into v_published from public.template_versions v where v.template_id = p_template_id and v.status = 'published';
  select coalesce(max(v.version_no), 0) + 1 into v_next_version from public.template_versions v where v.template_id = p_template_id;

  perform private.set_audit_context(null, 'Draft v' || v_next_version || ' of ' || v_template.name, false);
  insert into public.template_versions (template_id, version_no, status, created_by)
  values (p_template_id, v_next_version, 'draft', auth.uid())
  returning id into v_new_version;

  if v_published is not null then
    for v_section in
      select * from public.template_sections s where s.template_version_id = v_published order by s.sort_order, s.key
    loop
      insert into public.template_sections (template_version_id, key, title, description, kind, sort_order)
      values (v_new_version, v_section.key, v_section.title, v_section.description, v_section.kind, v_section.sort_order)
      returning id into v_new_section;

      insert into public.template_fields (
        template_version_id, section_id, key, label, help_text, field_type, is_required, is_system, options, validation, sort_order
      )
      select v_new_version, v_new_section, f.key, f.label, f.help_text, f.field_type, f.is_required, f.is_system,
             f.options, f.validation, f.sort_order
      from public.template_fields f
      where f.section_id = v_section.id
      order by f.sort_order, f.key;
    end loop;
  end if;
  perform private.clear_audit_context();
  return v_new_version;
end;
$$;
comment on function public.create_template_draft(uuid) is
  'Super Admin / Fund Admin: returns the template''s existing draft, or copies the published version (sections + fields) into a new draft (version_no + 1).';

create or replace function public.publish_template_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.template_versions%rowtype;
  v_missing text;
begin
  if not private.has_role_or_system('super_admin', 'fund_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins and Fund Admins can publish templates.';
  end if;
  select * into v_version from public.template_versions v where v.id = p_version_id for update;
  if not found then
    raise exception 'That template version was not found.';
  end if;
  perform 1 from public.templates t where t.id = v_version.template_id for update;
  if v_version.status <> 'draft' then
    raise exception 'Only draft versions can be published.';
  end if;

  select string_agg(sf.key, ', ' order by sf.sort_order)
    into v_missing
  from private.system_fields() sf
  where not exists (
    select 1 from public.template_fields f
    where f.template_version_id = p_version_id and f.key = sf.key and f.is_system and f.field_type = sf.field_type
  );
  if v_missing is not null then
    raise exception 'This draft is missing required system fields: %.', v_missing;
  end if;

  select string_agg(k.kind::text, ', ')
    into v_missing
  from unnest(array['financials', 'headcount', 'kpis']::public.section_kind[]) as k(kind)
  where not exists (
    select 1 from public.template_sections s where s.template_version_id = p_version_id and s.kind = k.kind
  );
  if v_missing is not null then
    raise exception 'This draft is missing required sections: %.', v_missing;
  end if;

  perform set_config('app.template_publish', 'on', true);
  perform private.set_audit_context('publish', 'Published version ' || v_version.version_no, false);
  update public.template_versions
     set status = 'archived'
   where template_id = v_version.template_id and status = 'published';
  update public.template_versions
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_version_id;
  perform private.clear_audit_context();
  perform set_config('app.template_publish', '', true);
end;
$$;
comment on function public.publish_template_version(uuid) is
  'Super Admin / Fund Admin: draft → published and the previous published version → archived. Requires every system field and system section. Future months use it; opened months keep theirs.';

-- ---------------------------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_company_status(
  p_company_id uuid,
  p_status public.company_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_reason text := private.clean_text(p_reason);
begin
  if not private.has_role_or_system('super_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins can change a company''s status.';
  end if;
  select * into v_company from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'That company was not found.';
  end if;
  if p_status is null then
    raise exception 'Choose a status.';
  end if;

  perform private.set_audit_context(
    'status_change',
    v_company.name || ': ' || v_company.status || ' → ' || p_status || coalesce(' (' || v_reason || ')', ''),
    false);
  update public.companies
     set status = p_status,
         status_reason = v_reason,
         status_changed_at = now()
   where id = p_company_id;
  perform private.clear_audit_context();
end;
$$;
comment on function public.set_company_status(uuid, public.company_status, text) is
  'Super Admin: active / exited / written_off. Exited and written-off companies are read-only and get no new months.';

create or replace function public.delete_company(p_company_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_reason text := private.clean_text(p_reason);
begin
  if not private.has_role_or_system('super_admin') then
    raise exception using errcode = '42501', message = 'Only Super Admins can delete companies.';
  end if;
  if v_reason is null then
    raise exception 'Please give a reason for deleting this company.';
  end if;
  select * into v_company from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception 'That company was not found.';
  end if;

  -- The reason goes into the audit log first.
  perform private.write_audit(
    'delete', 'companies', p_company_id::text, p_company_id,
    'Deleted company "' || v_company.name || '". Reason: ' || v_reason,
    to_jsonb(v_company), null, false);

  perform private.set_audit_context(null, 'Deleted with company "' || v_company.name || '"', false, p_company_id);
  -- Delete children that are protected by ON DELETE RESTRICT references first.
  delete from public.submissions s where s.company_id = p_company_id;
  delete from public.company_kpis k where k.company_id = p_company_id;
  delete from public.companies c where c.id = p_company_id;
  perform private.clear_audit_context();
end;
$$;
comment on function public.delete_company(uuid, text) is
  'Super Admin: hard delete with a required reason written to the audit log first. Storage objects are not removed.';
