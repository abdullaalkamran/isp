-- 0011: manual suspend / reactivate / cancel and package changes now enqueue router commands too
-- (previously only the automatic overdue job did). Idempotent (create or replace; grants are preserved).
create or replace function set_subscription_status(p_subscription uuid, p_status subscription_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare v_old subscriptions; v_router uuid;
begin
  if not has_permission('subscriptions.change_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_old from subscriptions where id = p_subscription for update;
  if v_old.id is null then raise exception 'subscription not found'; end if;
  if v_old.status = 'cancelled' then raise exception 'a cancelled subscription cannot be changed'; end if;
  if v_old.status = p_status then return; end if;
  update subscriptions set status = p_status, suspension_reason = p_reason where id = p_subscription;
  if v_old.mikrotik_account_id is not null then
    select router_id into v_router from mikrotik_accounts where id = v_old.mikrotik_account_id;
    if v_router is not null then
      if p_status in ('suspended', 'cancelled') then
        perform enqueue_network_command(v_router, v_old.mikrotik_account_id, 'suspend', '{}',
          'suspend:' || p_subscription || ':' || to_char(now(), 'YYYYMMDDHH24MISS'), auth.uid());
      elsif p_status = 'active' and v_old.status = 'suspended' then
        perform enqueue_network_command(v_router, v_old.mikrotik_account_id, 'reactivate', '{}',
          'reactivate:' || p_subscription || ':' || to_char(now(), 'YYYYMMDDHH24MISS'), auth.uid());
      end if;
    end if;
  end if;
end $$;

create or replace function change_subscription_package(p_subscription uuid, p_package uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare v_sub subscriptions; v_pkg packages; v_router uuid;
begin
  if not has_permission('subscriptions.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_sub from subscriptions where id = p_subscription for update;
  select * into v_pkg from packages where id = p_package and is_active;
  if v_sub.id is null or v_pkg.id is null then raise exception 'subscription or package not found'; end if;
  if v_sub.status = 'cancelled' then raise exception 'a cancelled subscription cannot be changed'; end if;
  if v_pkg.service_type <> v_sub.service_type then raise exception 'package service type mismatch'; end if;
  update subscriptions set package_id = v_pkg.id, monthly_price = v_pkg.monthly_price, suspension_reason = coalesce(p_reason, suspension_reason)
   where id = p_subscription;
  if v_sub.mikrotik_account_id is not null and v_pkg.router_profile is not null then
    select router_id into v_router from mikrotik_accounts where id = v_sub.mikrotik_account_id;
    if v_router is not null then
      perform enqueue_network_command(v_router, v_sub.mikrotik_account_id, 'update_profile',
        jsonb_build_object('profile', v_pkg.router_profile),
        'profile:' || p_subscription || ':' || to_char(now(), 'YYYYMMDDHH24MISS'), auth.uid());
    end if;
  end if;
end $$;
