# Backups and restore tests — runbook

BRD §11 (Availability): **daily backups, 30-day retention, restore tested each quarter.** BRD §12 lists this as an
open item. This runbook says how to meet it on the Supabase project (Postgres 17, Singapore region, BRD B1) and how to
run and record the quarterly restore test. Owner: the platform lead (with a second person who can run it).

## 1. Where the platform stands

| Data | Where it lives | Covered by Supabase's built-in daily backups? |
|---|---|---|
| Business data (companies, monthly updates, comments, closes, audit log, settings) | Postgres (`public`, `private`) | Yes, but the Pro plan keeps **7 days** only (supabase/README.md) |
| Sign-in accounts, 2FA factors | Postgres (`auth` schema) | Yes (same 7 days) |
| Uploaded documents (management accounts, supporting files) | Storage bucket `company-documents` | **No**: database backups do not contain Storage objects |

So two things are missing for the BRD target: 30-day retention for the database, and any backup of the uploaded files.

## 2. Close the gap (one-off, then keep running)

Pick **A** (simplest) or **B** (no add-on cost), and do **C** in both cases.

**A. Point-in-time recovery (PITR) add-on, 30 days.** Supabase Dashboard → Project settings → Add-ons → Point in
Time Recovery → 28-day or longer retention (choose the option that covers 30 days; the dashboard lists the current
choices and prices). PITR replaces the daily backups with continuous ones (restore to any second in the window).
Record the change in supabase/README.md ("Dashboard settings").

**B. Encrypted off-site daily dump, kept 30 days.** A scheduled job (an ops machine's cron, or a CI scheduler with
secrets) that runs once a day, from a network that can reach the session pooler:

```sh
# Connection string of the session pooler (IPv4), TLS verified with Supabase's root CA (supabase/certs).
export PGSSLMODE=verify-full PGSSLROOTCERT=supabase/certs/prod-ca-2021.crt
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage --schema=supabase_migrations \
  --file="scaleup-$STAMP.dump"
age -r "$BACKUP_PUBLIC_KEY" -o "scaleup-$STAMP.dump.age" "scaleup-$STAMP.dump" && rm "scaleup-$STAMP.dump"
# Upload to object storage in Singapore with a 30-day lifecycle rule (delete after 30 days), e.g.:
aws s3 cp "scaleup-$STAMP.dump.age" "s3://<backup-bucket>/postgres/" --region ap-southeast-1
```

- Use `pg_dump` from PostgreSQL 17 (match the server). The dump holds confidential investee data and account data
  (PDPA): encrypt before it leaves the machine; keep the private key with two named people, not on the backup host.
- The bucket must not be public, must be in Malaysia or Singapore (BRD §11), and must expire objects after 30 days.
- Alert someone when a run fails (the job's exit code) — a silent failure is the usual way backups are lost.

**C. Uploaded files.** Copy the `company-documents` bucket daily to the same off-site storage (Supabase Storage is
S3-compatible: Dashboard → Storage → S3 connection gives an access key; then e.g. `rclone sync` or `aws s3 sync`
with `--endpoint-url`), with versioning or a 30-day lifecycle on the copy. Documents are never deleted in the app
(version history), so a sync never has to remove anything; keep deletions off.

## 3. Quarterly restore test (first week of January, April, July and October)

Goal: prove a backup can be restored and the platform's data is complete. Never restore over the live project.

1. **Pick the backup**: the latest daily backup (A: a PITR point from yesterday; B: yesterday's dump; C: the file
   copy from the same day).
2. **Restore into a scratch project**: Dashboard → "Restore to a new project" (PITR), or a new Supabase project in
   the same region and `pg_restore --no-owner --no-privileges --dbname "$SCRATCH_DB_URL" scaleup-<stamp>.dump`
   after decrypting it on the operator's machine. Copy a handful of files back into the scratch bucket.
3. **Check the schema**: `SUPABASE_DB_URL=$SCRATCH_DB_URL npm run db:verify` — it must report every migration as
   deployed and the deployed files unchanged (nothing is written; it always rolls back).
4. **Check the data** (in the scratch project's SQL editor), and compare with the same queries on the live project:
   - row counts: `select 'companies', count(*) from public.companies union all select 'submissions', count(*) from
     public.submissions union all select 'submission_values', count(*) from public.submission_values union all
     select 'documents', count(*) from public.documents union all select 'audit_log', count(*) from public.audit_log;`
   - the newest audit entry: `select max(occurred_at) from public.audit_log;` (how much was lost = the recovery
     point; must be under 24 hours);
   - one recent approved month of one company opens with the same figures (spot check), and one document of the
     restored set downloads and opens.
5. **Record it** in the log below (and delete the scratch project and any decrypted dump the same day).

| Date | Backup used | Restored to | Recovery point (newest audit entry) | Checks | Time taken | Operator | Issues / follow-ups |
|---|---|---|---|---|---|---|---|
| _(first test: as soon as A or B and C are in place, then every quarter)_ | | | | | | | |

If a test fails, treat it as an incident: fix the backup job first, then repeat the test the same week.
