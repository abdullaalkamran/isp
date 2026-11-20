-- Tests for migrations 0010 (customer_balance) and 0011 (router queue on manual status changes).
-- Run after 01_behavior.sql helpers exist is NOT required: this file defines its own and is self-contained.
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

do $$
declare
  admin uuid := '00000000-0000-0000-0000-0000000000c1'; tech uuid := '00000000-0000-0000-0000-0000000000c2';
  pk uuid; pk2 uuid; c uuid; s uuid; r uuid; ma uuid; n int; b jsonb;
begin
  insert into auth.users (id, email) values (admin, 'admin2@x'), (tech, 'tech2@x');
  insert into user_roles (user_id, role_id) select admin, id from roles where code = 'super_admin';
  insert into user_roles (user_id, role_id) select tech, id from roles where code = 'technician';

  perform t_as(admin);
  insert into packages (service_type, code, name, name_bn, monthly_price, download_mbps, upload_mbps, router_profile)
    values ('internet', 'T2A', 'A', 'এ', 500, 5, 5, 'p5') returning id into pk;
  insert into packages (service_type, code, name, name_bn, monthly_price, download_mbps, upload_mbps, router_profile)
    values ('internet', 'T2B', 'B', 'বি', 900, 10, 10, 'p10') returning id into pk2;
  insert into customers (full_name, phone, status) values ('Bal Test', '01811000001', 'active') returning id into c;
  insert into subscriptions (customer_id, package_id, status, monthly_price, start_date) values (c, pk, 'active', 0, dhaka_today()) returning id into s;
  perform t_reset();
  -- router + PPPoE account (superuser setup)
  insert into routers (name, host) values ('R-test', '10.0.0.1') returning id into r;
  insert into mikrotik_accounts (subscription_id, router_id, pppoe_username) values (s, r, 'bal.test') returning id into ma;
  update subscriptions set router_id = r, mikrotik_account_id = ma where id = s;

  -- customer_balance ---------------------------------------------------------------------------
  perform t_as(admin);
  b := customer_balance(c);
  perform t_ok((b->>'outstanding')::numeric = 0 and (b->>'credit')::numeric = 0, 'customer_balance: zero for a new customer');
  perform t_reset();
  perform t_as(tech);
  perform t_ok(customer_balance(c) is null, 'customer_balance: hidden from a technician without invoice/payment permission');
  perform t_reset();

  -- manual suspend / reactivate enqueue router commands -----------------------------------------
  perform t_as(admin);
  perform set_subscription_status(s, 'suspended', 'manual test');
  perform t_reset();
  select count(*) into n from network_commands where account_id = ma and command_type = 'suspend';
  perform t_ok(n = 1, 'manual suspend enqueues a router suspend command');
  perform t_as(admin);
  perform set_subscription_status(s, 'active', null);
  perform t_reset();
  select count(*) into n from network_commands where account_id = ma and command_type = 'reactivate';
  perform t_ok(n = 1, 'manual reactivate enqueues a router reactivate command');

  -- package change updates snapshot price and queues a profile update -----------------------------
  perform t_as(admin);
  perform change_subscription_package(s, pk2, 'upgrade');
  perform t_reset();
  perform t_ok((select monthly_price from subscriptions where id = s) = 900, 'package change updates the price snapshot');
  select count(*) into n from network_commands where account_id = ma and command_type = 'update_profile';
  perform t_ok(n = 1, 'package change enqueues update_profile');

  -- cancelled is terminal ---------------------------------------------------------------------------
  perform t_as(admin);
  perform set_subscription_status(s, 'cancelled', 'test');
  perform t_fails(format('select set_subscription_status(%L, ''active'', null)', s), 'cancelled subscription cannot be reactivated');
  perform t_fails(format('select change_subscription_package(%L, %L, null)', s, pk), 'cancelled subscription cannot change package');
  perform t_reset();
  perform t_as(tech);
  perform t_fails(format('select set_subscription_status(%L, ''active'', null)', s), 'technician cannot change subscription status');
  perform t_reset();
  raise notice 'SUBSCRIPTION/BALANCE TESTS PASSED';
end $$;

-- Migration 0012: collection summary and deposit lifecycle -------------------------------------------------
do $$
declare
  admin uuid := '00000000-0000-0000-0000-0000000000d1'; agent uuid := '00000000-0000-0000-0000-0000000000d2'; other uuid := '00000000-0000-0000-0000-0000000000d3';
  c uuid; dep uuid; n int; v numeric;
