-- 0009: effective-access RPC for the UI (UX only — every table still enforces RLS), auth audit, staff activation
create or replace function my_access() returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare v_profile profiles; v_roles text[]; v_perms text[]; v_customer uuid;
begin
  select * into v_profile from profiles where id = auth.uid();
  if v_profile.id is null then return null; end if;
  select coalesce(array_agg(r.code order by r.code), '{}') into v_roles
    from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = auth.uid();
  if not v_profile.is_active then
    v_perms := '{}';
  elsif 'super_admin' = any (v_roles) then
    select coalesce(array_agg(code order by code), '{}') into v_perms from permissions;
  else
    select coalesce(array_agg(code order by code), '{}') into v_perms from (
      select p.code from permissions p
       where (exists (select 1 from user_roles ur join role_permissions rp on rp.role_id = ur.role_id
                       where ur.user_id = auth.uid() and rp.permission_id = p.id)
              and not exists (select 1 from user_permissions up where up.user_id = auth.uid() and up.permission_id = p.id and not up.granted))
          or exists (select 1 from user_permissions up where up.user_id = auth.uid() and up.permission_id = p.id and up.granted)) x;
  end if;
  select id into v_customer from customers where user_id = auth.uid();
  return jsonb_build_object('user_id', v_profile.id, 'full_name', v_profile.full_name, 'language', v_profile.language,
    'is_active', v_profile.is_active, 'roles', to_jsonb(v_roles), 'permissions', to_jsonb(v_perms), 'customer_id', v_customer);
end $$;

create or replace function log_auth_event(p_event text) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then return; end if;
  if p_event not in ('login', 'logout', 'login_failed', 'password_reset_requested') then raise exception 'invalid event'; end if;
  insert into audit_logs (actor_id, category, action, table_name, record_id) values (auth.uid(), 'auth', p_event, 'auth.users', auth.uid()::text);
  if p_event = 'login' then update profiles set last_login_at = now() where id = auth.uid(); end if;
end $$;

create or replace function set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not has_permission('staff.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'you cannot deactivate your own account'; end if;
  if exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_user and r.code = 'super_admin') and not is_super_admin() then
    raise exception 'only a Super Admin can change a Super Admin' using errcode = '42501';
  end if;
  update profiles set is_active = p_active where id = p_user;
  insert into audit_logs (actor_id, category, action, table_name, record_id, metadata)
  values (auth.uid(), 'data', case when p_active then 'user_activated' else 'user_deactivated' end, 'profiles', p_user::text, '{}');
end $$;

do $$
declare f text;
begin
  for f in select unnest(array['my_access()', 'log_auth_event(text)', 'set_user_active(uuid,boolean)']) loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
