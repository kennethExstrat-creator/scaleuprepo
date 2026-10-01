-- =============================================================================================
-- Row Level Security. Contract: docs/ARCHITECTURE.md §2.7.
--
-- * RLS is enabled on every public table. Policies are written for the `authenticated` role only;
--   anon has no table privileges at all (see 20260930000800_grants.sql) and service_role bypasses RLS.
-- * Helpers without arguments are wrapped as (select private.fn()) so Postgres evaluates them once
--   per statement (initPlan) instead of once per row.
-- * Every helper already requires an active profile, satisfied MFA and the current terms of use
--   accepted (private.is_active_user()), so aal1 sessions, deactivated users and users who have not
--   accepted the terms only see their own profile (plus public.get_client_settings(), an RPC).
-- * Tables written only by RPCs (security definer) have SELECT policies only.
-- * Company users never see ScaleUp staff profiles (profiles_select, BRD B24).
-- * access_links has RLS enabled and NO policies: service role only (auth plumbing).
-- =============================================================================================

alter table public.platform_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.funds enable row level security;
alter table public.companies enable row level security;
alter table public.fund_investments enable row level security;
alter table public.company_members enable row level security;
alter table public.company_internal enable row level security;
alter table public.revenue_segments enable row level security;
alter table public.kpi_dimensions enable row level security;
alter table public.kpi_dimension_members enable row level security;
alter table public.company_kpis enable row level security;
alter table public.templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.template_sections enable row level security;
alter table public.template_fields enable row level security;
alter table public.reporting_periods enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_values enable row level security;
alter table public.submission_segment_values enable row level security;
alter table public.submission_kpi_values enable row level security;
alter table public.submission_events enable row level security;
alter table public.comments enable row level security;
alter table public.period_closes enable row level security;
alter table public.documents enable row level security;
alter table public.fx_rates enable row level security;
alter table public.audit_log enable row level security;
alter table public.access_links enable row level security; -- no policies: service role only

-- ---------------------------------------------------------------------------------------------
-- platform_settings: ScaleUp reads (flag thresholds and escalation rules stay internal, BRD B27);
-- Super Admin updates. Every signed-in session gets what it needs (require_mfa, terms_version,
-- declaration_text, due_day) from public.get_client_settings().
-- ---------------------------------------------------------------------------------------------
create policy platform_settings_select on public.platform_settings
  for select to authenticated
  using ((select private.is_scaleup()));

create policy platform_settings_update on public.platform_settings
  for update to authenticated
  using ((select private.has_role('super_admin')))
  with check ((select private.has_role('super_admin')));

-- ---------------------------------------------------------------------------------------------
-- profiles: self (always); ScaleUp users see everyone; company users see the company-side
-- accounts (no ScaleUp role) of the people they share a company with. Writes only through RPCs.
-- ScaleUp staff profiles (name, email, role) are NEVER visible to company users (BRD §6.3, B24):
-- only the partner-in-charge or a Super Admin can approve a month (and only they, or a Fund Admin,
-- reopen one), so the name or role of whoever approved or reopened it would reveal the
-- partner-in-charge. Company-visible rows still hold ScaleUp staff ids (submissions.approved_by,
-- submission_events.actor_id, comments.author_id, documents.uploaded_by, …), but nothing resolves
-- them for company users: the company side shows ScaleUp people as "ScaleUp".
-- ---------------------------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_scaleup())
    or (scaleup_role is null and private.shares_company_with(id))
  );

-- ---------------------------------------------------------------------------------------------
-- funds, fund_investments: ScaleUp reads; Super Admin writes
-- ---------------------------------------------------------------------------------------------
create policy funds_select on public.funds
  for select to authenticated
  using ((select private.is_scaleup()));
create policy funds_insert on public.funds
  for insert to authenticated
  with check ((select private.has_role('super_admin')));
create policy funds_update on public.funds
  for update to authenticated
  using ((select private.has_role('super_admin')))
  with check ((select private.has_role('super_admin')));
create policy funds_delete on public.funds
  for delete to authenticated
  using ((select private.has_role('super_admin')));

create policy fund_investments_select on public.fund_investments
  for select to authenticated
  using ((select private.is_scaleup()));
create policy fund_investments_insert on public.fund_investments
  for insert to authenticated
  with check ((select private.has_role('super_admin')));
create policy fund_investments_update on public.fund_investments
  for update to authenticated
  using ((select private.has_role('super_admin')))
  with check ((select private.has_role('super_admin')));
create policy fund_investments_delete on public.fund_investments
  for delete to authenticated
  using ((select private.has_role('super_admin')));

