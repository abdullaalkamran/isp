-- 0004: staff, collections, network, installation, support, expenses, notifications
create table staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  employee_code text unique,
  designation text,
  branch_id uuid references branches(id),
  area_id uuid references service_areas(id),
  joined_at date,
  created_at timestamptz not null default now()
);

create table technicians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  area_id uuid references service_areas(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table collection_agents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles(id) on delete cascade,
  daily_target numeric(12,2) not null default 0 check (daily_target >= 0),
  monthly_target numeric(12,2) not null default 0 check (monthly_target >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table cash_deposits (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  deposited_at timestamptz not null default now(),
  reference text,
  notes text,
  status text not null default 'submitted' check (status in ('submitted', 'reconciled', 'rejected')),
  reconciled_by uuid references profiles(id),
  reconciled_at timestamptz,
  created_at timestamptz not null default now()
);
create index cash_deposits_agent_idx on cash_deposits (agent_id, deposited_at desc);

create table cash_collections (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references payments(id),
  agent_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  collected_at timestamptz not null default now(),
  deposit_id uuid references cash_deposits(id),
  status text not null default 'held' check (status in ('held', 'deposited', 'reconciled'))
);
create index cash_collections_agent_idx on cash_collections (agent_id, collected_at desc);

-- MikroTik / network ---------------------------------------------------------------
create table routers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host text not null,
  api_port int not null default 8728 check (api_port between 1 and 65535),
  use_tls boolean not null default true,
  location text,
  model text,
  routeros_version text,
  area_id uuid references service_areas(id),
  status text not null default 'unconfigured' check (status in ('unconfigured', 'online', 'offline', 'degraded')),
  last_sync_at timestamptz,
  last_seen_at timestamptz,
  active_session_count int not null default 0,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger routers_updated before update on routers for each row execute function set_updated_at();

-- Encrypted credentials. RLS enabled with NO policies: only the service role (Edge Functions) can read.
create table router_credentials (
  router_id uuid primary key references routers(id) on delete cascade,
  api_username text not null,
  encrypted_password text not null,   -- AES-GCM ciphertext produced by the Edge Function
  updated_at timestamptz not null default now()
);

create table mikrotik_accounts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null unique references subscriptions(id),
  router_id uuid not null references routers(id),
  pppoe_username text not null unique,
  router_profile text,
  download_mbps int,
  upload_mbps int,
  static_ip inet,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'disabled', 'error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mikrotik_accounts_router_idx on mikrotik_accounts (router_id);
create trigger mikrotik_accounts_updated before update on mikrotik_accounts for each row execute function set_updated_at();

create table mikrotik_account_secrets (
  account_id uuid primary key references mikrotik_accounts(id) on delete cascade,
  encrypted_password text not null,
  updated_at timestamptz not null default now()
);

alter table subscriptions add constraint subscriptions_router_fk foreign key (router_id) references routers(id);
alter table subscriptions add constraint subscriptions_mt_fk foreign key (mikrotik_account_id) references mikrotik_accounts(id);

create table network_sessions (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers(id) on delete cascade,
  account_id uuid references mikrotik_accounts(id),
  pppoe_username text not null,
  caller_id text,
  address inet,
  uptime_seconds bigint,
  bytes_in bigint,
  bytes_out bigint,
  captured_at timestamptz not null default now()
);
create index network_sessions_router_idx on network_sessions (router_id, captured_at desc);

create table network_commands (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers(id),
  account_id uuid references mikrotik_accounts(id),
  command_type text not null check (command_type in
    ('create_account', 'update_profile', 'suspend', 'reactivate', 'disconnect_session', 'sync_sessions', 'ping')),
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  result jsonb,
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index network_commands_queue_idx on network_commands (next_attempt_at) where status in ('queued', 'running');
create index network_commands_router_idx on network_commands (router_id, created_at desc);

create table network_sync_logs (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references routers(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('success', 'failed', 'partial')),
  drift_count int not null default 0,
  message text
);

-- Installation & support -------------------------------------------------------------
create table installation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null unique default '',
  customer_id uuid not null references customers(id),
  subscription_id uuid references subscriptions(id),
  technician_id uuid references profiles(id),
  status text not null default 'pending' check (status in ('pending', 'assigned', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  checklist jsonb not null default '[]',
  equipment jsonb not null default '[]',
  router_details text,
  work_notes text,
  customer_acknowledged boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index installation_jobs_tech_idx on installation_jobs (technician_id, status);
create index installation_jobs_customer_idx on installation_jobs (customer_id);
create trigger installation_jobs_updated before update on installation_jobs for each row execute function set_updated_at();

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique default '',
  customer_id uuid not null references customers(id),
  subscription_id uuid references subscriptions(id),
  service_type service_type,
  category text not null check (category in ('new_connection', 'installation', 'internet_not_working', 'slow_internet',
    'cable_problem', 'router_problem', 'payment_issue', 'package_change', 'disconnection_request', 'other')),
  subject text not null,
  description text,
  priority ticket_priority not null default 'medium',
  status ticket_status not null default 'open',
  assigned_technician_id uuid references profiles(id),
  assigned_by uuid references profiles(id),
  scheduled_visit_at timestamptz,
  due_date date,
  resolution text,
  resolved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_customer_idx on support_tickets (customer_id, created_at desc);
create index support_tickets_status_idx on support_tickets (status);
create index support_tickets_tech_idx on support_tickets (assigned_technician_id, status);
create trigger support_tickets_updated before update on support_tickets for each row execute function set_updated_at();

create or replace function ops_numbering() returns trigger language plpgsql as
$$
begin
  if tg_table_name = 'support_tickets' and (new.ticket_no is null or new.ticket_no = '') then
    new.ticket_no := 'T' || lpad(next_number('ticket')::text, 6, '0');
  elsif tg_table_name = 'installation_jobs' and (new.job_no is null or new.job_no = '') then
    new.job_no := 'J' || lpad(next_number('installation_job')::text, 6, '0');
  end if;
  return new;
end $$;
create trigger support_tickets_no before insert on support_tickets for each row execute function ops_numbering();
create trigger installation_jobs_no before insert on installation_jobs for each row execute function ops_numbering();

create or replace function ticket_resolution_stamp() returns trigger language plpgsql as
$$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.resolved_at := now(); end if;
  if new.status = 'assigned' and old.status = 'open' and new.assigned_technician_id is null then
    raise exception 'assign a technician before moving the ticket to Assigned';
  end if;
  return new;
end $$;
create trigger support_tickets_stamp before update on support_tickets for each row execute function ticket_resolution_stamp();

create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null check (length(trim(body)) > 0),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index ticket_comments_ticket_idx on ticket_comments (ticket_id, created_at);

create table ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  uploaded_by uuid references profiles(id),
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  created_at timestamptz not null default now()
);
create index ticket_attachments_ticket_idx on ticket_attachments (ticket_id);

-- Expenses -----------------------------------------------------------------------------
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_bn text not null,
  is_active boolean not null default true
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references expense_categories(id),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default dhaka_today(),
  payment_method payment_method not null default 'cash',
  reference text,
  attachment_path text,
  notes text,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on expenses (expense_date);
create trigger audit_expenses after insert or update or delete on expenses for each row execute function audit_row('financial');

-- Notifications ----------------------------------------------------------------------------
create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  channel text not null check (channel in ('in_app', 'sms', 'email', 'whatsapp')),
  language text not null check (language in ('bn', 'en')),
  subject text,
  body text not null,
  is_active boolean not null default true,
  unique (event, channel, language)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create unique index notifications_dedupe_uq on notifications (user_id, dedupe_key) where dedupe_key is not null;

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references profiles(id),
  recipient_address text,
  channel text not null,
  event text not null,
  dedupe_key text,
  status text not null check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_response jsonb,
  error text,
  created_at timestamptz not null default now()
);
create unique index notification_logs_dedupe_uq on notification_logs (channel, recipient_address, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'sent');

create trigger audit_routers after insert or update or delete on routers for each row execute function audit_row('router');
create trigger audit_mikrotik_accounts after insert or update or delete on mikrotik_accounts for each row execute function audit_row('router');
create trigger audit_network_commands after insert or update on network_commands for each row execute function audit_row('router');
create trigger audit_cash_deposits after insert or update on cash_deposits for each row execute function audit_row('financial');
create trigger audit_tickets after insert or update on support_tickets for each row execute function audit_row('data');
