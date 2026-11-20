-- 0007: roles, permissions, role mapping, default (editable) settings, expense categories
insert into roles (code, name, name_bn) values
  ('super_admin', 'Super Admin', 'সুপার অ্যাডমিন'),
  ('administrator', 'Administrator', 'অ্যাডমিনিস্ট্রেটর'),
  ('accountant', 'Accountant', 'হিসাবরক্ষক'),
  ('billing_officer', 'Billing Officer', 'বিলিং কর্মকর্তা'),
  ('collection_agent', 'Collection Agent', 'কালেকশন এজেন্ট'),
  ('technician', 'Technician', 'টেকনিশিয়ান'),
  ('support_officer', 'Customer Support Officer', 'কাস্টমার সাপোর্ট অফিসার'),
  ('customer', 'Customer', 'গ্রাহক')
on conflict (code) do nothing;

insert into permissions (code, module) values
  ('dashboard.view','dashboard'),
  ('customers.read_all','customers'),('customers.read_assigned','customers'),('customers.create','customers'),
  ('customers.update','customers'),('customers.archive','customers'),('customers.view_nid','customers'),('customers.notes','customers'),
  ('packages.manage','packages'),
  ('subscriptions.read','subscriptions'),('subscriptions.manage','subscriptions'),('subscriptions.change_status','subscriptions'),
  ('billing.generate','billing'),
  ('invoices.read','invoices'),('invoices.read_assigned','invoices'),('invoices.adjust','invoices'),('invoices.cancel','invoices'),
  ('payments.read','payments'),('payments.create','payments'),('payments.create_cash','payments'),('payments.verify','payments'),('payments.refund','payments'),
  ('collections.read','collections'),('collections.manage','collections'),('collections.record','collections'),
  ('expenses.read','expenses'),('expenses.manage','expenses'),('expenses.approve','expenses'),
  ('network.read','network'),('network.manage','network'),('network.credentials','network'),
  ('tickets.read_all','support'),('tickets.read_assigned','support'),('tickets.manage','support'),('tickets.comment_internal','support'),
  ('installations.read_all','installations'),('installations.read_assigned','installations'),('installations.manage','installations'),
  ('staff.read','staff'),('staff.manage','staff'),
  ('areas.manage','areas'),
  ('reports.view','reports'),('reports.financial','reports'),
  ('notifications.manage','notifications'),
  ('settings.read','settings'),('settings.manage','settings'),
  ('audit.read','audit'),('roles.manage','roles')
on conflict (code) do nothing;

-- role -> permission map (super_admin is implicit-all in has_permission)
with m(role, perms) as (values
  ('administrator', array['dashboard.view','customers.read_all','customers.create','customers.update','customers.archive','customers.notes',
     'packages.manage','subscriptions.read','subscriptions.manage','subscriptions.change_status','invoices.read','payments.read',
     'collections.read','collections.manage','network.read','network.manage','tickets.read_all','tickets.manage','tickets.comment_internal',
     'installations.read_all','installations.manage','staff.read','staff.manage','areas.manage','reports.view','notifications.manage','settings.read','expenses.read']),
  ('accountant', array['dashboard.view','customers.read_all','subscriptions.read','invoices.read','invoices.adjust','invoices.cancel',
     'payments.read','payments.create','payments.create_cash','payments.verify','payments.refund','collections.read','collections.manage',
     'expenses.read','expenses.manage','expenses.approve','reports.view','reports.financial']),
  ('billing_officer', array['dashboard.view','customers.read_all','subscriptions.read','subscriptions.manage','billing.generate',
     'invoices.read','payments.read','reports.view','notifications.manage']),
  ('collection_agent', array['customers.read_assigned','invoices.read_assigned','payments.create_cash','collections.record']),
  ('technician', array['customers.read_assigned','tickets.read_assigned','installations.read_assigned','tickets.comment_internal']),
  ('support_officer', array['dashboard.view','customers.read_all','customers.notes','subscriptions.read','tickets.read_all','tickets.manage',
     'tickets.comment_internal','installations.read_all']),
  ('customer', array[]::text[]))
insert into role_permissions (role_id, permission_id)
select r.id, p.id from m join roles r on r.code = m.role join permissions p on p.code = any (m.perms)
on conflict do nothing;

-- Defaults. Everything business-specific is editable in Settings; nothing is hardcoded in the app.
insert into system_settings (key, value, is_public, description) values
  ('company.name', '""', true, 'Company name'),
  ('company.name_bn', '""', true, 'Company name (Bangla)'),
  ('company.address', '""', true, null),
  ('company.phone', '""', true, null),
  ('company.email', '""', true, null),
  ('company.website', '""', true, null),
  ('company.logo_url', '""', true, null),
  ('general.currency', '"BDT"', true, null),
  ('general.timezone', '"Asia/Dhaka"', true, null),
  ('general.default_language', '"bn"', true, null),
  ('billing.cycle', '"monthly"', false, null),
  ('billing.generation_day', '1', false, 'Day of month invoices are generated'),
  ('billing.due_day', '10', false, 'Day of month invoices fall due'),
  ('billing.grace_days', '3', false, 'Days after due date before suspension'),
  ('billing.late_fee_amount', '0', false, 'Flat late fee in BDT (0 = disabled)'),
  ('billing.tax_percent', '0', false, null),
  ('billing.proration', '"none"', false, 'none | daily'),
  ('billing.invoice_prefix', '"INV"', false, null),
  ('services.auto_suspend', '"false"', false, 'Suspend automatically after grace period'),
  ('services.auto_reactivate', '"false"', false, 'Reactivate automatically once cleared'),
  ('network.sync_interval_minutes', '15', false, null),
  ('security.session_timeout_minutes', '60', false, null),
  ('security.max_login_attempts', '5', false, null)
on conflict (key) do nothing;

insert into integration_configs (provider, category, enabled, mode) values
  ('sslcommerz', 'payment', false, 'sandbox'), ('bkash', 'payment', false, 'sandbox'), ('nagad', 'payment', false, 'sandbox'),
  ('sms', 'notification', false, 'sandbox'), ('email', 'notification', false, 'sandbox'), ('whatsapp', 'notification', false, 'sandbox'),
  ('mikrotik', 'network', false, 'sandbox')
on conflict (provider) do nothing;

insert into expense_categories (code, name, name_bn) values
  ('bandwidth', 'Bandwidth cost', 'ব্যান্ডউইথ খরচ'), ('equipment', 'Network equipment', 'নেটওয়ার্ক যন্ত্রপাতি'),
  ('salary', 'Staff salary', 'কর্মী বেতন'), ('rent', 'Office rent', 'অফিস ভাড়া'), ('electricity', 'Electricity', 'বিদ্যুৎ'),
  ('maintenance', 'Maintenance', 'রক্ষণাবেক্ষণ'), ('transport', 'Transportation', 'যাতায়াত'),
  ('marketing', 'Marketing', 'বিপণন'), ('other', 'Other expenses', 'অন্যান্য খরচ')
on conflict (code) do nothing;
