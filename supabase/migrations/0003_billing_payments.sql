-- 0003: invoices, payments, allocations, gateway, refunds
create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique default '',
  customer_id uuid not null references customers(id),
  invoice_date date not null default dhaka_today(),
  due_date date not null,
  period_start date,
  period_end date,
  status invoice_status not null default 'draft',
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  fee_total numeric(12,2) not null default 0 check (fee_total >= 0),
  tax_total numeric(12,2) not null default 0 check (tax_total >= 0),
  -- informational snapshot of other unpaid invoices at issue time (not part of total_amount)
  previous_balance numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  credited_amount numeric(12,2) not null default 0 check (credited_amount >= 0),
  balance_due numeric(12,2) generated always as (total_amount - paid_amount - credited_amount) stored,
  language text not null default 'bn' check (language in ('bn', 'en')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_total_math check (total_amount = subtotal - discount_total + fee_total + tax_total),
  constraint invoices_not_overpaid check (paid_amount + credited_amount <= total_amount),
  constraint invoices_period_order check (period_end is null or period_start is null or period_end >= period_start)
);
create index invoices_customer_idx on invoices (customer_id, invoice_date desc);
create index invoices_status_idx on invoices (status);
create index invoices_due_idx on invoices (due_date) where status in ('issued', 'partially_paid', 'overdue');
create index invoices_no_trgm on invoices using gin (invoice_no gin_trgm_ops);
create trigger invoices_updated before update on invoices for each row execute function set_updated_at();

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  item_type text not null default 'recurring' check (item_type in ('recurring', 'installation', 'late_fee', 'fee', 'other')),
  subscription_id uuid references subscriptions(id),
  package_id uuid references packages(id),
  description text not null,
  description_bn text,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  period_start date,
  period_end date,
  voided boolean not null default false,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on invoice_items (invoice_id);
-- DB-level duplicate-billing guard: one live recurring line per subscription per period
create unique index invoice_items_no_double_billing
  on invoice_items (subscription_id, period_start)
  where item_type = 'recurring' and subscription_id is not null and voided = false;