-- ---------------------------------------------------------------------------------------------
-- companies: visible to ScaleUp and to the company's members; Super Admin inserts/updates;
-- deletion only through delete_company()
-- ---------------------------------------------------------------------------------------------
create policy companies_select on public.companies
  for select to authenticated
  using (private.can_view_company(id));
create policy companies_insert on public.companies
  for insert to authenticated
  with check ((select private.has_role('super_admin')));
create policy companies_update on public.companies
  for update to authenticated
  using ((select private.has_role('super_admin')))
  with check ((select private.has_role('super_admin')));

-- ---------------------------------------------------------------------------------------------
-- company_members: ScaleUp and co-members read. Super Admin manages any membership; a company
-- owner manages CONTRIBUTOR rows of their own ACTIVE company only (never owners, never other
-- companies, never ScaleUp staff accounts; exited / written-off companies are read-only).
-- ---------------------------------------------------------------------------------------------
create policy company_members_select on public.company_members
  for select to authenticated
  using ((select private.is_scaleup()) or private.is_company_member(company_id));
create policy company_members_insert on public.company_members
  for insert to authenticated
  with check (
    (select private.has_role('super_admin'))
    or (
      role = 'contributor'
      and private.company_role(company_id) = 'owner'
      and private.is_company_user(user_id)
      and private.is_active_company(company_id)
    )
  );
create policy company_members_update on public.company_members
  for update to authenticated
  using (
    (select private.has_role('super_admin'))
    or (
      role = 'contributor'
      and private.company_role(company_id) = 'owner'
      and private.is_active_company(company_id)
    )
  )
  with check (
    (select private.has_role('super_admin'))
    or (
      role = 'contributor'
      and private.company_role(company_id) = 'owner'
      and private.is_company_user(user_id)
      and private.is_active_company(company_id)
    )
  );
