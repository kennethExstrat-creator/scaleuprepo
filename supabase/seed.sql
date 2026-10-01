-- =============================================================================================
-- Seed data. Contract: docs/ARCHITECTURE.md §2.9 and §3.
--
-- `supabase db push --include-seed` re-runs this file whenever it changes, so it must be safe to
-- run again on a live database:
--   * always ensured (idempotent): the settings row, the default template (fixed UUIDs +
--     ON CONFLICT DO NOTHING; the template content only while its version has no fields yet —
--     published versions are immutable) and every company's company_internal row;
--   * one-time bootstrap blocks (funds, pilot companies with their KPIs, the launch portfolio):
--     each runs once and is then recorded in private.seed_markers. After that the rows belong to
--     the admins: a later run never re-creates rows they have deleted. Give NEW bootstrap rows a
--     NEW marker key instead of editing an applied block.
-- The fixed UUIDs are exported for tests in tests/db/fixtures.ts — keep both files in sync.
--
--   Funds              a0000000-0000-4000-8000-00000000000N   (1 SV1, 2 SFF)
--   Template           b0000000-0000-4000-8000-000000000001   "Portfolio Update" (default)
--   Template version   b1000000-0000-4000-8000-000000000001   v1, published
--   Template sections  b2000000-0000-4000-8000-0000000000NN   (NN = section # in §3, 01–13)
--   Template fields    b3000000-0000-4000-8000-0000000000NN   (NN = 01–23 in template order)
--   Companies          c0000000-0000-4000-8000-0000000000NN   (01 Batik Boutique, 02 RECQA, 03 Kiddocare =
--                                                             the pilot; 04–18 the rest of BRD Appendix A)
--   KPI dimension      d0000000-0000-4000-8000-000000000001   Batik Boutique "Outlet"
--   Dimension members  d1000000-0000-4000-8000-00000000000N   (1 Mont Kiara … 5 Merdeka 118)
--   Company KPIs       e0000000-0000-4000-8000-0000000000NN   (01–03 Batik Boutique, 04–07 Kiddocare, 08–11 Huddle)
--   Fund investments   f0000000-0000-4000-8000-0000000000NN   (NN = the company's NN)
--
-- No users are seeded: create them with `npm run user:create`. Partners-in-charge
-- (company_internal.partner_in_charge_id) are assigned in the platform once the partners' accounts
-- exist.
-- =============================================================================================

-- Settings (all defaults) — always ensured
insert into public.platform_settings (id) values (1)
on conflict (id) do nothing;

-- Funds — one-time bootstrap
do $seed$
begin
  if exists (select 1 from private.seed_markers m where m.key = 'funds_v1') then
    return;
  end if;
  insert into public.funds (id, code, name, legal_name) values
    ('a0000000-0000-4000-8000-000000000001', 'SV1', 'ScaleUp Ventures 1 Sdn Bhd', 'ScaleUp Ventures 1 Sdn Bhd'),
    ('a0000000-0000-4000-8000-000000000002', 'SFF', 'ScaleUp Founders Fund LP', 'ScaleUp Founders Fund LP')
  on conflict do nothing;
  insert into private.seed_markers (key) values ('funds_v1');
end;
$seed$;

-- Default template "Portfolio Update" v1 (§3) — always ensured
insert into public.templates (id, name, description, is_default) values
  ('b0000000-0000-4000-8000-000000000001', 'Portfolio Update',
   'Monthly portfolio update based on the C4 template: numbers every month, narrative optional.', true)
on conflict do nothing;

insert into public.template_versions (id, template_id, version_no, status, notes) values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 'draft', 'Initial version')
on conflict do nothing;

do $seed$
declare
  v_version constant uuid := 'b1000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.template_fields f where f.template_version_id = v_version) then
    return; -- already seeded
  end if;

  insert into public.template_sections (id, template_version_id, key, title, kind, sort_order) values
    ('b2000000-0000-4000-8000-000000000001', v_version, 'financials', 'Financials', 'financials', 1),
    ('b2000000-0000-4000-8000-000000000002', v_version, 'headcount', 'Headcount', 'headcount', 2),
    ('b2000000-0000-4000-8000-000000000003', v_version, 'kpis', 'Company KPIs', 'kpis', 3),
    ('b2000000-0000-4000-8000-000000000004', v_version, 'company_summary', 'Company Summary', 'narrative', 4),
    ('b2000000-0000-4000-8000-000000000005', v_version, 'revenue_financial', 'Revenue and Financial Metrics', 'narrative', 5),
    ('b2000000-0000-4000-8000-000000000006', v_version, 'partnerships_market', 'Partnerships and Market Updates', 'narrative', 6),
    ('b2000000-0000-4000-8000-000000000007', v_version, 'operation', 'Operation', 'narrative', 7),
    ('b2000000-0000-4000-8000-000000000008', v_version, 'product_development', 'Product Development', 'narrative', 8),
    ('b2000000-0000-4000-8000-000000000009', v_version, 'customer_acquisition', 'Customer Acquisition Strategies', 'narrative', 9),
    ('b2000000-0000-4000-8000-000000000010', v_version, 'investment', 'Investment', 'narrative', 10),
    ('b2000000-0000-4000-8000-000000000011', v_version, 'compliance_regulation', 'Compliance and Regulation', 'narrative', 11),
    ('b2000000-0000-4000-8000-000000000012', v_version, 'other_mentionables', 'Other Mentionables', 'narrative', 12),
    ('b2000000-0000-4000-8000-000000000013', v_version, 'founder_pulse', 'Founder Pulse', 'pulse', 13);

  insert into public.template_fields
    (id, template_version_id, section_id, key, label, help_text, field_type, is_required, is_system, options, validation, sort_order)
  values
    -- 1 Financials
    ('b3000000-0000-4000-8000-000000000001', v_version, 'b2000000-0000-4000-8000-000000000001',
     'revenue_total', 'Total revenue', null, 'currency', true, true, null, '{"min": 0}', 1),
    ('b3000000-0000-4000-8000-000000000002', v_version, 'b2000000-0000-4000-8000-000000000001',
     'gross_profit', 'Gross profit', null, 'currency', true, true, null, '{"allow_negative": true}', 2),
    ('b3000000-0000-4000-8000-000000000003', v_version, 'b2000000-0000-4000-8000-000000000001',
     'net_profit', 'Net profit', null, 'currency', true, true, null, '{"allow_negative": true}', 3),
    ('b3000000-0000-4000-8000-000000000004', v_version, 'b2000000-0000-4000-8000-000000000001',
     'cash_in_bank', 'Cash in bank (month end)', null, 'currency', true, true, null, '{"min": 0}', 4),
    ('b3000000-0000-4000-8000-000000000005', v_version, 'b2000000-0000-4000-8000-000000000001',
     'burn_rate', 'Burn rate (per month)', 'Enter 0 if cash-flow positive', 'currency', true, true, null, '{"min": 0}', 5),
    -- 2 Headcount
    ('b3000000-0000-4000-8000-000000000006', v_version, 'b2000000-0000-4000-8000-000000000002',
     'headcount_ft', 'Full-time headcount', null, 'integer', true, true, null, '{"min": 0}', 1),
    ('b3000000-0000-4000-8000-000000000007', v_version, 'b2000000-0000-4000-8000-000000000002',
     'headcount_pt', 'Part-time headcount', null, 'integer', true, true, null, '{"min": 0}', 2),
    -- 4 Company Summary
    ('b3000000-0000-4000-8000-000000000008', v_version, 'b2000000-0000-4000-8000-000000000004',
     'key_milestones', 'Key milestones', null, 'long_text', false, false, null, null, 1),
    -- 5 Revenue and Financial Metrics
    ('b3000000-0000-4000-8000-000000000009', v_version, 'b2000000-0000-4000-8000-000000000005',
     'financial_commentary', 'Commentary on the month''s numbers', null, 'long_text', false, false, null, null, 1),
    -- 6 Partnerships and Market Updates
    ('b3000000-0000-4000-8000-000000000010', v_version, 'b2000000-0000-4000-8000-000000000006',
     'partnerships', 'Partnerships and market updates', null, 'long_text', false, false, null, null, 1),
    -- 7 Operation
    ('b3000000-0000-4000-8000-000000000011', v_version, 'b2000000-0000-4000-8000-000000000007',
     'operations_highlights', 'Operations highlights', null, 'long_text', false, false, null, null, 1),
    ('b3000000-0000-4000-8000-000000000012', v_version, 'b2000000-0000-4000-8000-000000000007',
     'team_highlights', 'Team highlights', null, 'long_text', false, false, null, null, 2),
    -- 8 Product Development
    ('b3000000-0000-4000-8000-000000000013', v_version, 'b2000000-0000-4000-8000-000000000008',
     'product_highlights', 'Product highlights', null, 'long_text', false, false, null, null, 1),
    -- 9 Customer Acquisition Strategies
    ('b3000000-0000-4000-8000-000000000014', v_version, 'b2000000-0000-4000-8000-000000000009',
     'sales_highlights', 'Sales highlights', null, 'long_text', false, false, null, null, 1),
    ('b3000000-0000-4000-8000-000000000015', v_version, 'b2000000-0000-4000-8000-000000000009',
     'marketing_highlights', 'Marketing highlights', null, 'long_text', false, false, null, null, 2),
    -- 10 Investment
    ('b3000000-0000-4000-8000-000000000016', v_version, 'b2000000-0000-4000-8000-000000000010',
     'fundraising_status', 'Fundraising status', null, 'picklist', false, false,
     '{"options": ["Not raising", "Preparing to raise", "Actively raising", "Term sheet received", "Closing round", "Round closed"]}',
     null, 1),
    ('b3000000-0000-4000-8000-000000000017', v_version, 'b2000000-0000-4000-8000-000000000010',
     'fundraising_commentary', 'Fundraising commentary', null, 'long_text', false, false, null, null, 2),
    -- 11 Compliance and Regulation
    ('b3000000-0000-4000-8000-000000000018', v_version, 'b2000000-0000-4000-8000-000000000011',
     'compliance_updates', 'Licences and regulatory matters', null, 'long_text', false, false, null, null, 1),
    -- 12 Other Mentionables
    ('b3000000-0000-4000-8000-000000000019', v_version, 'b2000000-0000-4000-8000-000000000012',
     'other_updates', 'Anything else', null, 'long_text', false, false, null, null, 1),
    -- 13 Founder Pulse
    ('b3000000-0000-4000-8000-000000000020', v_version, 'b2000000-0000-4000-8000-000000000013',
     'team_morale', 'Team morale', null, 'rating', false, false,
     '{"min": 1, "max": 5, "labels": {"1": "Very low", "5": "Very high"}}', null, 1),
    ('b3000000-0000-4000-8000-000000000021', v_version, 'b2000000-0000-4000-8000-000000000013',
     'next_month_goals', 'Next month goals', null, 'long_text', false, false, null, null, 2),
    ('b3000000-0000-4000-8000-000000000022', v_version, 'b2000000-0000-4000-8000-000000000013',
     'help_needed', 'Help needed from ScaleUp', null, 'long_text', false, false, null, null, 3),
    ('b3000000-0000-4000-8000-000000000023', v_version, 'b2000000-0000-4000-8000-000000000013',
     'help_tags', 'Help needed (tags)', null, 'tags', false, false,
     '{"options": ["Fundraising", "Hiring", "Sales introductions", "Partnerships", "Legal and regulatory", "Finance", "Product and technology", "Marketing", "Other"]}',
     null, 4);

  update public.template_versions
     set status = 'published', published_at = now()
   where id = v_version and status = 'draft';
end;
$seed$;

-- Pilot companies (no fund mapping / sector / ownership yet — completed by admins) with their KPIs
-- (BRD §6.2) — one-time bootstrap
do $seed$
begin
  if exists (select 1 from private.seed_markers m where m.key = 'pilot_companies_v1') then
    return;
  end if;

  insert into public.companies (id, name, reporting_start_month) values
    ('c0000000-0000-4000-8000-000000000001', 'Batik Boutique', '2026-07-01'),
    ('c0000000-0000-4000-8000-000000000002', 'RECQA', '2026-07-01'),
    ('c0000000-0000-4000-8000-000000000003', 'Kiddocare', '2026-07-01')
  on conflict do nothing;

  -- Batik Boutique: KPIs per outlet
  insert into public.kpi_dimensions (id, company_id, name) values
    ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Outlet')
  on conflict do nothing;

  insert into public.kpi_dimension_members (id, dimension_id, name, sort_order) values
    ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Mont Kiara', 1),
    ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'The Row', 2),
    ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'IOI City Mall', 3),
    ('d1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'Westin Desaru', 4),
    ('d1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', 'Merdeka 118', 5)
  on conflict do nothing;

  insert into public.company_kpis (id, company_id, name, unit, value_type, frequency, dimension_id, sort_order) values
    ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
     'Revenue per outlet', 'RM', 'currency', 'monthly', 'd0000000-0000-4000-8000-000000000001', 1),
    ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
     'Monthly break-even', 'RM', 'currency', 'monthly', 'd0000000-0000-4000-8000-000000000001', 2),
    ('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
     'Profitable', null, 'boolean', 'monthly', 'd0000000-0000-4000-8000-000000000001', 3)
  on conflict do nothing;

  -- Kiddocare KPIs. RECQA has no KPIs.
  insert into public.company_kpis (id, company_id, name, unit, value_type, frequency, sort_order) values
    ('e0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000003', 'App downloads', 'downloads', 'integer', 'monthly', 1),
    ('e0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003', 'Bookings', 'bookings', 'integer', 'monthly', 2),
    ('e0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000003', 'Active carers', 'carers', 'integer', 'monthly', 3),
    ('e0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000003', 'Payouts to carers', 'RM', 'currency', 'monthly', 4)
  on conflict do nothing;

  insert into private.seed_markers (key) values ('pilot_companies_v1');