create table invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id),
  adjustment_type text not null check (adjustment_type in ('discount', 'fee', 'late_fee', 'correction')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index invoice_adjustments_invoice_idx on invoice_adjustments (invoice_id);

create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_no text not null unique default '',
  invoice_id uuid not null references invoices(id),
  customer_id uuid not null references customers(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  payment_no text not null unique default '',
  receipt_no text unique,
  customer_id uuid not null references customers(id),
  amount numeric(12,2) not null check (amount > 0),
  method payment_method not null,
  transaction_reference text,
  gateway_transaction_id text,
  collection_agent_id uuid references profiles(id),
  paid_at timestamptz not null default now(),
  verification_status verification_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references profiles(id),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index payments_customer_idx on payments (customer_id, paid_at desc);
create index payments_agent_idx on payments (collection_agent_id, paid_at desc);
create index payments_paid_at_idx on payments (paid_at);
-- Duplicate-payment guards
create unique index payments_method_reference_uq on payments (method, transaction_reference)
  where transaction_reference is not null and verification_status <> 'failed';
create unique index payments_gateway_txn_uq on payments (gateway_transaction_id)
  where gateway_transaction_id is not null;

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  invoice_id uuid not null references invoices(id),
  -- append-only ledger: refunds insert negative rows; effective allocation = sum per (payment, invoice)
  amount numeric(12,2) not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create index payment_allocations_invoice_idx on payment_allocations (invoice_id);
create index payment_allocations_payment_idx on payment_allocations (payment_id);

create table payment_gateway_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('sslcommerz', 'bkash', 'nagad')),
  customer_id uuid not null references customers(id),
  invoice_ids uuid[] not null default '{}',
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'BDT',
  mode text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  status text not null default 'initiated' check (status in ('initiated', 'pending', 'verified', 'failed', 'cancelled')),
  provider_txn_id text,
  idempotency_key text not null unique,
  payment_id uuid references payments(id),
  request_payload jsonb,
  response_payload jsonb,
  signature_valid boolean,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index gateway_provider_txn_uq on payment_gateway_transactions (provider, provider_txn_id) where provider_txn_id is not null;
create index gateway_customer_idx on payment_gateway_transactions (customer_id);
create trigger gateway_updated before update on payment_gateway_transactions for each row execute function set_updated_at();

create table refunds (
  id uuid primary key default gen_random_uuid(),
  refund_no text not null unique default '',
  payment_id uuid not null references payments(id),
  customer_id uuid not null references customers(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- Immutability of finalized financial records
-- ------------------------------------------------------------------------------
create or replace function invoices_guard() returns trigger language plpgsql as
$$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'finalized invoices cannot be deleted; cancel or credit them instead'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.invoice_no is null or new.invoice_no = '' then
      new.invoice_no := coalesce(setting_text('billing.invoice_prefix', 'INV'), 'INV') || '-' ||
        to_char(new.invoice_date, 'YYYYMM') || '-' || lpad(next_number('invoice', to_char(new.invoice_date, 'YYYYMM'))::text, 5, '0');
    end if;
    return new;
  end if;
  if old.status <> 'draft' and coalesce(current_setting('app.invoice_adjust', true), '') <> 'on' and (
       new.customer_id is distinct from old.customer_id or new.subtotal is distinct from old.subtotal
    or new.discount_total is distinct from old.discount_total or new.fee_total is distinct from old.fee_total
    or new.tax_total is distinct from old.tax_total or new.total_amount is distinct from old.total_amount
    or new.invoice_no is distinct from old.invoice_no or new.invoice_date is distinct from old.invoice_date
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end) then
    raise exception 'finalized invoice amounts are immutable; use an adjustment or credit note';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'cancelled invoices cannot be reopened'; end if;
  return new;
end $$;
create trigger invoices_guard_trg before insert or update or delete on invoices for each row execute function invoices_guard();

create or replace function invoice_items_guard() returns trigger language plpgsql as
$$
declare v_status invoice_status; v_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  select status into v_status from invoices where id = v_id;
  if tg_op = 'UPDATE' and v_status <> 'draft' and
     (new.amount is distinct from old.amount or new.unit_price is distinct from old.unit_price
      or new.invoice_id is distinct from old.invoice_id or new.subscription_id is distinct from old.subscription_id) then
    raise exception 'items of a finalized invoice are immutable';
  end if;
  if tg_op = 'DELETE' and v_status <> 'draft' then raise exception 'items of a finalized invoice cannot be deleted'; end if;
  return coalesce(new, old);
end $$;
create trigger invoice_items_guard_trg before update or delete on invoice_items for each row execute function invoice_items_guard();

-- Cancelling an invoice frees its periods for re-billing
create or replace function invoice_cancel_release() returns trigger language plpgsql as
$$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update invoice_items set voided = true where invoice_id = new.id;
  end if;
  return new;
end $$;
create trigger invoice_cancel_release_trg after update on invoices for each row execute function invoice_cancel_release();

create or replace function payments_guard() returns trigger language plpgsql as
$$
begin
  if tg_op = 'DELETE' then raise exception 'payments cannot be deleted; reverse them with a refund'; end if;
  if tg_op = 'INSERT' then
    if new.payment_no is null or new.payment_no = '' then
      new.payment_no := 'PAY-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM') || '-' ||
        lpad(next_number('payment', to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM'))::text, 6, '0');
    end if;
    return new;
  end if;
  if new.amount is distinct from old.amount or new.customer_id is distinct from old.customer_id
     or new.method is distinct from old.method or new.payment_no is distinct from old.payment_no then
    raise exception 'payment core fields are immutable';
  end if;
  return new;
end $$;
create trigger payments_guard_trg before insert or update or delete on payments for each row execute function payments_guard();

create or replace function immutable_table_guard() returns trigger language plpgsql as
$$ begin raise exception '% records are immutable', tg_table_name; end $$;
create trigger payment_allocations_no_change before update or delete on payment_allocations for each row execute function immutable_table_guard();
create trigger refunds_no_change before update or delete on refunds for each row execute function immutable_table_guard();
create trigger credit_notes_no_change before update or delete on credit_notes for each row execute function immutable_table_guard();
create trigger invoice_adjustments_no_change before update or delete on invoice_adjustments for each row execute function immutable_table_guard();

create or replace function numbering_defaults() returns trigger language plpgsql as
$$
begin
  if tg_table_name = 'refunds' and (new.refund_no is null or new.refund_no = '') then
    new.refund_no := 'REF-' || lpad(next_number('refund')::text, 6, '0');
  elsif tg_table_name = 'credit_notes' and (new.credit_note_no is null or new.credit_note_no = '') then
    new.credit_note_no := 'CN-' || lpad(next_number('credit_note')::text, 6, '0');
  end if;
  return new;
end $$;
create trigger refunds_no before insert on refunds for each row execute function numbering_defaults();
create trigger credit_notes_no before insert on credit_notes for each row execute function numbering_defaults();

-- Audit trail for money
create trigger audit_invoices after insert or update or delete on invoices for each row execute function audit_row('financial');
create trigger audit_payments after insert or update on payments for each row execute function audit_row('financial');
create trigger audit_allocations after insert on payment_allocations for each row execute function audit_row('financial');
create trigger audit_refunds after insert on refunds for each row execute function audit_row('financial');
create trigger audit_credit_notes after insert on credit_notes for each row execute function audit_row('financial');
create trigger audit_adjustments after insert on invoice_adjustments for each row execute function audit_row('financial');
create trigger audit_packages after insert or update or delete on packages for each row execute function audit_row('data');
create trigger audit_subscriptions after insert or update on subscriptions for each row execute function audit_row('data');
create trigger audit_customers after insert or update on customers for each row execute function audit_row('data');
