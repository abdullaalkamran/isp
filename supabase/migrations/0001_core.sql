-- 0001_core: extensions, enums, identity, RBAC, settings, areas, audit
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type service_type as enum ('cable_tv', 'internet');
create type customer_status as enum ('pending', 'active', 'inactive', 'suspended', 'archived');
create type subscription_status as enum ('pending', 'active', 'suspended', 'expired', 'cancelled');
create type invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'cancelled');
create type payment_method as enum ('cash', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'gateway', 'other');
create type verification_status as enum ('pending', 'verified', 'failed', 'reversed');
create type ticket_status as enum ('open', 'assigned', 'in_progress', 'waiting_customer', 'escalated', 'resolved', 'closed');
create type ticket_priority as enum ('low', 'medium', 'high', 'urgent');

-- Time helpers (all business dates are Asia/Dhaka) --------------------------
create or replace function dhaka_today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Dhaka')::date $$;

create or replace function set_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;

-- Identity -------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  username text unique,
  phone text,
  email text,
  language text not null default 'bn' check (language in ('bn', 'en')),
  avatar_url text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_phone_idx on profiles (phone);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

create table roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_bn text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null,
  description text
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  user_id uuid not null references profiles(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  assigned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- Per-employee grants/denials layered over role permissions
create table user_permissions (
  user_id uuid not null references profiles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  granted boolean not null,
  primary key (user_id, permission_id)
);

-- Authorization helpers (SECURITY DEFINER so RLS policies can call them) -----
create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_active from profiles where id = auth.uid()), false) $$;

create or replace function has_role(p_code text) returns boolean
language sql stable security definer set search_path = public as
$$
  select is_active_user() and exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code = p_code)
$$;

create or replace function is_super_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select has_role('super_admin') $$;

create or replace function has_permission(p_code text) returns boolean
language plpgsql stable security definer set search_path = public as
$$
declare v_override boolean;
begin
  if auth.uid() is null or not is_active_user() then return false; end if;
  if is_super_admin() then return true; end if;
  select up.granted into v_override
    from user_permissions up join permissions p on p.id = up.permission_id
   where up.user_id = auth.uid() and p.code = p_code;
  if v_override is not null then return v_override; end if;
  return exists (
    select 1 from user_roles ur
      join role_permissions rp on rp.role_id = ur.role_id
      join permissions p on p.id = rp.permission_id
     where ur.user_id = auth.uid() and p.code = p_code);
end $$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$
  select is_active_user() and exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code <> 'customer')
$$;

-- Only a Super Admin may hand out the super_admin role
create or replace function guard_role_assignment() returns trigger language plpgsql
security definer set search_path = public as
$$
begin
  if exists (select 1 from roles where id = new.role_id and code = 'super_admin')
     and auth.uid() is not null and not is_super_admin() then
    raise exception 'Only a Super Admin can assign the super_admin role' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger user_roles_guard before insert on user_roles for each row execute function guard_role_assignment();

-- Create a profile for every new auth user (no roles by default)
create or replace function handle_new_user() returns trigger language plpgsql
security definer set search_path = public as
$$
begin
  insert into profiles (id, full_name, phone, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.phone, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Settings -------------------------------------------------------------------
create table system_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  description text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create trigger system_settings_updated before update on system_settings for each row execute function set_updated_at();

create or replace function setting_text(p_key text, p_default text default null) returns text
language sql stable security definer set search_path = public as
$$ select coalesce((select value #>> '{}' from system_settings where key = p_key), p_default) $$;

create or replace function setting_int(p_key text, p_default int default null) returns int
language sql stable security definer set search_path = public as
$$ select coalesce((select (value #>> '{}')::int from system_settings where key = p_key), p_default) $$;

-- Integration configuration. SECRETS NEVER LIVE HERE: they are Edge Function secrets.
create table integration_configs (
  provider text primary key,            -- sslcommerz | bkash | nagad | sms | email | whatsapp | mikrotik
  category text not null,
  enabled boolean not null default false,
  mode text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  public_config jsonb not null default '{}',
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- Branches and areas ---------------------------------------------------------
create table branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_bn text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table service_areas (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  code text not null unique,
  name text not null,
  name_bn text,
  description text,
  coverage_info text,
  network_nodes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger service_areas_updated before update on service_areas for each row execute function set_updated_at();

-- Gapless-ish document numbering ---------------------------------------------
create table number_counters (
  scope text not null,
  period text not null default '',
  last_value bigint not null default 0,
  primary key (scope, period)
);

create or replace function next_number(p_scope text, p_period text default '') returns bigint
language plpgsql security definer set search_path = public as
$$
declare v bigint;
begin
  insert into number_counters (scope, period, last_value) values (p_scope, p_period, 1)
  on conflict (scope, period) do update set last_value = number_counters.last_value + 1
  returning last_value into v;
  return v;
end $$;
revoke all on function next_number(text, text) from public, anon, authenticated;

-- Audit ----------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  category text not null default 'data',  -- data | financial | auth | router
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb
);
create index audit_logs_time_idx on audit_logs (occurred_at desc);
create index audit_logs_record_idx on audit_logs (table_name, record_id);
create index audit_logs_actor_idx on audit_logs (actor_id);

create or replace function audit_row() returns trigger language plpgsql
security definer set search_path = public as
$$
declare v_cat text := coalesce(tg_argv[0], 'data'); v_id text;
begin
  v_id := coalesce((to_jsonb(coalesce(new, old))->>'id'), '');
  insert into audit_logs (actor_id, category, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), v_cat, tg_op, tg_table_name, v_id,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function audit_logs_immutable() returns trigger language plpgsql as
$$ begin raise exception 'audit_logs is append-only'; end $$;
create trigger audit_logs_no_change before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

create trigger audit_user_roles after insert or update or delete on user_roles
  for each row execute function audit_row('data');
create trigger audit_user_permissions after insert or update or delete on user_permissions
  for each row execute function audit_row('data');
create trigger audit_role_permissions after insert or update or delete on role_permissions
  for each row execute function audit_row('data');
create trigger audit_system_settings after insert or update or delete on system_settings
  for each row execute function audit_row('data');
create trigger audit_service_areas after insert or update or delete on service_areas
  for each row execute function audit_row('data');
