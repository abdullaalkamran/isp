# ISP Manager — Cable TV & Internet management (Bangladesh)

React + TypeScript + Vite + Tailwind, Supabase (PostgreSQL, Auth, RLS, Edge Functions), TanStack Query, React Hook Form + Zod, Recharts, i18next (বাংলা default + English).

**Status: Phase 1 of 7 complete** (see roadmap). This is a working foundation, not the finished product.

## Run it

1. Create a Supabase project. Apply migrations in order: `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor).
2. `cp .env.example .env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public anon key only; never put a service-role key in the frontend).
3. In Supabase Auth, create your first user, then make them Super Admin (SQL editor, runs as `postgres`):
   ```sql
   insert into user_roles (user_id, role_id) select '<auth-user-uuid>', id from roles where code = 'super_admin';
   ```
4. `npm install && npm run dev`. Set company name/address etc. under `system_settings` (Settings UI is Phase 6).
5. Phone OTP for customers needs an SMS provider configured in Supabase Auth. Without one, customer OTP login will not work and nothing pretends it does.

## Checks

| Command | What it covers |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript, ESLint |
| `npm test` | Formatting (৳ ১,৫০০.০০ / BDT 1,500.00, Dhaka dates), bn/en key parity + placeholder parity, portal routing |
| `PGHOST=… PGUSER=postgres ./supabase/tests/run.sh` | 70+ database assertions on a scratch Postgres: billing, duplicate prevention, partial/advance payments, refunds, gateway idempotency, RLS isolation, immutability, audit |

## Architecture notes

- **All money logic is in Postgres functions** (`supabase/migrations/0005`). Clients have no INSERT/UPDATE/DELETE on invoices, payments, allocations, refunds or credit notes; they call RPCs that check permissions, lock rows and run in one transaction.
- **RBAC**: `roles` → `role_permissions` (+ per-user overrides in `user_permissions`). `has_permission()` is used inside RLS policies; the UI's `my_access()` only hides things.
- **Customer isolation**: customers see only rows where `customer_id = current_customer_id()`; staff NID and internal notes live in separate tables with their own policies.
- **Immutability**: finalized invoices cannot change amounts or be deleted; adjustments / credit notes / refunds are append-only records; `audit_logs` is append-only.
- **Duplicate billing** is blocked by a partial unique index on `(subscription_id, period_start)`; duplicate payments by unique `(method, reference)` and unique gateway transaction id.
- **Invoice math**: `total_amount` = this period's charges only. `previous_balance` is an informational snapshot and is not added again.
- **Overdue** is a stored status refreshed by `run_daily_jobs()` (pg_cron is scheduled automatically if the extension exists) and on every payment/adjustment.
- **Online payments**: `finalize_gateway_payment()` is executable by `service_role` only. It must be called by an Edge Function after verifying with the provider and checking the webhook signature (not yet written).
- **Router credentials** live in `router_credentials` / `mikrotik_account_secrets`, which have RLS enabled with no policies, so only the service role can read them.

## Roadmap

| Phase | Scope | State |
|---|---|---|
| 1 | Setup, schema, auth, RBAC, shells, admin dashboard, bn/en | **Done** (admin/worker/customer dashboards are real; other routes show an honest "on the roadmap" notice) |
| 2 | Customer, area, package, subscription screens | Database + RPCs done; **screens not built** |
| 3 | Billing preview/generate UI, invoices, payments, collections, PDF (Bangla fonts) | Database + RPCs done; **screens and PDF not built**; gateway Edge Functions not built |
| 4 | Customer/worker/technician portals, tickets | Dashboards only; tables + RLS done |
| 5 | MikroTik adapter, router queue worker | Tables, queue, enqueue-on-suspend done; **Edge Function worker not built** |
| 6 | Notifications, reports, expenses, settings, audit UI | Tables done; **screens not built** |
| 7 | Security review, e2e tests, performance, deploy docs | Not started |

Known gaps: customer-ID + password login (needs an Edge Function), 2FA, login rate limiting (configure in Supabase Auth settings), global search, CSV/Excel export, file uploads (storage buckets + policies).
