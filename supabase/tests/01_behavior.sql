-- Behavioural + security tests. Run against a DB with all migrations applied (see tests/run.sh).
create or replace function t_as(uid uuid) returns void language plpgsql as
$$ begin perform set_config('request.jwt.claim.sub', uid::text, true); execute 'set local role authenticated'; end $$;
create or replace function t_reset() returns void language plpgsql as
$$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as
$$ begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; raise notice 'PASS: %', msg; end $$;
create or replace function t_fails(q text, msg text) returns void language plpgsql as
$$ declare ok boolean := false; begin
  begin execute q; exception when others then ok := true; end;
  if not ok then raise exception 'ASSERT FAILED (expected an error): %', msg; end if; raise notice 'PASS: %', msg; end $$;

-- DML is "denied" if it errors OR RLS silently filters it to zero rows
create or replace function t_denied(q text, msg text) returns void language plpgsql as
$$ declare rc int; begin
  begin execute q; get diagnostics rc = row_count; exception when others then rc := 0; end;
  if rc <> 0 then raise exception 'ASSERT FAILED (DML was allowed, % rows): %', rc, msg; end if; raise notice 'PASS: %', msg; end $$;

do $$
declare
  admin uuid := '00000000-0000-0000-0000-0000000000a1'; agent uuid := '00000000-0000-0000-0000-0000000000a2';
  agent2 uuid := '00000000-0000-0000-0000-0000000000a3'; tech uuid := '00000000-0000-0000-0000-0000000000a4';
  ua uuid := '00000000-0000-0000-0000-0000000000b1'; ub uuid := '00000000-0000-0000-0000-0000000000b2';
  acct uuid := '00000000-0000-0000-0000-0000000000a5';
  bm date := (date_trunc('month', dhaka_today()) + interval '1 month')::date; bm2 date := (date_trunc('month', dhaka_today()) + interval '2 month')::date;
  area uuid; pk_net uuid; pk_tv uuid; ca uuid; cb uuid; sub_net uuid; sub_tv uuid; sub_b uuid;
  inv uuid; inv_b uuid; n int; v numeric; pay uuid; txn uuid; rec record; st text; st2 text; cnt int; res record;
