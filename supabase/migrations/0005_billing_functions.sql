-- 0005: billing engine, payment allocation, refunds, scheduled jobs.
-- All money movement happens here, inside transactions, never from the client.

create or replace function customer_credit(p_customer uuid) returns numeric
language plpgsql stable security definer set search_path = public as
$$
begin
  if not (p_customer = current_customer_id() or has_permission('payments.read')) then return 0; end if;
  return coalesce((select sum(amount) from payments where customer_id = p_customer and verification_status = 'verified'), 0)
       - coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id where p.customer_id = p_customer), 0)
       - coalesce((select sum(amount) from refunds where customer_id = p_customer), 0);
end $$;

create or replace function payment_unallocated(p_payment uuid) returns numeric
language sql stable security definer set search_path = public as
$$
  select p.amount
       - coalesce((select sum(amount) from payment_allocations where payment_id = p.id), 0)
       - coalesce((select sum(amount) from refunds where payment_id = p.id), 0)
    from payments p where p.id = p_payment
$$;

-- Network queue (payments never depend on this succeeding) ----------------------------
create or replace function enqueue_network_command(p_router uuid, p_account uuid, p_type text, p_payload jsonb, p_key text, p_by uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  insert into network_commands (router_id, account_id, command_type, payload, idempotency_key, requested_by)
  values (p_router, p_account, p_type, coalesce(p_payload, '{}'), p_key, p_by)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function enqueue_network_command(uuid, uuid, text, jsonb, text, uuid) from public, anon, authenticated;

-- Invoice status ------------------------------------------------------------------------
create or replace function recompute_invoice_status(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare i invoices; v_new invoice_status;
begin
  select * into i from invoices where id = p_invoice for update;
  if i.status in ('draft', 'cancelled') then return; end if;
  if i.balance_due <= 0 then v_new := 'paid';
  elsif i.due_date < dhaka_today() then v_new := 'overdue';
  elsif i.paid_amount + i.credited_amount > 0 then v_new := 'partially_paid';
  else v_new := 'issued'; end if;
  if v_new <> i.status then update invoices set status = v_new where id = p_invoice; end if;
end $$;
revoke all on function recompute_invoice_status(uuid) from public, anon, authenticated;

-- Reactivate services once a customer has no overdue balance (if policy allows) -------------
create or replace function reactivate_if_cleared(p_customer uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare s record;
begin
  if coalesce(setting_text('services.auto_reactivate', 'false'), 'false') <> 'true' then return; end if;
  if exists (select 1 from invoices where customer_id = p_customer and status = 'overdue') then return; end if;
  for s in select sub.id, sub.mikrotik_account_id, ma.router_id
             from subscriptions sub left join mikrotik_accounts ma on ma.id = sub.mikrotik_account_id
            where sub.customer_id = p_customer and sub.status = 'suspended' and sub.suspension_reason = 'overdue' loop
    update subscriptions set status = 'active' where id = s.id;
    if s.router_id is not null then
      perform enqueue_network_command(s.router_id, s.mikrotik_account_id, 'reactivate', '{}',
        'reactivate:' || s.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
    end if;
  end loop;
end $$;
revoke all on function reactivate_if_cleared(uuid) from public, anon, authenticated;

-- Allocation: oldest-due first unless specific invoices are named; remainder stays as credit
create or replace function allocate_payment(p_payment uuid, p_invoice_ids uuid[] default null) returns numeric
language plpgsql security definer set search_path = public as
$$
declare pay payments; v_left numeric; inv record; v_take numeric; v_total numeric := 0;
begin
  select * into pay from payments where id = p_payment for update;
  if pay.verification_status <> 'verified' then raise exception 'only verified payments can be allocated'; end if;
  v_left := payment_unallocated(p_payment);
  for inv in
    select id, balance_due from invoices
     where customer_id = pay.customer_id and status in ('issued', 'partially_paid', 'overdue') and balance_due > 0
       and (p_invoice_ids is null or id = any (p_invoice_ids))
     order by due_date, invoice_date, created_at
     for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, inv.balance_due);
    insert into payment_allocations (payment_id, invoice_id, amount) values (p_payment, inv.id, v_take);
    update invoices set paid_amount = paid_amount + v_take where id = inv.id;
    perform recompute_invoice_status(inv.id);
    v_left := v_left - v_take; v_total := v_total + v_take;
  end loop;
  perform reactivate_if_cleared(pay.customer_id);
  return v_total;
end $$;
revoke all on function allocate_payment(uuid, uuid[]) from public, anon, authenticated;

-- Apply any floating credit to a customer's open invoices
create or replace function apply_customer_credit(p_customer uuid) returns void
language plpgsql security definer set search_path = public as
$$
declare p record;
begin
  for p in select id from payments where customer_id = p_customer and verification_status = 'verified'
            and payment_unallocated(id) > 0 order by paid_at loop
    perform allocate_payment(p.id, null);
  end loop;
end $$;
revoke all on function apply_customer_credit(uuid) from public, anon, authenticated;

create or replace function stamp_receipt(p_payment uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  update payments set receipt_no = 'RCT-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM') || '-' ||
    lpad(next_number('receipt', to_char(now() at time zone 'Asia/Dhaka', 'YYYYMM'))::text, 6, '0')
   where id = p_payment and receipt_no is null;
end $$;
revoke all on function stamp_receipt(uuid) from public, anon, authenticated;

-- Staff-recorded payment ------------------------------------------------------------------
create or replace function record_payment(
  p_customer uuid, p_amount numeric, p_method payment_method,
  p_reference text default null, p_invoice_ids uuid[] default null,
  p_paid_at timestamptz default now(), p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_is_agent boolean := has_role('collection_agent'); v_status verification_status;
begin
  if not is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_method = 'gateway' then raise exception 'gateway payments are only created by verified server callbacks'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_method = 'cash' then
    if not (has_permission('payments.create_cash') or has_permission('payments.create')) then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    if not has_permission('payments.create') then raise exception 'forbidden' using errcode = '42501'; end if;
  end if;
  if v_is_agent and not has_permission('payments.create') and not is_assigned_to_customer(p_customer) then
    raise exception 'customer is not assigned to you' using errcode = '42501';
  end if;
  if p_method <> 'cash' and p_reference is null then raise exception 'transaction reference is required for % payments', p_method; end if;
  if not exists (select 1 from customers where id = p_customer and archived_at is null) then raise exception 'customer not found'; end if;

  -- cash is taken in hand => verified immediately; electronic entries await verification
  v_status := case when p_method = 'cash' then 'verified' else 'pending' end;
  insert into payments (customer_id, amount, method, transaction_reference, collection_agent_id, paid_at,
                        verification_status, verified_at, verified_by, notes, created_by)
  values (p_customer, p_amount, p_method, nullif(trim(p_reference), ''), case when v_is_agent then auth.uid() end, coalesce(p_paid_at, now()),
          v_status, case when v_status = 'verified' then now() end, case when v_status = 'verified' then auth.uid() end,
          p_notes, auth.uid())
  returning id into v_id;

  if v_status = 'verified' then
    perform stamp_receipt(v_id);
    if p_method = 'cash' and v_is_agent then
      insert into cash_collections (payment_id, agent_id, amount, collected_at) values (v_id, auth.uid(), p_amount, coalesce(p_paid_at, now()));
    end if;
    perform allocate_payment(v_id, p_invoice_ids);
  end if;
  return v_id;
end $$;

create or replace function verify_payment(p_payment uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as
$$
declare pay payments;
begin
  if not has_permission('payments.verify') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null then raise exception 'payment not found'; end if;
  if pay.verification_status <> 'pending' then raise exception 'payment already %', pay.verification_status; end if;
  if p_approve then
    update payments set verification_status = 'verified', verified_at = now(), verified_by = auth.uid(), notes = coalesce(p_note, notes) where id = p_payment;
    perform stamp_receipt(p_payment);
    perform allocate_payment(p_payment, null);
  else
    update payments set verification_status = 'failed', verified_at = now(), verified_by = auth.uid(), notes = coalesce(p_note, notes) where id = p_payment;
  end if;
end $$;

-- Gateway finalisation: ONLY the service role (Edge Function after provider-side verification) -----
create or replace function finalize_gateway_payment(p_txn uuid, p_provider_txn_id text, p_response jsonb, p_signature_valid boolean)
returns uuid language plpgsql security definer set search_path = public as
$$
declare t payment_gateway_transactions; v_pay uuid;
begin
  select * into t from payment_gateway_transactions where id = p_txn for update;
  if t.id is null then raise exception 'gateway transaction not found'; end if;
  if t.status = 'verified' then return t.payment_id; end if;     -- idempotent replay
  if p_signature_valid is not true then
    update payment_gateway_transactions set status = 'failed', response_payload = p_response, signature_valid = false where id = p_txn;
    raise exception 'invalid callback signature';
  end if;
  insert into payments (customer_id, amount, method, transaction_reference, gateway_transaction_id,
                        verification_status, verified_at, notes)
  values (t.customer_id, t.amount, 'gateway', p_provider_txn_id, t.provider || ':' || p_provider_txn_id, 'verified', now(),
          'Verified server-side via ' || t.provider || ' (' || t.mode || ')')
  on conflict (gateway_transaction_id) where gateway_transaction_id is not null do nothing
  returning id into v_pay;
  if v_pay is null then
    select id into v_pay from payments where gateway_transaction_id = t.provider || ':' || p_provider_txn_id;
  else
    perform stamp_receipt(v_pay);
    perform allocate_payment(v_pay, case when cardinality(t.invoice_ids) = 0 then null else t.invoice_ids end);
  end if;
  update payment_gateway_transactions set status = 'verified', provider_txn_id = p_provider_txn_id, payment_id = v_pay,
         response_payload = p_response, signature_valid = true, verified_at = now() where id = p_txn;
  return v_pay;
end $$;
revoke all on function finalize_gateway_payment(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function finalize_gateway_payment(uuid, text, jsonb, boolean) to service_role;

create or replace function fail_gateway_payment(p_txn uuid, p_response jsonb) returns void
language plpgsql security definer set search_path = public as
$$
begin
  update payment_gateway_transactions set status = 'failed', response_payload = p_response
   where id = p_txn and status <> 'verified';
end $$;
revoke all on function fail_gateway_payment(uuid, jsonb) from public, anon, authenticated;
grant execute on function fail_gateway_payment(uuid, jsonb) to service_role;

-- Refunds: separate traceable record; reverses allocations newest-invoice-first ------------------
create or replace function create_refund(p_payment uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$
declare pay payments; v_refund uuid; v_need numeric; v_float numeric; a record; v_take numeric;
begin
  if not has_permission('payments.refund') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a refund reason is required'; end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.verification_status <> 'verified' then raise exception 'only verified payments can be refunded'; end if;
  v_float := payment_unallocated(p_payment);
  if p_amount <= 0 or p_amount > pay.amount - coalesce((select sum(amount) from refunds where payment_id = p_payment), 0) then
    raise exception 'refund exceeds refundable amount';
  end if;
  v_need := greatest(p_amount - v_float, 0);      -- portion that must come back out of invoices
  for a in
    select pa.invoice_id, sum(pa.amount) as net, i.invoice_date
      from payment_allocations pa join invoices i on i.id = pa.invoice_id
     where pa.payment_id = p_payment group by pa.invoice_id, i.invoice_date
    having sum(pa.amount) > 0 order by i.invoice_date desc
  loop
    exit when v_need <= 0;
    v_take := least(v_need, a.net);
    insert into payment_allocations (payment_id, invoice_id, amount) values (p_payment, a.invoice_id, -v_take);
    perform set_config('app.invoice_adjust', 'on', true);
    update invoices set paid_amount = paid_amount - v_take where id = a.invoice_id;
    perform set_config('app.invoice_adjust', 'off', true);
    perform recompute_invoice_status(a.invoice_id);
    v_need := v_need - v_take;
  end loop;
  insert into refunds (payment_id, customer_id, amount, reason, created_by)
  values (p_payment, pay.customer_id, p_amount, p_reason, auth.uid()) returning id into v_refund;
  return v_refund;
end $$;

-- Adjustments & credit notes --------------------------------------------------------------------
create or replace function apply_invoice_adjustment(p_invoice uuid, p_type text, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$
declare i invoices;
begin
  if not has_permission('invoices.adjust') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_type not in ('discount', 'fee', 'late_fee', 'correction') then raise exception 'invalid adjustment type'; end if;
  if p_amount <= 0 or p_reason is null or length(trim(p_reason)) = 0 then raise exception 'amount and reason are required'; end if;
  select * into i from invoices where id = p_invoice for update;
  if i.id is null or i.status in ('cancelled', 'draft') then raise exception 'invoice not adjustable'; end if;
  perform set_config('app.invoice_adjust', 'on', true);
  if p_type in ('fee', 'late_fee') then
    update invoices set fee_total = fee_total + p_amount, total_amount = total_amount + p_amount where id = p_invoice;
  else
    if p_amount > i.balance_due then raise exception 'reduction exceeds outstanding balance'; end if;
    update invoices set discount_total = discount_total + p_amount, total_amount = total_amount - p_amount where id = p_invoice;
  end if;
  perform set_config('app.invoice_adjust', 'off', true);
  insert into invoice_adjustments (invoice_id, adjustment_type, amount, reason, created_by) values (p_invoice, p_type, p_amount, p_reason, auth.uid());
  perform recompute_invoice_status(p_invoice);
end $$;

create or replace function create_credit_note(p_invoice uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$
declare i invoices; v_id uuid;
begin
  if not has_permission('invoices.adjust') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from invoices where id = p_invoice for update;
  if i.id is null or i.status in ('cancelled', 'draft') then raise exception 'invoice not creditable'; end if;
  if p_amount <= 0 or p_amount > i.balance_due then raise exception 'credit exceeds outstanding balance'; end if;
  insert into credit_notes (invoice_id, customer_id, amount, reason, created_by) values (p_invoice, i.customer_id, p_amount, p_reason, auth.uid()) returning id into v_id;
  perform set_config('app.invoice_adjust', 'on', true);
  update invoices set credited_amount = credited_amount + p_amount where id = p_invoice;
  perform set_config('app.invoice_adjust', 'off', true);
  perform recompute_invoice_status(p_invoice);
  return v_id;
end $$;

create or replace function cancel_invoice(p_invoice uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$
declare i invoices;
begin
  if not has_permission('invoices.cancel') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from invoices where id = p_invoice for update;
  if i.id is null then raise exception 'invoice not found'; end if;
  if i.paid_amount > 0 then raise exception 'refund the payments on this invoice before cancelling it'; end if;
  update invoices set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: ' || coalesce(p_reason, '') where id = p_invoice;
end $$;

create or replace function issue_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not has_permission('billing.generate') then raise exception 'forbidden' using errcode = '42501'; end if;
  update invoices set status = 'issued' where id = p_invoice and status = 'draft';
  perform recompute_invoice_status(p_invoice);
end $$;

-- Billing engine ----------------------------------------------------------------------------------
create or replace function _generate_invoices(p_period_start date, p_customer_ids uuid[], p_dry_run boolean, p_actor uuid)
returns table (customer_id uuid, customer_code text, outcome text, invoice_id uuid, amount numeric, message text)
language plpgsql security definer set search_path = public as
$$
declare
  c record; s record; v_inv uuid; v_subtotal numeric; v_tax numeric; v_prev numeric;
  v_months int; v_amount numeric; v_period_end date; v_due date; v_due_day int; v_tax_pct numeric;
  v_n int; v_prorate boolean; v_days int; v_diff int;
begin
  v_due_day := setting_int('billing.due_day', 10);
  v_tax_pct := coalesce(setting_text('billing.tax_percent', '0'), '0')::numeric;
  v_prorate := coalesce(setting_text('billing.proration', 'none'), 'none') = 'daily';
  p_period_start := date_trunc('month', p_period_start)::date;

  for c in
    select cu.id, cu.customer_code as code, cu.language
      from customers cu
     where cu.archived_at is null and cu.status in ('active', 'suspended')
       and (p_customer_ids is null or cu.id = any (p_customer_ids))
       and exists (select 1 from subscriptions x where x.customer_id = cu.id and x.status = 'active')
     order by cu.customer_code
  loop
    begin
      v_subtotal := 0; v_n := 0; v_inv := null;
      -- first pass: what is billable and not already billed
      create temp table if not exists _lines (sub_id uuid, pkg uuid, descr text, descr_bn text, price numeric, amt numeric, p_start date, p_end date) on commit drop;
      truncate _lines;
      for s in
        select sub.*, pk.name as pk_name, pk.name_bn as pk_name_bn
          from subscriptions sub join packages pk on pk.id = sub.package_id
         where sub.customer_id = c.id and sub.status = 'active' and sub.start_date <= (p_period_start + interval '1 month - 1 day')::date
           and (sub.expiry_date is null or sub.expiry_date >= p_period_start)
      loop
        v_months := case s.billing_cycle when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
        -- bill only on this subscription's cycle boundaries (months since start divisible by cycle length)
        v_diff := (extract(year from p_period_start)::int * 12 + extract(month from p_period_start)::int)
                - (extract(year from s.start_date)::int * 12 + extract(month from s.start_date)::int);
        continue when v_diff < 0 or v_diff % v_months <> 0;
        v_period_end := (p_period_start + (v_months || ' month')::interval - interval '1 day')::date;
        continue when exists (select 1 from invoice_items ii where ii.subscription_id = s.id and ii.period_start = p_period_start
                                and ii.item_type = 'recurring' and not ii.voided);
        v_amount := s.monthly_price * v_months;
        if v_prorate and s.start_date > p_period_start and s.start_date <= v_period_end then
          v_days := (v_period_end - p_period_start) + 1;
          v_amount := round(v_amount * ((v_period_end - s.start_date) + 1)::numeric / v_days, 2);
        end if;
        insert into _lines values (s.id, s.package_id, s.pk_name, s.pk_name_bn, s.monthly_price, v_amount, p_period_start, v_period_end);
        v_subtotal := v_subtotal + v_amount; v_n := v_n + 1;
      end loop;

      if v_n = 0 then
        customer_id := c.id; customer_code := c.code; outcome := 'skipped'; invoice_id := null; amount := 0;
        message := 'already billed or no billable subscriptions for this period';
        return next; continue;
      end if;

      v_tax := round(v_subtotal * v_tax_pct / 100, 2);
      select coalesce(sum(i.balance_due), 0) into v_prev from invoices i
       where i.customer_id = c.id and i.status in ('issued', 'partially_paid', 'overdue');
      v_due := p_period_start + (v_due_day - 1);

      if p_dry_run then
        customer_id := c.id; customer_code := c.code; outcome := 'preview'; invoice_id := null;
        amount := v_subtotal + v_tax; message := v_n || ' service line(s)';
        return next; continue;
      end if;

      insert into invoices (customer_id, invoice_date, due_date, period_start, period_end, status, subtotal, tax_total,
                            previous_balance, total_amount, language, created_by)
      values (c.id, p_period_start, v_due, p_period_start, (select max(p_end) from _lines), 'issued', v_subtotal, v_tax,
              v_prev, v_subtotal + v_tax, c.language, p_actor)
      returning id into v_inv;
      insert into invoice_items (invoice_id, item_type, subscription_id, package_id, description, description_bn, unit_price, amount, period_start, period_end)
        select v_inv, 'recurring', sub_id, pkg, descr, descr_bn, price, amt, p_start, p_end from _lines;
      perform apply_customer_credit(c.id);
      perform recompute_invoice_status(v_inv);
      customer_id := c.id; customer_code := c.code; outcome := 'created'; invoice_id := v_inv; amount := v_subtotal + v_tax; message := null;
      return next;
    exception when others then
      customer_id := c.id; customer_code := c.code; outcome := 'failed'; invoice_id := null; amount := 0; message := sqlerrm;
      return next;
    end;
  end loop;
end $$;
revoke all on function _generate_invoices(date, uuid[], boolean, uuid) from public, anon, authenticated;

create or replace function generate_invoices(p_period_start date, p_customer_ids uuid[] default null, p_dry_run boolean default true)
returns table (customer_id uuid, customer_code text, outcome text, invoice_id uuid, amount numeric, message text)
language plpgsql security definer set search_path = public as
$$
begin
  if not has_permission('billing.generate') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select * from _generate_invoices(p_period_start, p_customer_ids, p_dry_run, auth.uid());
end $$;

-- Late fees, overdue marking, optional auto-suspension (run daily by pg_cron / scheduled Edge Function)
create or replace function run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare v_over int := 0; v_susp int := 0; i record; s record;
  v_late numeric := coalesce(setting_text('billing.late_fee_amount', '0'), '0')::numeric;
  v_grace int := setting_int('billing.grace_days', 3);
  v_auto boolean := coalesce(setting_text('services.auto_suspend', 'false'), 'false') = 'true';
begin
  for i in select id from invoices where status in ('issued', 'partially_paid', 'overdue') and balance_due > 0 and due_date < dhaka_today() for update skip locked loop
    perform recompute_invoice_status(i.id);
    v_over := v_over + 1;
    if v_late > 0 and not exists (select 1 from invoice_adjustments where invoice_id = i.id and adjustment_type = 'late_fee') then
      perform set_config('app.invoice_adjust', 'on', true);
      update invoices set fee_total = fee_total + v_late, total_amount = total_amount + v_late where id = i.id;
      perform set_config('app.invoice_adjust', 'off', true);
      insert into invoice_adjustments (invoice_id, adjustment_type, amount, reason) values (i.id, 'late_fee', v_late, 'Automatic late fee');
    end if;
  end loop;
  if v_auto then
    for s in
      select sub.id, sub.mikrotik_account_id, ma.router_id
        from subscriptions sub left join mikrotik_accounts ma on ma.id = sub.mikrotik_account_id
       where sub.status = 'active'
         and exists (select 1 from invoices inv where inv.customer_id = sub.customer_id and inv.status = 'overdue'
                       and inv.due_date + v_grace < dhaka_today())
    loop
      update subscriptions set status = 'suspended', suspension_reason = 'overdue' where id = s.id;
      if s.router_id is not null then
        perform enqueue_network_command(s.router_id, s.mikrotik_account_id, 'suspend', '{}', 'suspend:' || s.id || ':' || dhaka_today());
      end if;
      v_susp := v_susp + 1;
    end loop;
  end if;
  return jsonb_build_object('overdue_processed', v_over, 'suspended', v_susp);
end $$;
revoke all on function run_daily_jobs() from public, anon, authenticated;

create or replace function run_scheduled_billing() returns jsonb
language plpgsql security definer set search_path = public as
$$
declare v_day int := setting_int('billing.generation_day', 1); v_ok int; v_skip int; v_fail int;
begin
  if extract(day from dhaka_today())::int <> v_day then return jsonb_build_object('ran', false); end if;
  select count(*) filter (where outcome = 'created'), count(*) filter (where outcome = 'skipped'), count(*) filter (where outcome = 'failed')
    into v_ok, v_skip, v_fail from _generate_invoices(dhaka_today(), null, false, null);
  return jsonb_build_object('ran', true, 'created', v_ok, 'skipped', v_skip, 'failed', v_fail);
end $$;
revoke all on function run_scheduled_billing() from public, anon, authenticated;

-- Schedule server-side jobs when pg_cron is available (Supabase: enable in Dashboard > Database > Extensions)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('isp-billing', '5 18 * * *', 'select run_scheduled_billing()');   -- 00:05 Asia/Dhaka
    perform cron.schedule('isp-daily', '15 18 * * *', 'select run_daily_jobs()');           -- 00:15 Asia/Dhaka
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $$;

revoke all on function payment_unallocated(uuid) from public, anon, authenticated;