begin
  insert into auth.users (id, email) values (admin, 'admin3@x'), (agent, 'agent3@x'), (other, 'other3@x');
  insert into user_roles (user_id, role_id) select admin, id from roles where code = 'super_admin';
  insert into user_roles (user_id, role_id) select agent, id from roles where code = 'collection_agent';
  insert into user_roles (user_id, role_id) select other, id from roles where code = 'collection_agent';
  perform t_as(admin);
  insert into customers (full_name, phone, status, assigned_collection_agent_id) values ('Coll Test', '01911000001', 'active', agent) returning id into c;
  perform t_reset();

  perform t_as(agent);
  perform record_payment(c, 700, 'cash');
  perform t_reset();
  perform t_as(admin);
  select o_total into v from collection_summary(null, null) where o_agent_id = agent;
  perform t_ok(v = 700, 'collection_summary totals the agent''s cash');
  perform t_reset();
  perform t_as(agent);
  perform t_fails('select collection_summary(null, null)', 'agent cannot read the all-agent summary');
  perform t_fails(format('select submit_cash_deposit(500, null, null)'), 'deposit must equal the cash held');
  dep := submit_cash_deposit(700, 'bank slip 1', null);
  perform t_fails(format('select reconcile_deposit(%L, true, null)', dep), 'agent cannot reconcile their own deposit');
  perform t_reset();
  select count(*) into n from cash_collections where agent_id = agent and status = 'deposited' and deposit_id = dep;
  perform t_ok(n = 1, 'deposit links the held collections');
  perform t_as(other);
  perform t_fails('select submit_cash_deposit(1, null, null)', 'agent with nothing held cannot deposit');
  perform t_reset();
  perform t_as(admin);
  perform reconcile_deposit(dep, false, 'wrong amount');
  perform t_reset();
  select count(*) into n from cash_collections where agent_id = agent and status = 'held' and deposit_id is null;
  perform t_ok(n = 1, 'rejected deposit returns cash to held');
  perform t_as(agent);
  dep := submit_cash_deposit(700, 'bank slip 2', null);
  perform t_reset();
  perform t_as(admin);
  perform reconcile_deposit(dep, true, null);
  perform t_fails(format('select reconcile_deposit(%L, true, null)', dep), 'a deposit can only be reconciled once');
  perform t_reset();
  select count(*) into n from cash_collections where agent_id = agent and status = 'reconciled';
  perform t_ok(n = 1, 'approved deposit reconciles the collections');
  raise notice 'COLLECTION TESTS PASSED';
end $$;

-- Migration 0013: report_rows permissions and shape -----------------------------------------------------------
do $$
declare admin uuid := '00000000-0000-0000-0000-0000000000e1'; sup uuid := '00000000-0000-0000-0000-0000000000e2'; tech uuid := '00000000-0000-0000-0000-0000000000e3'; r jsonb;
begin
  insert into auth.users (id, email) values (admin, 'admin4@x'), (sup, 'sup4@x'), (tech, 'tech4@x');
  insert into user_roles (user_id, role_id) select admin, id from roles where code = 'super_admin';
  insert into user_roles (user_id, role_id) select sup, id from roles where code = 'support_officer';
  insert into user_roles (user_id, role_id) select tech, id from roles where code = 'technician';
  perform t_as(admin);
  r := report_rows('revenue', null, null); perform t_ok(jsonb_typeof(r) = 'array' and jsonb_array_length(r) >= 1, 'revenue report returns monthly rows');
  r := report_rows('dues'); perform t_ok(jsonb_typeof(r) = 'array', 'dues report returns an array');
  perform t_fails($q$ select report_rows('nonsense') $q$, 'unknown report is rejected');
  perform t_reset();
  perform t_as(sup);
  perform t_fails($q$ select report_rows('revenue') $q$, 'financial reports need reports.financial');
  perform t_fails($q$ select report_rows('new_customers') $q$, 'support officer lacks reports.view too');
  perform t_reset();
  perform t_as(tech);
  perform t_fails($q$ select report_rows('new_customers') $q$, 'technician cannot read reports');
  perform t_reset();
  raise notice 'REPORT TESTS PASSED';
end $$;

-- Migration 0014: queue claim / completion ---------------------------------------------------------------------
do $$
declare admin uuid := '00000000-0000-0000-0000-0000000000f1'; tech uuid := '00000000-0000-0000-0000-0000000000f2'; r uuid; id1 uuid; n int; st text; at int;
begin
  insert into auth.users (id, email) values (admin, 'admin5@x'), (tech, 'tech5@x');
  insert into user_roles (user_id, role_id) select admin, id from roles where code = 'super_admin';
  insert into user_roles (user_id, role_id) select tech, id from roles where code = 'technician';
  insert into routers (name, host) values ('R-queue', '10.0.0.9') returning id into r;
  id1 := enqueue_network_command(r, null, 'ping', '{}', 'test-claim-1');
  perform enqueue_network_command(r, null, 'ping', '{}', 'test-claim-1');           -- idempotent: same key adds nothing
  select count(*) into n from network_commands where idempotency_key = 'test-claim-1'; perform t_ok(n = 1, 'enqueue is idempotent per key');

  select count(*) into n from claim_network_commands(5) where id = id1; perform t_ok(n = 1, 'claim returns the due command');
  select status, attempts into st, at from network_commands where id = id1; perform t_ok(st = 'running' and at = 1, 'claimed command is running with attempts=1');
  select count(*) into n from claim_network_commands(5) where id = id1; perform t_ok(n = 0, 'a running command is not claimed twice');

  perform complete_network_command(id1, false, null, 'timeout');
  select status into st from network_commands where id = id1; perform t_ok(st = 'queued', 'first failure re-queues with backoff');
  perform t_ok((select next_attempt_at > now() from network_commands where id = id1), 'backoff pushes next_attempt_at into the future');
  update network_commands set attempts = max_attempts, status = 'running' where id = id1;
  perform complete_network_command(id1, false, null, 'still down');
  select status into st from network_commands where id = id1; perform t_ok(st = 'failed', 'gives up after max_attempts');

  perform t_as(admin); perform retry_network_command(id1); perform t_reset();
  select status into st from network_commands where id = id1; perform t_ok(st = 'queued', 'admin can retry a failed command');
  perform complete_network_command(id1, true, '{"ok":true}', null);
  select status into st from network_commands where id = id1; perform t_ok(st = 'succeeded', 'success is recorded');

  perform t_as(tech);
  perform t_fails(format('select retry_network_command(%L)', id1), 'technician cannot retry commands');
  perform t_fails('select * from claim_network_commands(1)', 'clients cannot claim queue commands');
  perform t_fails(format('select complete_network_command(%L, true, null, null)', id1), 'clients cannot complete queue commands');
  perform t_reset();
  raise notice 'NETWORK QUEUE TESTS PASSED';
end $$;