begin
  -- users & roles (postgres / bypass) ---------------------------------------------------------
  insert into auth.users (id, email, phone) values (admin,'admin@x',null),(agent,'agent@x',null),(agent2,'agent2@x',null),
    (tech,'tech@x',null),(acct,'acct@x',null),(ua,null,'+8801711000001'),(ub,null,'+8801711000002');
  insert into user_roles (user_id, role_id) select admin, id from roles where code = 'super_admin';
  insert into user_roles (user_id, role_id) select agent, id from roles where code = 'collection_agent';
  insert into user_roles (user_id, role_id) select agent2, id from roles where code = 'collection_agent';
  insert into user_roles (user_id, role_id) select tech, id from roles where code = 'technician';
  insert into user_roles (user_id, role_id) select acct, id from roles where code = 'accountant';
  insert into user_roles (user_id, role_id) select ua, id from roles where code = 'customer';
  insert into user_roles (user_id, role_id) select ub, id from roles where code = 'customer';

  -- admin sets up catalogue --------------------------------------------------------------------
  perform t_as(admin);
  insert into service_areas (code, name, name_bn) values ('A1', 'Mirpur', 'মিরপুর') returning id into area;
  insert into packages (service_type, code, name, name_bn, monthly_price, download_mbps, upload_mbps)
    values ('internet', 'NET10', 'Home 10', 'হোম ১০', 800, 10, 10) returning id into pk_net;
  insert into packages (service_type, code, name, name_bn, monthly_price, channel_count)
    values ('cable_tv', 'TV100', 'Basic TV', 'বেসিক টিভি', 300, 100) returning id into pk_tv;
  insert into customers (full_name, phone, address, area_id, status, assigned_collection_agent_id, user_id)
    values ('রহিম উদ্দিন', '01711000001', 'মিরপুর ১০', area, 'active', agent, ua) returning id, customer_code into ca, st;
  insert into customers (full_name, phone, area_id, status, user_id) values ('Karim', '01711000002', area, 'active', ub) returning id into cb;
  perform t_ok(st like 'C%', 'customer code generated: ' || st);
  insert into subscriptions (customer_id, package_id, status, monthly_price, start_date) values (ca, pk_net, 'active', 1, date '2026-10-01') returning id into sub_net;
  insert into subscriptions (customer_id, package_id, status, monthly_price, start_date) values (ca, pk_tv, 'active', 1, date '2026-10-01') returning id into sub_tv;
  insert into subscriptions (customer_id, package_id, status, monthly_price, start_date) values (cb, pk_net, 'active', 0, date '2026-10-01') returning id into sub_b;
  select monthly_price into v from subscriptions where id = sub_net;
  perform t_ok(v = 800, 'subscription price snapshot taken server-side (client value ignored)');
  select count(*) into n from customer_services where customer_id = ca;
  perform t_ok(n = 2, 'one customer holds Cable TV and Internet independently');

  -- billing -------------------------------------------------------------------------------------
  select count(*) into n from generate_invoices(bm, null, true) where outcome = 'preview';
  perform t_ok(n = 2, 'billing preview lists 2 customers');
  select count(*) into n from invoices; perform t_ok(n = 0, 'preview created no invoices');
  select count(*) filter (where outcome = 'created') into n from generate_invoices(bm, null, false);
  perform t_ok(n = 2, 'bulk generation created 2 invoices');
  select id, total_amount into inv, v from invoices where customer_id = ca;
  perform t_ok(v = 1100, 'combined cable+internet invoice = 1100');
  select count(*) into n from invoice_items where invoice_id = inv; perform t_ok(n = 2, 'combined invoice has 2 service lines');
  select count(*) filter (where outcome = 'skipped') into n from generate_invoices(bm, null, false);
  perform t_ok(n = 2, 'second run skips: no duplicate invoices');
  select id into inv_b from invoices where customer_id = cb;
  perform t_fails($q$ insert into invoice_items (invoice_id, item_type, subscription_id, description, unit_price, amount, period_start)
                     select invoice_id, 'recurring', subscription_id, 'dup', 1, 1, period_start from invoice_items limit 1 $q$,
                  'DB constraint blocks duplicate billing for same subscription+period');

  -- price change must not touch history -------------------------------------------------------------
  update packages set monthly_price = 1000 where id = pk_net;
  select monthly_price into v from subscriptions where id = sub_net; perform t_ok(v = 800, 'package price change leaves subscription snapshot');
  select total_amount into v from invoices where id = inv; perform t_ok(v = 1100, 'package price change leaves issued invoice');
  select count(*) into n from service_price_history where package_id = pk_net; perform t_ok(n = 2, 'price history tracked');
  perform t_fails($q$ update invoices set total_amount = 1 where customer_id = (select id from customers where phone='01711000001') $q$, 'finalized invoice amount is immutable');
  perform t_fails($q$ delete from invoices where status = 'issued' $q$, 'finalized invoice cannot be deleted');
  perform t_reset();

  -- payments: cash by assigned agent ---------------------------------------------------------------------
  perform t_as(agent2);
  perform t_fails(format('select record_payment(%L, 100, ''cash'')', ca), 'unassigned agent cannot collect for this customer');
  select count(*) into n from customers; perform t_ok(n = 0, 'unassigned agent sees no customers');
  perform t_reset();
  perform t_as(agent);
  select count(*) into n from invoices; perform t_ok(n = 1, 'agent sees only assigned customer invoices');
  pay := record_payment(ca, 400, 'cash');
  select status into st from invoices where id = inv; perform t_ok(st = 'partially_paid', 'partial cash payment => partially_paid');
  select balance_due into v from invoices where id = inv; perform t_ok(v = 700, 'balance 700 after 400');
  select count(*) into n from cash_collections where agent_id = agent; perform t_ok(n = 1, 'cash traceable to collecting agent');
  perform t_fails($q$ update payments set amount = 999 $q$, 'client cannot edit payments');
  perform t_fails($q$ insert into payments (customer_id, amount, method) select id, 5, 'cash' from customers limit 1 $q$, 'client cannot insert payments directly');
  select count(*) into n from audit_logs; perform t_ok(n = 0, 'agent cannot read audit logs');
  perform t_reset();

  perform t_as(admin);
  pay := record_payment(ca, 700, 'cash');
  select status into st from invoices where id = inv; perform t_ok(st = 'paid', 'remaining payment => paid');
  -- overpayment -> credit
  pay := record_payment(ca, 500, 'cash');
  v := customer_credit(ca); perform t_ok(v = 500, 'advance payment held as credit 500');
  perform t_reset();

  -- credit auto-applies to next month's invoice -------------------------------------------------------------------
  perform t_as(admin);
  select count(*) filter (where outcome = 'created') into n from generate_invoices(bm2, array[ca], false);
  perform t_ok(n = 1, 'December invoice generated');
  select paid_amount, balance_due, status::text into rec from invoices where customer_id = ca and period_start = bm2;
  perform t_ok(rec.paid_amount = 500 and rec.balance_due = 600 and rec.status = 'partially_paid'
               , format('credit applied to new invoice (paid=%s, balance=%s)', rec.paid_amount, rec.balance_due));
  perform t_ok(customer_credit(ca) = 0, 'credit fully consumed');

  -- duplicate reference + verification ---------------------------------------------------------------------------------
  pay := record_payment(cb, 300, 'bkash', 'TX123');
  select verification_status::text into st from payments where id = pay; perform t_ok(st = 'pending', 'bKash entry waits for verification');
  select paid_amount into v from invoices where id = inv_b; perform t_ok(v = 0, 'pending payment does not clear balance');
  perform t_fails(format('select record_payment(%L, 300, ''bkash'', ''TX123'')', cb), 'duplicate bKash reference rejected');
  perform verify_payment(pay, true);
  select paid_amount into v from invoices where id = inv_b; perform t_ok(v = 300, 'verified payment updates invoice');
  perform t_fails(format('select verify_payment(%L, true)', pay), 'cannot verify twice');
  perform t_reset();

  -- gateway: service role only, idempotent, signature required ------------------------------------------------------------
  insert into payment_gateway_transactions (provider, customer_id, invoice_ids, amount, idempotency_key)
    values ('sslcommerz', cb, array[inv_b], 500, 'k1') returning id into txn;
  perform t_as(admin);
  perform t_fails(format('select finalize_gateway_payment(%L, ''G1'', ''{}''::jsonb, true)', txn), 'staff/admin cannot finalize gateway payment from client');
  perform t_reset();
  execute 'set local role service_role';
  perform t_fails(format('select finalize_gateway_payment(%L, ''G1'', ''{}''::jsonb, false)', txn), 'invalid signature rejected');
  perform t_reset();
  update payment_gateway_transactions set status = 'initiated' where id = txn;
  execute 'set local role service_role';
  pay := finalize_gateway_payment(txn, 'G1', '{"ok":true}', true);
  perform finalize_gateway_payment(txn, 'G1', '{"ok":true}', true);
  perform t_reset();
  select count(*) into n from payments where gateway_transaction_id = 'sslcommerz:G1'; perform t_ok(n = 1, 'duplicate gateway callback creates exactly one payment');
  select paid_amount into v from invoices where id = inv_b; perform t_ok(v = 800, 'gateway payment allocated to invoice (300+500)');

  -- refund ----------------------------------------------------------------------------------------------------------------------
  perform t_as(admin);
  perform create_refund(pay, 200, 'customer overpaid');
  select paid_amount into v from invoices where id = inv_b; perform t_ok(v = 600, 'refund reversed allocation (800-200)');
  select status::text into st from invoices where id = inv_b; perform t_ok(st = 'partially_paid', 'invoice back to partially_paid');
  perform t_fails(format('select create_refund(%L, 9999, ''x'')', pay), 'refund beyond payment rejected');
  perform t_reset();

  -- RLS isolation ----------------------------------------------------------------------------------------------------------------------
  perform t_as(ub);
  select count(*) into n from customers; perform t_ok(n = 1, 'customer sees only own customer row');
  select count(*) into n from invoices; select count(*) into cnt from invoices where customer_id = ca;
  perform t_ok(cnt = 0, 'customer B cannot read customer A invoices');
  select count(*) into n from payments where customer_id = ca; perform t_ok(n = 0, 'customer B cannot read customer A payments');
  select count(*) into n from customer_notes; perform t_ok(n = 0, 'customer cannot read internal notes');
  perform t_fails(format('update invoices set paid_amount = total_amount where id = %L', inv_b), 'customer cannot mark own invoice paid');
  perform t_denied(format('update customers set full_name = ''x'' where id = %L', cb), 'customer cannot update customer row directly');
  perform t_denied($q$ update subscriptions set status = 'cancelled' $q$, 'customer cannot change subscription');
  perform t_fails($q$ select count(*) from router_credentials $q$, 'router credentials unreachable (no privilege)');
  perform t_fails($q$ select record_payment((select id from customers limit 1), 100, 'cash') $q$, 'customer cannot record payments');
  perform t_fails($q$ select generate_invoices(current_date) $q$, 'customer cannot run billing');
  perform t_fails($q$ select dashboard_stats() $q$, 'customer cannot read dashboard');
  perform t_reset();

  perform t_as(tech);
  select count(*) into n from invoices; perform t_ok(n = 0, 'technician cannot see invoices');
  select count(*) into n from payments; perform t_ok(n = 0, 'technician cannot see payments');
  perform t_reset();

  -- tickets & internal comments ----------------------------------------------------------------------------------------------------------
  perform t_as(ua);
  insert into support_tickets (customer_id, category, subject, created_by) values (ca, 'slow_internet', 'Slow', ua) returning id into txn;
  perform t_fails(format($q$ insert into support_tickets (customer_id, category, subject, created_by) values (%L, 'other', 'spoof', %L) $q$, cb, ua), 'customer cannot open ticket for another customer');
  insert into ticket_comments (ticket_id, author_id, body) values (txn, ua, 'hello');
  perform t_fails(format($q$ insert into ticket_comments (ticket_id, author_id, body, is_internal) values (%L, %L, 'x', true) $q$, txn, ua), 'customer cannot write internal notes');
  perform t_reset();
  perform t_as(admin);
  insert into ticket_comments (ticket_id, author_id, body, is_internal) values (txn, admin, 'internal only', true);
  update support_tickets set assigned_technician_id = tech, status = 'assigned' where id = txn;
  perform t_reset();
  perform t_as(ua);
  select count(*) into n from ticket_comments where ticket_id = txn; perform t_ok(n = 1, 'customer sees public comment only, not internal');
  perform t_reset();
  perform t_as(tech);
  select count(*) into n from support_tickets; perform t_ok(n = 1, 'technician sees assigned ticket');
  select count(*) into n from customers; perform t_ok(n = 1, 'technician sees assigned customer');
  perform t_reset();

  -- overdue handling: an invoice for an already-due month is overdue, late fee applied once ------------------
  perform t_as(admin);
  perform set_config('app.dummy', '1', true);
  update system_settings set value = '50' where key = 'billing.late_fee_amount';
  select count(*) filter (where outcome = 'created') into n from generate_invoices(date_trunc('month', dhaka_today())::date, array[cb], false);
  perform t_ok(n = 1, 'invoice for the current (already due) month generated');
  perform t_reset();
  perform run_daily_jobs(); perform run_daily_jobs();
  select count(*) into n from invoice_adjustments where adjustment_type = 'late_fee'; perform t_ok(n = 1, 'late fee applied exactly once');
  select count(*) into n from invoices where status = 'overdue' and customer_id = cb; perform t_ok(n >= 1, 'past-due invoice marked overdue');

  -- bilingual data ----------------------------------------------------------------------------------------------------------------------------
  perform t_as(admin);
  select count(*) into n from customers where full_name ilike '%রহিম%'; perform t_ok(n = 1, 'Bangla search works');
  select count(*) into n from customers where address ilike '%মিরপুর%'; perform t_ok(n = 1, 'Bangla address search works');

  -- dashboard ----------------------------------------------------------------------------------------------------------------------------------
  declare d jsonb; c jsonb; begin
    d := dashboard_stats(bm, bm2 + 30); c := dashboard_charts(bm2, bm2 + 4);
    perform t_ok((d->'customers'->>'total')::int = 2 and (d->'services'->>'both')::int = 1, 'dashboard customer + both-services counts');
    perform t_ok((d->'services'->>'mrr')::numeric = 1900, 'dashboard MRR from active subscriptions (800+300+800)');
    perform t_ok(jsonb_array_length(c->'monthly_revenue') = 12, 'dashboard 12-month chart');
    perform t_ok(jsonb_array_length(c->'collection_trend') = 5, 'dashboard daily trend honours range');
    d := dashboard_stats(null, null, area, 'cable_tv');
    perform t_ok((d->'customers'->>'total')::int = 1, 'dashboard service filter');
  end;
  perform t_reset();

  -- effective access RPC (used by the UI) ---------------------------------------------------------------
  perform t_as(agent);
  declare a jsonb; begin
    a := my_access();
    perform t_ok(a->'roles' ? 'collection_agent' and (a->'permissions') ? 'collections.record' and not ((a->'permissions') ? 'invoices.adjust'), 'my_access: agent permissions match role');
  end;
  perform t_reset();
  perform t_as(admin);
  perform t_ok(jsonb_array_length(my_access()->'permissions') = (select count(*) from permissions), 'my_access: super admin has every permission');
  perform t_fails(format('select set_user_active(%L, false)', admin), 'admin cannot deactivate self');
  perform set_user_active(agent2, false);
  perform t_reset();
  perform t_as(agent2);
  perform t_ok(jsonb_array_length(my_access()->'permissions') = 0 and not has_permission('collections.record'), 'deactivated account loses all access immediately');
  perform t_reset();

  -- audit --------------------------------------------------------------------------------------------------------------------------------------------
  select count(*) into n from audit_logs where category = 'financial'; perform t_ok(n > 5, 'financial changes audited');
  perform t_fails($q$ update audit_logs set action = 'x' $q$, 'audit log is append-only');
  raise notice 'ALL TESTS PASSED';
end $$;
