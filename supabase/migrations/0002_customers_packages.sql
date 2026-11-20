-- 0002: customers, packages, subscriptions
create table customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null,
  alt_phone text,
  email text,
  address text,
  area_id uuid references service_areas(id),
  road_block_house text,
  customer_type text not null default 'residential' check (customer_type in ('residential', 'business')),
  status customer_status not null default 'pending',
  installation_date date,
  assigned_collection_agent_id uuid references profiles(id),
  assigned_technician_id uuid references profiles(id),
  language text not null default 'bn' check (language in ('bn', 'en')),
  created_by uuid references profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_phone_active_uq on customers (phone) where archived_at is null;
create index customers_status_idx on customers (status);
create index customers_area_idx on customers (area_id);
create index customers_agent_idx on customers (assigned_collection_agent_id);
create index customers_tech_idx on customers (assigned_technician_id);
-- Trigram indexes: fast ILIKE search for Bangla and English text
create index customers_name_trgm on customers using gin (full_name gin_trgm_ops);
create index customers_addr_trgm on customers using gin (address gin_trgm_ops);
create index customers_phone_trgm on customers using gin (phone gin_trgm_ops);
create index customers_code_trgm on customers using gin (customer_code gin_trgm_ops);
create trigger customers_updated before update on customers for each row execute function set_updated_at();

create or replace function assign_customer_code() returns trigger language plpgsql as
$$
begin
  if new.customer_code is null or new.customer_code = '' then
    new.customer_code := 'C' || lpad(next_number('customer')::text, 6, '0');
  end if;
  return new;
end $$;
-- customer_code is NOT NULL, so give the column a placeholder default that the trigger replaces
alter table customers alter column customer_code set default '';
create trigger customers_code before insert on customers for each row execute function assign_customer_code();

-- NID lives apart so access can be restricted by permission (RLS is row-level)
create table customer_sensitive (
  customer_id uuid primary key references customers(id) on delete cascade,
  nid_number text,
  updated_at timestamptz not null default now()
);

-- Internal staff notes: invisible to customers by construction
create table customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  note text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index customer_notes_customer_idx on customer_notes (customer_id);

create table customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name text not null,
  relation text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index customer_contacts_customer_idx on customer_contacts (customer_id);

-- Packages ---------------------------------------------------------------------
create table packages (
  id uuid primary key default gen_random_uuid(),
  service_type service_type not null,
  code text not null unique,
  name text not null,
  name_bn text not null,
  description text,
  description_bn text,
  monthly_price numeric(12,2) not null check (monthly_price >= 0),
  installation_charge numeric(12,2) not null default 0 check (installation_charge >= 0),
  connection_type text,
  is_active boolean not null default true,
  -- cable
  channel_count int check (channel_count is null or channel_count >= 0),
  -- internet
  download_mbps int check (download_mbps is null or download_mbps > 0),
  upload_mbps int check (upload_mbps is null or upload_mbps > 0),
  is_unlimited boolean not null default true,
  data_limit_gb int check (data_limit_gb is null or data_limit_gb > 0),
  router_profile text,
  static_ip_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packages_internet_speed check (service_type <> 'internet' or (download_mbps is not null and upload_mbps is not null)),
  constraint packages_data_policy check (is_unlimited or data_limit_gb is not null)
);
create index packages_type_idx on packages (service_type, is_active);
create trigger packages_updated before update on packages for each row execute function set_updated_at();

create table package_features (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  feature text not null,
  feature_bn text,
  sort_order int not null default 0
);
create index package_features_pkg_idx on package_features (package_id);

create table service_price_history (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id),
  old_price numeric(12,2),
  new_price numeric(12,2) not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index service_price_history_pkg_idx on service_price_history (package_id, changed_at desc);

create or replace function log_package_price() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into service_price_history (package_id, old_price, new_price, changed_by) values (new.id, null, new.monthly_price, auth.uid());
  elsif new.monthly_price is distinct from old.monthly_price then
    insert into service_price_history (package_id, old_price, new_price, changed_by) values (new.id, old.monthly_price, new.monthly_price, auth.uid());
  end if;
  return new;
