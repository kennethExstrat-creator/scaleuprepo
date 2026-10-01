-- =============================================================================================
-- Views (security_invoker = true, so the caller's RLS applies to every underlying table).
-- Contract: docs/ARCHITECTURE.md §2.3.
-- =============================================================================================

-- One row per submission with the pivoted system numbers and the MYR conversion rate.
-- fx_rate_to_myr: 1 for MYR companies, else fx_rates.rate_to_myr for the month (null when not set,
-- and always null for company users because fx_rates is ScaleUp-only).
create view public.v_submission_financials
with (security_invoker = true)
as
select
  s.id as submission_id,
  s.company_id,
  s.month,
  s.status,
  s.due_date,
  s.submitted_at,
  s.approved_at,
  c.reporting_currency as currency,
  case when c.reporting_currency = 'MYR' then 1::numeric else fx.rate_to_myr end as fx_rate_to_myr,
  v.revenue_total,
  v.gross_profit,
  v.net_profit,
  v.cash_in_bank,
  v.burn_rate,
  v.headcount_ft,
  v.headcount_pt
from public.submissions s
join public.companies c on c.id = s.company_id
left join public.fx_rates fx on fx.currency = c.reporting_currency and fx.month = s.month
left join lateral (
  select
    max(sv.value_number) filter (where sv.field_key = 'revenue_total') as revenue_total,
    max(sv.value_number) filter (where sv.field_key = 'gross_profit') as gross_profit,
    max(sv.value_number) filter (where sv.field_key = 'net_profit') as net_profit,
    max(sv.value_number) filter (where sv.field_key = 'cash_in_bank') as cash_in_bank,
    max(sv.value_number) filter (where sv.field_key = 'burn_rate') as burn_rate,
    max(sv.value_number) filter (where sv.field_key = 'headcount_ft') as headcount_ft,
    max(sv.value_number) filter (where sv.field_key = 'headcount_pt') as headcount_pt
  from public.submission_values sv
  where sv.submission_id = s.id
) as v on true;

comment on view public.v_submission_financials is
  'One row per submission: status, dates, currency, fx_rate_to_myr and the system numbers. RLS of the caller applies.';

-- One row per submission for trackers and home pages.
-- is_overdue / days_overdue: a draft or changes-requested month past its (effective) due date, for
-- an ACTIVE company and a month it still has to report (on or after its reporting start month).
-- Exited / written-off companies' drafts, months before a (moved) start and the months of a company
-- that is not (or no longer) reporting (reporting_start_month null, BRD B16) are never overdue.
-- has_narrative: a non-empty value in a narrative or pulse section (system figures never count).
create view public.v_submission_overview
with (security_invoker = true)
as
select
  s.id,
  s.company_id,
  s.month,
  s.status,
  s.due_date,
  s.original_due_date,
  s.submitted_at,
  s.approved_at,
  s.revision,
  s.last_saved_at,
  (
    s.status in ('draft', 'changes_requested')
    and s.due_date < private.today_myt()
    and exists (
      select 1 from public.companies c
      where c.id = s.company_id
        and c.status = 'active'
        and c.reporting_start_month is not null
        and s.month >= c.reporting_start_month
    )
  ) as is_overdue,
  case
    when s.status in ('draft', 'changes_requested')
     and s.due_date < private.today_myt()
     and exists (
       select 1 from public.companies c
       where c.id = s.company_id
         and c.status = 'active'
         and c.reporting_start_month is not null
         and s.month >= c.reporting_start_month
     )
      then private.today_myt() - s.due_date
    else 0
  end as days_overdue,
  exists (
    select 1
    from public.submission_values sv
    join public.template_fields f
      on f.template_version_id = s.template_version_id and f.key = sv.field_key
    join public.template_sections sec on sec.id = f.section_id
    where sv.submission_id = s.id
      and sec.kind in ('narrative', 'pulse')
      and not f.is_system
      and (
        sv.value_number is not null
        or coalesce(btrim(sv.value_text), '') <> ''
        or (sv.value_json is not null
            and jsonb_typeof(sv.value_json) <> 'null'
            and sv.value_json not in ('[]'::jsonb, '{}'::jsonb, '""'::jsonb))
      )
  ) as has_narrative,
  (
    select count(*)::int
    from public.comments cm
    where cm.submission_id = s.id
      and cm.parent_id is null
      and cm.resolved_at is null
  ) as open_threads
from public.submissions s;

comment on view public.v_submission_overview is
  'One row per submission for trackers: overdue flags (MYT; active, reporting companies, months from the reporting start), narrative filled, unresolved threads visible to the caller.';
