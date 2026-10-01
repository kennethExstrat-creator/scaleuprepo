-- =============================================================================================
-- Privileges. Contract: docs/ARCHITECTURE.md §2 ("Grants").
--
-- Supabase's default privileges grant ALL on new public objects to anon and authenticated (and
-- PUBLIC can execute every new function). We do not rely on them either way: everything is revoked
-- from the API roles, then only what the RLS policies need is granted back.
--   * anon: nothing at all.
--   * authenticated: SELECT on readable tables/views; INSERT/UPDATE/DELETE only where a policy
--     allows it; SELECT only on tables written solely through RPCs; EXECUTE on the RPCs and on the
--     private helpers used by policies and views.
--   * service_role: full access (it bypasses RLS), except that audit_log stays append-only.
--   * access_links and public.claim_access_link(): service_role only (auth plumbing; nothing for
--     anon or authenticated — the one public RPC that authenticated cannot execute).
-- Future migrations must grant their own objects explicitly (see supabase/README.md).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Start from zero
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

-- New objects start closed (for objects created later by this role, i.e. future migrations):
--   * no function in any schema is executable by PUBLIC (the built-in default), so neither anon
--     nor authenticated can call a new public or private function until it is granted;
--   * Supabase's default grants in public (ALL to anon and authenticated on new tables,
--     sequences and functions) are reversed. service_role keeps its default access.
-- Per-schema REVOKEs only undo per-schema GRANTs, hence the global form for PUBLIC's EXECUTE.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Seed bookkeeping is private to the database owner.
revoke all on private.seed_markers from public, anon, authenticated;

-- Access links (BRD B14) are read, written and claimed only by server code with the secret key.
revoke all on public.access_links from public, anon, authenticated;
revoke all on function public.claim_access_link(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- service_role (server-side only; bypasses RLS)
-- ---------------------------------------------------------------------------------------------
grant usage on schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
revoke update, delete, truncate on public.audit_log from service_role;

-- ---------------------------------------------------------------------------------------------
-- authenticated: schemas and RLS/view helpers
-- ---------------------------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant usage on schema private to authenticated;

grant execute on function
  private.today_myt(),
  private.mfa_ok(),
  private.is_active_user(),
  private.scaleup_role(),
  private.is_scaleup(),
  private.has_role(public.scaleup_role[]),
  private.company_role(uuid),
  private.is_company_member(uuid),
  private.is_partner_of(uuid),
  private.can_view_company(uuid),
  private.can_edit_submission(uuid),
  private.submission_company(uuid),
  private.dimension_company(uuid),
  private.shares_company_with(uuid),
  private.can_upload_company_document(uuid),
  private.can_upload_document_object(text),
  private.is_active_company(uuid),
  private.is_company_user(uuid),
  private.template_version_is_draft(uuid),
  private.try_uuid(text)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- authenticated: tables and views (RLS filters the rows)
-- ---------------------------------------------------------------------------------------------
grant select, update on public.platform_settings to authenticated;     -- RLS: ScaleUp reads, Super Admin updates
grant select on public.profiles to authenticated;                      -- writes via RPCs only
grant select, insert, update, delete on public.funds to authenticated;
grant select, insert, update, delete on public.fund_investments to authenticated;
grant select, insert, update on public.companies to authenticated;     -- delete via delete_company()
grant select, insert, update, delete on public.company_members to authenticated;
grant select, update on public.company_internal to authenticated;       -- the row always exists
grant select, insert, update, delete on public.revenue_segments to authenticated;
grant select, insert, update, delete on public.kpi_dimensions to authenticated;
grant select, insert, update, delete on public.kpi_dimension_members to authenticated;
grant select, insert, update, delete on public.company_kpis to authenticated;
grant select, insert, update, delete on public.templates to authenticated;
grant select, insert, delete on public.template_versions to authenticated;
grant update (notes) on public.template_versions to authenticated;    -- status via publish_template_version()
grant select, insert, update, delete on public.template_sections to authenticated;
grant select, insert, update, delete on public.template_fields to authenticated;
grant select on public.reporting_periods to authenticated;             -- written by RPCs only
grant select on public.submissions to authenticated;                   -- written by RPCs only
grant select on public.submission_values to authenticated;             -- save_submission_values()
grant select on public.submission_segment_values to authenticated;     -- save_submission_values()
grant select on public.submission_kpi_values to authenticated;         -- save_submission_values()
grant select on public.submission_events to authenticated;             -- written by RPCs only
grant select, insert on public.comments to authenticated;              -- resolve via resolve_comment()
grant select on public.period_closes to authenticated;                 -- written by RPCs only
grant select, insert on public.documents to authenticated;             -- never updated or deleted
grant select, insert, update, delete on public.fx_rates to authenticated;
grant select on public.audit_log to authenticated;                     -- written by triggers / RPCs only
grant select on public.v_submission_financials to authenticated;
grant select on public.v_submission_overview to authenticated;

-- ---------------------------------------------------------------------------------------------
-- authenticated: RPCs
-- ---------------------------------------------------------------------------------------------
grant execute on function
  public.open_due_periods(),
  public.open_period(date),
  public.save_submission_values(uuid, jsonb, jsonb, jsonb),
  public.get_submission_validation(uuid),
  public.submit_submission(uuid, boolean),
  public.request_changes(uuid, text),
  public.approve_submission(uuid, text),
  public.reopen_submission(uuid, text),
  public.request_amendment(uuid, text),
  public.extend_due_date(uuid, date, text),
  public.resolve_comment(uuid, boolean),
  public.confirm_period_close(uuid, jsonb, text),
  public.reopen_period_close(uuid, text),
  public.get_client_settings(),
  public.accept_terms(text),
  public.update_my_profile(text, text),
  public.admin_update_profile(uuid, text, text, public.scaleup_role, boolean),
  public.create_template_draft(uuid),
  public.publish_template_version(uuid),
  public.set_company_status(uuid, public.company_status, text),
  public.delete_company(uuid, text),
  public.log_audit_event(text, text, text, uuid, text, jsonb)
to authenticated;