end;
$seed$;

-- Launch portfolio (BRD Appendix A, from the H1 2026 SV1 and SFF fund reports; source:
-- docs/build-notes/portfolio-seed.sql) — one-time bootstrap:
--   * the 15 companies besides the pilot, "Not yet reporting" (reporting_start_month null, BRD B16)
--     until ScaleUp sets their start month; StayHere is written off; i-Motorbike reports in USD;
--   * every company (the pilot included) mapped to its fund: SV1 7, SFF 11 (investment date,
--     instrument and ownership to be completed by admins);
--   * Huddle's KPIs (BRD §6.2).
-- Rows whose fund or company no longer exists are skipped.
do $seed$
begin
  if exists (select 1 from private.seed_markers m where m.key = 'portfolio_h1_2026_v1') then
    return;
  end if;

  insert into public.companies
    (id, name, legal_name, country, reporting_currency, status, status_reason, description, reporting_start_month)
  values
    ('c0000000-0000-4000-8000-000000000004', 'AOne', null, 'Malaysia', 'MYR', 'active', null, 'Formerly AOne Schools.', null),
    ('c0000000-0000-4000-8000-000000000005', 'Agiliux', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000006', 'BiiB', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000007', 'IIMMPACT', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000008', 'TixCarte', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000009', 'Buzz', null, 'Malaysia', 'MYR', 'active', null, 'Formerly BeeBag.', null),
    ('c0000000-0000-4000-8000-000000000010', 'Docspe / Plexis.ai', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000011', 'Huddle', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000012', 'Kabel', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000013', 'StayHere', null, 'Malaysia', 'MYR', 'written_off',
     'Fully impaired and written down; voluntary strike-off in progress (H1 2026 SFF report).', null, null),
    ('c0000000-0000-4000-8000-000000000014', 'Petotum', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000015', 'SonicBoom', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000016', 'i-Motorbike', 'iMotorbike Pte Ltd', 'Singapore', 'USD', 'active', null,
     'Reports in USD (H1 2026 SFF report).', null),
    ('c0000000-0000-4000-8000-000000000017', 'Fefifo', null, 'Malaysia', 'MYR', 'active', null, null, null),
    ('c0000000-0000-4000-8000-000000000018', 'E.R.T.H', null, 'Malaysia', 'MYR', 'active', null, null, null)
  on conflict do nothing;

  insert into public.fund_investments (id, fund_id, company_id)
  select m.id, f.id, c.id
  from (values
    -- SV1: Batik Boutique, RECQA, AOne, Agiliux, BiiB, IIMMPACT, TixCarte
    ('f0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid),
    ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'),
    ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000004'),
    ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000005'),
    ('f0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000006'),
    ('f0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000007'),
    ('f0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000008'),
    -- SFF: Kiddocare, Buzz, Docspe / Plexis.ai, Huddle, Kabel, StayHere, Petotum, SonicBoom,
    -- i-Motorbike, Fefifo, E.R.T.H
    ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003'),
    ('f0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000009'),
    ('f0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000010'),
    ('f0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000011'),
    ('f0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000012'),
    ('f0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000013'),
    ('f0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000014'),
    ('f0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000015'),
    ('f0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000016'),
    ('f0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000017'),
    ('f0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000018')
  ) as m (id, fund_id, company_id)
  join public.funds f on f.id = m.fund_id
  join public.companies c on c.id = m.company_id
  on conflict do nothing;

  -- Huddle KPIs (BRD §6.2)
  insert into public.company_kpis (id, company_id, name, unit, value_type, frequency, sort_order)
  select k.id, c.id, k.name, k.unit, k.value_type, 'monthly', k.sort_order
  from (values
    ('e0000000-0000-4000-8000-000000000008'::uuid, 'Cameras deployed', 'cameras', 'integer'::public.kpi_value_type, 1),
    ('e0000000-0000-4000-8000-000000000009', 'Games recorded', 'games', 'integer', 2),
    ('e0000000-0000-4000-8000-000000000010', 'Games per camera', 'games', 'number', 3),
    ('e0000000-0000-4000-8000-000000000011', 'Games broken down for statistics', 'games', 'integer', 4)
  ) as k (id, name, unit, value_type, sort_order)
  join public.companies c on c.id = 'c0000000-0000-4000-8000-000000000011'
  on conflict do nothing;

  insert into private.seed_markers (key) values ('portfolio_h1_2026_v1');
end;
$seed$;

-- Every company has its ScaleUp-internal row (normally created with the company by trigger) —
-- always ensured
insert into public.company_internal (company_id)
select c.id from public.companies c
on conflict (company_id) do nothing;