create policy company_members_delete on public.company_members
  for delete to authenticated
  using (
    (select private.has_role('super_admin'))
    or (
      role = 'contributor'
      and private.company_role(company_id) = 'owner'
      and private.is_active_company(company_id)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- company_internal (ScaleUp-only, incl. the partner-in-charge): ScaleUp reads; Super Admin, Fund
-- Admin and the partner-in-charge update. The row always exists (created with the company), so
-- there is no insert or delete. Only Super Admins change partner_in_charge_id (trigger
-- private.company_internal_guard()).
-- ---------------------------------------------------------------------------------------------
create policy company_internal_select on public.company_internal
  for select to authenticated
  using ((select private.is_scaleup()));
create policy company_internal_update on public.company_internal
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')) or private.is_partner_of(company_id))
  with check ((select private.has_role('super_admin', 'fund_admin')) or private.is_partner_of(company_id));

-- ---------------------------------------------------------------------------------------------
-- Company configuration: visible with the company; Super Admin and Fund Admin write
-- ---------------------------------------------------------------------------------------------
create policy revenue_segments_select on public.revenue_segments
  for select to authenticated
  using (private.can_view_company(company_id));
create policy revenue_segments_insert on public.revenue_segments
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy revenue_segments_update on public.revenue_segments
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy revenue_segments_delete on public.revenue_segments
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

create policy kpi_dimensions_select on public.kpi_dimensions
  for select to authenticated
  using (private.can_view_company(company_id));
create policy kpi_dimensions_insert on public.kpi_dimensions
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy kpi_dimensions_update on public.kpi_dimensions
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy kpi_dimensions_delete on public.kpi_dimensions
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

create policy kpi_dimension_members_select on public.kpi_dimension_members
  for select to authenticated
  using (private.can_view_company(private.dimension_company(dimension_id)));
create policy kpi_dimension_members_insert on public.kpi_dimension_members
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy kpi_dimension_members_update on public.kpi_dimension_members
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy kpi_dimension_members_delete on public.kpi_dimension_members
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

create policy company_kpis_select on public.company_kpis
  for select to authenticated
  using (private.can_view_company(company_id));
create policy company_kpis_insert on public.company_kpis
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy company_kpis_update on public.company_kpis
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy company_kpis_delete on public.company_kpis
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

-- ---------------------------------------------------------------------------------------------
-- Templates: every active (MFA) user reads; Super Admin and Fund Admin write. Sections and fields
-- only while their version is a draft (also enforced for every role by guard_template_edit()).
-- Template versions: new rows start as drafts; only drafts can be deleted; status changes only
-- through publish_template_version().
-- ---------------------------------------------------------------------------------------------
create policy templates_select on public.templates
  for select to authenticated
  using ((select private.is_active_user()));
create policy templates_insert on public.templates
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy templates_update on public.templates
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy templates_delete on public.templates
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

create policy template_versions_select on public.template_versions
  for select to authenticated
  using ((select private.is_active_user()));
create policy template_versions_insert on public.template_versions
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')) and status = 'draft');
create policy template_versions_update on public.template_versions
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy template_versions_delete on public.template_versions
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')) and status = 'draft');

create policy template_sections_select on public.template_sections
  for select to authenticated
  using ((select private.is_active_user()));
create policy template_sections_insert on public.template_sections
  for insert to authenticated
  with check (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );
create policy template_sections_update on public.template_sections
  for update to authenticated
  using (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  )
  with check (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );
create policy template_sections_delete on public.template_sections
  for delete to authenticated
  using (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );

create policy template_fields_select on public.template_fields
  for select to authenticated
  using ((select private.is_active_user()));
create policy template_fields_insert on public.template_fields
  for insert to authenticated
  with check (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );
create policy template_fields_update on public.template_fields
  for update to authenticated
  using (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  )
  with check (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );
create policy template_fields_delete on public.template_fields
  for delete to authenticated
  using (
    (select private.has_role('super_admin', 'fund_admin'))
    and private.template_version_is_draft(template_version_id)
  );

-- ---------------------------------------------------------------------------------------------
-- Reporting periods: every active (MFA) user reads; written by RPCs only
-- ---------------------------------------------------------------------------------------------
create policy reporting_periods_select on public.reporting_periods
  for select to authenticated
  using ((select private.is_active_user()));

-- ---------------------------------------------------------------------------------------------
-- Submissions and their data: visible with the company; written by RPCs only
-- ---------------------------------------------------------------------------------------------
create policy submissions_select on public.submissions
  for select to authenticated
  using (private.can_view_company(company_id));

create policy submission_values_select on public.submission_values
  for select to authenticated
  using (private.can_view_company(private.submission_company(submission_id)));

create policy submission_segment_values_select on public.submission_segment_values
  for select to authenticated
  using (private.can_view_company(private.submission_company(submission_id)));

create policy submission_kpi_values_select on public.submission_kpi_values
  for select to authenticated
  using (private.can_view_company(private.submission_company(submission_id)));

create policy submission_events_select on public.submission_events
  for select to authenticated
  using (private.can_view_company(private.submission_company(submission_id)));

-- ---------------------------------------------------------------------------------------------
-- Comments: ScaleUp sees all; company members see SHARED threads of their own company.
-- ScaleUp non-viewers start threads anywhere; company members only reply to shared roots of their
-- own ACTIVE company (the insert trigger copies the root's visibility, so a reply to an internal
-- thread fails the visibility check; exited / written-off companies are read-only for members).
-- The author is always the caller. No update/delete (resolve via RPC).
-- ---------------------------------------------------------------------------------------------
create policy comments_select on public.comments
  for select to authenticated
  using (
    (select private.is_scaleup())
    or (visibility = 'shared' and private.is_company_member(private.submission_company(submission_id)))
  );
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (select private.has_role('super_admin', 'fund_admin', 'partner'))
      or (
        parent_id is not null
        and visibility = 'shared'
        and private.is_company_member(private.submission_company(submission_id))
        and private.is_active_company(private.submission_company(submission_id))
      )
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Period closes: visible with the company; written by RPCs only
-- ---------------------------------------------------------------------------------------------
create policy period_closes_select on public.period_closes
  for select to authenticated
  using (private.can_view_company(company_id));

-- ---------------------------------------------------------------------------------------------
-- Documents: visible with the company; members of an active company (or a fund admin, on behalf)
-- add new versions. The uploader is always the caller. Never updated or deleted in-app.
-- ---------------------------------------------------------------------------------------------
create policy documents_select on public.documents
  for select to authenticated
  using (private.can_view_company(company_id));
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_upload_company_document(company_id)
  );

-- ---------------------------------------------------------------------------------------------
-- FX rates: ScaleUp reads; Super Admin and Fund Admin write
-- ---------------------------------------------------------------------------------------------
create policy fx_rates_select on public.fx_rates
  for select to authenticated
  using ((select private.is_scaleup()));
create policy fx_rates_insert on public.fx_rates
  for insert to authenticated
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy fx_rates_update on public.fx_rates
  for update to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')))
  with check ((select private.has_role('super_admin', 'fund_admin')));
create policy fx_rates_delete on public.fx_rates
  for delete to authenticated
  using ((select private.has_role('super_admin', 'fund_admin')));

-- ---------------------------------------------------------------------------------------------
-- Audit log: Super Admin, Fund Admin and Partners read; written by triggers / RPCs only
-- ---------------------------------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.has_role('super_admin', 'fund_admin', 'partner')));