end $$;
create trigger packages_price_history after insert or update on packages for each row execute function log_package_price();

-- Services & subscriptions ------------------------------------------------------
-- One row per (customer, service category); a customer may hold both.
create table customer_services (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  service_type service_type not null,
  created_at timestamptz not null default now(),
  unique (customer_id, service_type)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscription_no text not null unique default '',
  customer_id uuid not null references customers(id),
  customer_service_id uuid references customer_services(id),
  package_id uuid not null references packages(id),
  service_type service_type not null,
  start_date date not null default dhaka_today(),
  renewal_date date,
  expiry_date date,
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'quarterly', 'yearly')),
  -- price snapshot: package price changes never silently alter this
  monthly_price numeric(12,2) not null check (monthly_price >= 0),
  status subscription_status not null default 'pending',
  installation_status text not null default 'pending' check (installation_status in ('pending', 'scheduled', 'installed', 'not_required')),
  suspended_at timestamptz,
  suspension_reason text,
  router_id uuid,
  mikrotik_account_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_customer_idx on subscriptions (customer_id);
create index subscriptions_status_idx on subscriptions (status);
create index subscriptions_package_idx on subscriptions (package_id);
create index subscriptions_expiry_idx on subscriptions (expiry_date);
create trigger subscriptions_updated before update on subscriptions for each row execute function set_updated_at();

create or replace function subscriptions_before_write() returns trigger language plpgsql as
$$
declare v_type service_type; v_cs uuid;
begin
  if tg_op = 'INSERT' then
    if new.subscription_no is null or new.subscription_no = '' then
      new.subscription_no := 'S' || lpad(next_number('subscription')::text, 7, '0');
    end if;
    select service_type into v_type from packages where id = new.package_id;
    if v_type is null then raise exception 'package not found'; end if;
    new.service_type := v_type;
    -- Server-side snapshot: ignore any client-supplied price
    select monthly_price into new.monthly_price from packages where id = new.package_id;
    insert into customer_services (customer_id, service_type) values (new.customer_id, v_type)
      on conflict (customer_id, service_type) do nothing;
    select id into v_cs from customer_services where customer_id = new.customer_id and service_type = v_type;
    new.customer_service_id := v_cs;
  end if;
  if tg_op = 'UPDATE' and new.status = 'suspended' and old.status <> 'suspended' then
    new.suspended_at := now();
  end if;
  if tg_op = 'UPDATE' and new.status = 'active' and old.status = 'suspended' then
    new.suspended_at := null; new.suspension_reason := null;
  end if;
  return new;
end $$;
create trigger subscriptions_write before insert or update on subscriptions for each row execute function subscriptions_before_write();

create table subscription_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references subscriptions(id),
  action text not null,
  old_status subscription_status,
  new_status subscription_status,
  old_package_id uuid,
  new_package_id uuid,
  old_price numeric(12,2),
  new_price numeric(12,2),
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index subscription_history_sub_idx on subscription_history (subscription_id, changed_at desc);

create or replace function log_subscription_change() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'INSERT' then
    insert into subscription_history (subscription_id, action, new_status, new_package_id, new_price, changed_by)
    values (new.id, 'created', new.status, new.package_id, new.monthly_price, auth.uid());
  elsif new.status is distinct from old.status or new.package_id is distinct from old.package_id then
    insert into subscription_history (subscription_id, action, old_status, new_status, old_package_id, new_package_id, old_price, new_price, reason, changed_by)
    values (new.id,
      case when new.package_id is distinct from old.package_id then 'package_changed' else 'status_changed' end,
      old.status, new.status, old.package_id, new.package_id, old.monthly_price, new.monthly_price,
      new.suspension_reason, auth.uid());
  end if;
  return new;
end $$;
create trigger subscriptions_history after insert or update on subscriptions for each row execute function log_subscription_change();

