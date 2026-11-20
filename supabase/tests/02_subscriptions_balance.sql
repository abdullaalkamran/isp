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
