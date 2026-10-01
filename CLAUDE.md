@AGENTS.md

# ScaleUp Portfolio Reporting Platform

Web platform replacing ScaleUp Malaysia's spreadsheet/email portfolio reporting (BRD: `ScaleUp Portfolio Reporting Platform - BRD.md`).
**Build contract: `docs/ARCHITECTURE.md`** — table/column names, RPC signatures, routes, module ownership and shared APIs. Read it before changing code.

## Stack
Next.js 16.3 (App Router, `src/`, `src/proxy.ts` not middleware) · React 19.2 · TypeScript strict · Tailwind v4 · shadcn/ui (radix-nova; `src/components/ui/*` is generated — don't hand-edit) · Supabase (Postgres + RLS, Auth with TOTP MFA, Storage) via `@supabase/ssr` · zod v4 · exceljs · vitest + PGlite for DB tests. npm only; don't add dependencies.

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npx eslint <paths>`
- `npm run test:unit` (pure libs) · `npm run test:db` (migrations + RLS against in-process PGlite with a Supabase shim)
- `npm run db:types` (regenerate `src/lib/supabase/database.types.ts` from the migrations) · `npm run db:push` (apply migrations to the Supabase project in `.env.local`)
- `npm run user:create -- --email a@b.com --name "Full Name" --role super_admin` (bootstrap users)

## Rules that matter
- Data access goes through the RLS-scoped server client (`@/lib/supabase/server`). The service-role client is only for Supabase Auth admin APIs and storage signing — it bypasses RLS and loses the audit actor.
- Every Server Action and route handler re-checks auth + role (`assertScaleUp` / `assertCompanyAccess`) before doing anything; RLS is the backstop, not the only check.
- Company users must never see other companies, internal comments, `company_internal`, `fund_investments` or the audit log.
- Business rules live in the database (RPCs in `supabase/migrations`), mirrored in `src/lib/validation.ts` for UX only.
- Months: `date` = first of month in DB, `YYYY-MM` in URLs. "Today" is Asia/Kuala_Lumpur. Money shown as `RM 1,234,567` via `formatMoney`.
- UI copy in British English. Keep the BRD in sync when a business rule is clarified or streamlined (add to its "Build decisions" section).
- Never commit `.env.local` or print secrets from it.
