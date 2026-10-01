-- Portfolio at launch (BRD Appendix A, from the H1 2026 SV1 and SFF fund reports).
-- Pilot companies (Batik Boutique, RECQA, Kiddocare) are seeded elsewhere with reporting_start_month = 2026-07-01.
-- Other companies: reporting_start_month NULL = "Not yet reporting" (BRD B16). Sector/ownership/investment data: to be confirmed by admins.
insert into public.companies (name, legal_name, country, reporting_currency, status, status_changed_at, status_reason, description, reporting_start_month)
values
  ('AOne',               null,                 'Malaysia',  'MYR', 'active',      null,  null, 'Formerly AOne Schools.', null),
  ('Agiliux',            null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('BiiB',               null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('IIMMPACT',           null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('TixCarte',           null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('Buzz',               null,                 'Malaysia',  'MYR', 'active',      null,  null, 'Formerly BeeBag.', null),
  ('Docspe / Plexis.ai', null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('Huddle',             null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('Kabel',              null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('StayHere',           null,                 'Malaysia',  'MYR', 'written_off', now(), 'Fully impaired and written down; voluntary strike-off in progress (H1 2026 SFF report).', null, null),
  ('Petotum',            null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('SonicBoom',          null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('i-Motorbike',        'iMotorbike Pte Ltd', 'Singapore', 'USD', 'active',      null,  null, 'Reports in USD (H1 2026 SFF report).', null),
  ('Fefifo',             null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null),
  ('E.R.T.H',            null,                 'Malaysia',  'MYR', 'active',      null,  null, null, null)
on conflict (name) do nothing;

insert into public.fund_investments (fund_id, company_id)
select f.id, c.id
from (values
  ('SV1', 'AOne'), ('SV1', 'Agiliux'), ('SV1', 'BiiB'), ('SV1', 'Batik Boutique'), ('SV1', 'IIMMPACT'), ('SV1', 'TixCarte'), ('SV1', 'RECQA'),
  ('SFF', 'Buzz'), ('SFF', 'Docspe / Plexis.ai'), ('SFF', 'Huddle'), ('SFF', 'Kabel'), ('SFF', 'StayHere'), ('SFF', 'Petotum'),
  ('SFF', 'SonicBoom'), ('SFF', 'i-Motorbike'), ('SFF', 'Fefifo'), ('SFF', 'E.R.T.H'), ('SFF', 'Kiddocare')
) as m(fund_code, company_name)
join public.funds f on f.code = m.fund_code
join public.companies c on c.name = m.company_name
on conflict (fund_id, company_id) do nothing;

-- Huddle KPIs (BRD §6.2)
insert into public.company_kpis (company_id, name, unit, value_type, frequency, is_required, sort_order)
select c.id, k.name, k.unit, k.value_type::public.kpi_value_type, 'monthly', true, k.sort_order
from public.companies c
cross join (values
  ('Cameras deployed', 'cameras', 'integer', 10),
  ('Games recorded', 'games', 'integer', 20),
  ('Games per camera', 'games', 'number', 30),
  ('Games broken down for statistics', 'games', 'integer', 40)
) as k(name, unit, value_type, sort_order)
where c.name = 'Huddle'
on conflict (company_id, name) do nothing;