-- Package change keeps the subscription's own price snapshot in step *explicitly*
create or replace function change_subscription_package(p_subscription uuid, p_package uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare v_sub subscriptions; v_pkg packages;
begin
  if not has_permission('subscriptions.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_sub from subscriptions where id = p_subscription for update;
  select * into v_pkg from packages where id = p_package and is_active;
  if v_sub.id is null or v_pkg.id is null then raise exception 'subscription or package not found'; end if;
  if v_pkg.service_type <> v_sub.service_type then raise exception 'package service type mismatch'; end if;
  update subscriptions set package_id = v_pkg.id, monthly_price = v_pkg.monthly_price, suspension_reason = coalesce(p_reason, suspension_reason)
   where id = p_subscription;
end $$;

create or replace function set_subscription_status(p_subscription uuid, p_status subscription_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not has_permission('subscriptions.change_status') then raise exception 'forbidden' using errcode = '42501'; end if;
  update subscriptions set status = p_status, suspension_reason = p_reason where id = p_subscription;
  if not found then raise exception 'subscription not found'; end if;
end $$;

-- Customer lifecycle (soft only; financial history is never deleted)
create or replace function set_customer_status(p_customer uuid, p_status customer_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if p_status = 'archived' then
    if not has_permission('customers.archive') then raise exception 'forbidden' using errcode = '42501'; end if;
    update customers set status = 'archived', archived_at = now() where id = p_customer;
  else
    if not has_permission('customers.update') then raise exception 'forbidden' using errcode = '42501'; end if;
    update customers set status = p_status, archived_at = null where id = p_customer;
  end if;
  if not found then raise exception 'customer not found'; end if;
  insert into audit_logs (actor_id, category, action, table_name, record_id, metadata)
  values (auth.uid(), 'data', 'customer_status', 'customers', p_customer::text, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- Customers update only a few contact fields of their own profile, via RPC
create or replace function update_my_profile(p_alt_phone text, p_email text, p_address text, p_road text, p_language text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  update customers set alt_phone = p_alt_phone, email = p_email, address = p_address,
         road_block_house = p_road, language = coalesce(p_language, language)
   where user_id = auth.uid();
  if not found then raise exception 'no customer account for this user'; end if;
end $$;

-- Link a phone-verified auth user to the customer record with the same phone
create or replace function claim_customer_account() returns uuid
language plpgsql security definer set search_path = public as
$$
declare v_phone text; v_id uuid;
begin
  select phone into v_phone from auth.users where id = auth.uid();
  if v_phone is null then raise exception 'phone not verified'; end if;
  -- Compare the last 10 digits so +8801XXXXXXXXX and 01XXXXXXXXX match
  select id into v_id from customers
   where user_id is null and archived_at is null
     and right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10)
   limit 1;
  if v_id is null then raise exception 'no customer record matches this phone number'; end if;
  update customers set user_id = auth.uid() where id = v_id;
  insert into user_roles (user_id, role_id) select auth.uid(), id from roles where code = 'customer'
    on conflict do nothing;
  return v_id;
end $$;

-- Access scope used by RLS on every customer-owned table ------------------------
create or replace function current_customer_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from customers where user_id = auth.uid() $$;

create table collection_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles(id),
  customer_id uuid references customers(id),
  area_id uuid references service_areas(id),
  created_at timestamptz not null default now(),
  check ((customer_id is not null) <> (area_id is not null))
);
create index collection_assignments_agent_idx on collection_assignments (agent_id);

-- Does the signed-in staff member have *assigned* access to this customer?
-- plpgsql => late-bound, so it may reference installation_jobs (created in 0004).
create or replace function is_assigned_to_customer(p_customer uuid) returns boolean
language plpgsql stable security definer set search_path = public as
$$
begin
  return exists (
    select 1 from customers c
     where c.id = p_customer
       and (c.assigned_collection_agent_id = auth.uid()
         or c.assigned_technician_id = auth.uid()
         or exists (select 1 from collection_assignments a
                     where a.agent_id = auth.uid()
                       and (a.customer_id = c.id or (a.area_id is not null and a.area_id = c.area_id)))
         or exists (select 1 from installation_jobs j
                     where j.customer_id = c.id and j.technician_id = auth.uid())
         or exists (select 1 from support_tickets t
                     where t.customer_id = c.id and t.assigned_technician_id = auth.uid())));
end $$;
