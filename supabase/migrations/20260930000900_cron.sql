-- =============================================================================================
-- Optional: open due months every day at 00:05 Malaysia time (16:05 UTC) with pg_cron.
-- Only runs when the pg_cron extension is available (always on Supabase; never on PGlite), and
-- never fails the migration: if the extension cannot be enabled, a notice is raised instead and
-- the app keeps opening months on page loads (open_due_periods() is called by the tracker/portal).
-- =============================================================================================
do $migration$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
     and not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not available; skipping the daily open_due_periods() job.';
    return;
  end if;

  begin
    if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
      create extension if not exists pg_cron;
    end if;
    -- cron.schedule() with an existing job name updates that job (idempotent).
    perform cron.schedule('open-due-periods', '5 16 * * *', 'select public.open_due_periods()');
  exception when others then
    raise notice 'Could not schedule open_due_periods() with pg_cron: %', sqlerrm;
  end;
end;
$migration$;
