# ISP Manager — Cable TV & Internet management (Bangladesh)

React + TypeScript + Vite + Tailwind, Supabase (PostgreSQL, Auth, RLS, Edge Functions), TanStack Query, React Hook Form + Zod, Recharts, i18next (বাংলা default + English).

**Status: all planned screens are built.** Money logic, RLS and the Edge Functions are covered by automated tests, but **payment providers and router access have not been exercised against real sandboxes/hardware**: test them as described under *Going live*.

## Run it

1. Create a Supabase project. Apply migrations in order: `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor).
2. `cp .env.example .env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public anon key only; never put a service-role key in the frontend).
3. In Supabase Auth, create your first user, then make them Super Admin (SQL editor, runs as `postgres`):
   ```sql
   insert into user_roles (user_id, role_id) select '<auth-user-uuid>', id from roles where code = 'super_admin';
   ```
4. `npm install && npm run dev`. Set company name/address etc. under `system_settings` (Settings UI is Phase 6).
5. Customers can sign in with **Customer ID + password** (no SMS needed): open a customer in Admin → Customers and press *Create login*. Phone OTP additionally needs an SMS provider in Supabase Auth; without one the OTP option will not work and nothing pretends it does.

## Checks

| Command | What it covers |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript, ESLint |
| `npm test` | Formatting, bn/en key parity, validation schemas, CSV export, RouterOS protocol + credential encryption, payment-provider verification logic, portal routing |
| `PGHOST=… PGUSER=postgres ./supabase/tests/run.sh` | Database assertions on a scratch Postgres: billing, duplicate prevention, payments, refunds, gateway idempotency, RLS isolation, immutability, audit, subscriptions/router queue, collections/deposits, reports, function privileges |

## Architecture notes

- **All money logic is in Postgres functions** (`0005`). Clients have no INSERT/UPDATE/DELETE on invoices, payments, allocations, refunds, credit notes or cash collections; they call RPCs that check permissions, lock rows and run in one transaction. Balances come from `customer_balance()`, totals from `collection_summary()` / `report_rows()`.
- **RBAC**: `roles` → `role_permissions` (+ per-user overrides). `has_permission()` is used inside RLS policies; the UI's `my_access()` only hides things.
- **Customer isolation**: customers see only rows where `customer_id = current_customer_id()`; staff NID and internal notes live in separate tables with their own policies.
- **Immutability**: finalized invoices cannot change amounts or be deleted; adjustments / credit notes / refunds are append-only; `audit_logs` is append-only.
- **Duplicate billing** is blocked by a partial unique index; duplicate payments by unique `(method, reference)` and unique gateway transaction id.
- **Secrets never reach the browser.** The app only has the publishable key. Router passwords and PPPoE passwords are AES-GCM encrypted by an Edge Function; payment-provider keys are Edge Function secrets.
- **Printing/PDF**: invoices open a print view (`/print/invoice/:id`) rendered with the bundled Bangla fonts; use the browser's *Save as PDF*.

## Migrations (apply in order in the Supabase SQL editor)

`0001`–`0009` base schema · `0010` customer balance · `0011` router queue on manual status/package change · `0012` collections RPCs · `0013` reports · `0014` router queue claim/complete.

## Edge Functions

| Function | Purpose | Verify JWT | Secrets |
|---|---|---|---|
| `admin-users` | Create staff, reset passwords, change roles, create customer logins | **OFF** (checks the caller itself) | – |
| `customer-login` | Customer ID + password sign-in | **OFF** | – |
| `network-admin` | Router credentials, PPPoE accounts, queue commands | **OFF** | `ROUTER_CRED_KEY` |
| `router-worker` | Applies queued commands to MikroTik routers | **OFF** | `ROUTER_CRED_KEY`, `WORKER_SECRET` |
| `payment-init` | Starts an online payment (amount computed server-side) | **OFF** | `SITE_URL` + provider secrets |
| `payment-webhook` | Provider callbacks → verifies with the provider → `finalize_gateway_payment()` | **OFF** (public) | `SITE_URL` + provider secrets |

Each function folder also needs `supabase/functions/_shared/*` (the dashboard editor: paste the shared file contents into the function, or deploy with the CLI: `npx supabase functions deploy <name> --project-ref <ref> --no-verify-jwt`).

### Secrets (Supabase → Edge Functions → Secrets)

| Secret | Value |
|---|---|
| `ROUTER_CRED_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). **Back it up: losing it makes stored router passwords unreadable.** |
| `WORKER_SECRET` | Long random string; the scheduler sends it as header `x-worker-secret`. |
| `SITE_URL` | `https://isp-wheat.vercel.app` (no trailing slash) |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | From your SSLCommerz merchant panel |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | bKash tokenized-checkout credentials |
| `NAGAD_MERCHANT_ID`, `NAGAD_MERCHANT_PRIVATE_KEY`, `NAGAD_PG_PUBLIC_KEY` | Nagad merchant ID, your private key and Nagad's public key (PEM or bare base64) |

Then enable each provider and choose sandbox/live in Admin → Settings → Integrations. A provider whose secrets are missing is never offered to customers.

### Scheduling the router worker

Call `router-worker` every few minutes with header `x-worker-secret: <WORKER_SECRET>`; first `{"action":"sync_all"}` (queues a session sync per router), then `{}` (processes the queue). Example with `pg_cron` + `pg_net` is in the Supabase docs; an external cron (GitHub Actions, cron-job.org) works too. Admins can also press *Process queue* on the Network page.

## Going live checklist

1. Run migrations `0010`–`0014`; deploy all six functions; set the secrets above; set Auth → URL Configuration to your site URL.
2. Make your first Super Admin (SQL above), then create staff in Admin → Staff Management.
3. Settings: company name/address/phone (used on printed invoices), billing days, late fee.
4. **Payments**: test each provider in *sandbox* end to end (pay → webhook → invoice paid) before switching to live. Provider integrations were written from their public docs and unit-tested with mocked responses only.
5. **Routers**: the router must be reachable from Supabase on the API port (8728, or 8729 with TLS). Test with *Test connection* + *Process queue* on one router before relying on suspension.
6. Enable Supabase Auth rate limits (Authentication → Rate Limits) and, if you want OTP login, an SMS provider.

## Known gaps

2FA, global search, file uploads (storage buckets + policies), email delivery (notification templates exist; sending is not wired), receipt PDFs for agents, customer-facing payment receipts beyond the invoice print view.
