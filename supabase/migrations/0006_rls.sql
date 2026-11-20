-- 0006: Row Level Security. Default deny; every table opts in explicitly.
do $$
declare t text;
begin
  for t in select unnest(array[
    'profiles','roles','permissions','role_permissions','user_roles','user_permissions','system_settings','integration_configs',
    'branches','service_areas','number_counters','audit_logs','customers','customer_sensitive','customer_notes','customer_contacts',
    'packages','package_features','service_price_history','customer_services','subscriptions','subscription_history',
    'collection_assignments','invoices','invoice_items','invoice_adjustments','credit_notes','payments','payment_allocations',
    'payment_gateway_transactions','refunds','staff','technicians','collection_agents','cash_deposits','cash_collections',
    'routers','router_credentials','mikrotik_accounts','mikrotik_account_secrets','network_sessions','network_commands',
    'network_sync_logs','installation_jobs','support_tickets','ticket_comments','ticket_attachments','expense_categories',
    'expenses','notification_templates','notifications','notification_logs'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Table privileges: clients never write money tables directly --------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on system_settings to anon;      -- policy limits this to is_public rows

grant select on profiles, roles, permissions, role_permissions, user_roles, user_permissions, system_settings, integration_configs,
  branches, service_areas, customers, customer_sensitive, customer_notes, customer_contacts, packages, package_features,
  service_price_history, customer_services, subscriptions, subscription_history, collection_assignments, invoices, invoice_items,
  invoice_adjustments, credit_notes, payments, payment_allocations, payment_gateway_transactions, refunds, staff, technicians,
  collection_agents, cash_deposits, cash_collections, routers, mikrotik_accounts, network_sessions, network_commands,
  network_sync_logs, installation_jobs, support_tickets, ticket_comments, ticket_attachments, expense_categories, expenses,
  notification_templates, notifications, audit_logs to authenticated;
-- never granted to clients: router_credentials, mikrotik_account_secrets, number_counters, notification_logs (service role only)
grant select on notification_logs to authenticated;

-- column-level writes for self-service profile edits
grant update (full_name, phone, language, avatar_url) on profiles to authenticated;
grant update (read_at) on notifications to authenticated;
-- plain CRUD tables managed through policies (writes still need the matching permission)
grant insert, update on customers, customer_sensitive, packages, service_areas, branches, routers, collection_assignments,
  staff, technicians, collection_agents, installation_jobs, expense_categories, expenses, notification_templates,
  integration_configs, system_settings, mikrotik_accounts, cash_deposits to authenticated;
grant delete on package_features, collection_assignments to authenticated;
grant insert, update on package_features to authenticated;
grant insert on customer_notes, customer_contacts, subscriptions, support_tickets, ticket_comments, ticket_attachments, user_roles, user_permissions, role_permissions to authenticated;
grant update on subscriptions, support_tickets to authenticated;
grant delete on user_roles, user_permissions, role_permissions to authenticated;

-- Policy helper: may the caller see this customer's records? ----------------------------------------
create or replace function can_see_customer(p_customer uuid, p_perm_all text, p_perm_assigned text default null) returns boolean
language sql stable security definer set search_path = public as
$$
  select p_customer = current_customer_id()
      or has_permission(p_perm_all)
      or (p_perm_assigned is not null and has_permission(p_perm_assigned) and is_assigned_to_customer(p_customer))
$$;

-- identity / rbac ------------------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated using (id = auth.uid() or has_permission('staff.read'));
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy roles_select on roles for select to authenticated using (true);
create policy permissions_select on permissions for select to authenticated using (true);
create policy role_permissions_select on role_permissions for select to authenticated using (true);
create policy role_permissions_write on role_permissions for all to authenticated using (has_permission('roles.manage')) with check (has_permission('roles.manage'));
create policy user_roles_select on user_roles for select to authenticated using (user_id = auth.uid() or has_permission('staff.read'));
create policy user_roles_write on user_roles for all to authenticated using (has_permission('staff.manage')) with check (has_permission('staff.manage'));
create policy user_permissions_select on user_permissions for select to authenticated using (user_id = auth.uid() or has_permission('staff.read'));
create policy user_permissions_write on user_permissions for all to authenticated using (has_permission('roles.manage')) with check (has_permission('roles.manage'));

create policy settings_public_read on system_settings for select to anon, authenticated using (is_public);
create policy settings_staff_read on system_settings for select to authenticated using (has_permission('settings.read'));
create policy settings_write on system_settings for all to authenticated using (has_permission('settings.manage')) with check (has_permission('settings.manage'));
create policy integrations_read on integration_configs for select to authenticated using (has_permission('settings.read'));
create policy integrations_write on integration_configs for all to authenticated using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

create policy branches_read on branches for select to authenticated using (is_staff());
create policy branches_write on branches for all to authenticated using (has_permission('areas.manage')) with check (has_permission('areas.manage'));
create policy areas_read on service_areas for select to authenticated using (true);
create policy areas_write on service_areas for all to authenticated using (has_permission('areas.manage')) with check (has_permission('areas.manage'));

create policy audit_read on audit_logs for select to authenticated using (has_permission('audit.read'));

-- customers ---------------------------------------------------------------------------------------------
create policy customers_select on customers for select to authenticated using (can_see_customer(id, 'customers.read_all', 'customers.read_assigned'));
create policy customers_insert on customers for insert to authenticated with check (has_permission('customers.create'));
create policy customers_update on customers for update to authenticated using (has_permission('customers.update')) with check (has_permission('customers.update'));
create policy cust_sensitive_select on customer_sensitive for select to authenticated using (has_permission('customers.view_nid'));
create policy cust_sensitive_write on customer_sensitive for all to authenticated using (has_permission('customers.view_nid')) with check (has_permission('customers.view_nid'));
create policy cust_notes_select on customer_notes for select to authenticated using (has_permission('customers.notes'));
create policy cust_notes_insert on customer_notes for insert to authenticated with check (has_permission('customers.notes') and created_by = auth.uid());
create policy cust_contacts_select on customer_contacts for select to authenticated using (can_see_customer(customer_id, 'customers.read_all', 'customers.read_assigned'));
create policy cust_contacts_insert on customer_contacts for insert to authenticated with check (has_permission('customers.update'));

-- packages & subscriptions ------------------------------------------------------------------------------------
create policy packages_select on packages for select to authenticated using (is_active or has_permission('packages.manage'));
create policy packages_write on packages for all to authenticated using (has_permission('packages.manage')) with check (has_permission('packages.manage'));
create policy pkg_features_select on package_features for select to authenticated using (true);
create policy pkg_features_write on package_features for all to authenticated using (has_permission('packages.manage')) with check (has_permission('packages.manage'));
create policy price_history_select on service_price_history for select to authenticated using (has_permission('packages.manage') or has_permission('subscriptions.read'));
create policy cust_services_select on customer_services for select to authenticated using (can_see_customer(customer_id, 'subscriptions.read', 'customers.read_assigned'));
create policy subs_select on subscriptions for select to authenticated using (can_see_customer(customer_id, 'subscriptions.read', 'customers.read_assigned'));
create policy subs_insert on subscriptions for insert to authenticated with check (has_permission('subscriptions.manage'));
create policy subs_update on subscriptions for update to authenticated using (has_permission('subscriptions.manage')) with check (has_permission('subscriptions.manage'));
create policy sub_history_select on subscription_history for select to authenticated using (
  exists (select 1 from subscriptions s where s.id = subscription_id and can_see_customer(s.customer_id, 'subscriptions.read', null)));

-- billing & payments: read-only for clients; all writes via RPC ---------------------------------------------------------
create policy invoices_select on invoices for select to authenticated using (
  customer_id = current_customer_id() and status <> 'draft'
  or has_permission('invoices.read')
  or (has_permission('invoices.read_assigned') and is_assigned_to_customer(customer_id)));
create policy invoice_items_select on invoice_items for select to authenticated using (
  exists (select 1 from invoices i where i.id = invoice_id));      -- inherits invoices RLS
create policy invoice_adj_select on invoice_adjustments for select to authenticated using (has_permission('invoices.read'));
create policy credit_notes_select on credit_notes for select to authenticated using (customer_id = current_customer_id() or has_permission('invoices.read'));
create policy payments_select on payments for select to authenticated using (
  customer_id = current_customer_id()
  or has_permission('payments.read')
  or (has_permission('payments.create_cash') and (collection_agent_id = auth.uid() or is_assigned_to_customer(customer_id))));
create policy allocations_select on payment_allocations for select to authenticated using (
  exists (select 1 from payments p where p.id = payment_id));       -- inherits payments RLS
create policy gateway_txn_select on payment_gateway_transactions for select to authenticated using (customer_id = current_customer_id() or has_permission('payments.read'));
create policy refunds_select on refunds for select to authenticated using (customer_id = current_customer_id() or has_permission('payments.read'));

-- collections -------------------------------------------------------------------------------------------------------------
create policy coll_assign_select on collection_assignments for select to authenticated using (agent_id = auth.uid() or has_permission('collections.read'));
create policy coll_assign_write on collection_assignments for all to authenticated using (has_permission('collections.manage')) with check (has_permission('collections.manage'));
create policy agents_select on collection_agents for select to authenticated using (profile_id = auth.uid() or has_permission('collections.read'));
create policy agents_write on collection_agents for all to authenticated using (has_permission('collections.manage')) with check (has_permission('collections.manage'));
create policy cash_coll_select on cash_collections for select to authenticated using (agent_id = auth.uid() or has_permission('collections.read'));
create policy deposits_select on cash_deposits for select to authenticated using (agent_id = auth.uid() or has_permission('collections.read'));
create policy deposits_insert on cash_deposits for insert to authenticated with check (agent_id = auth.uid() and has_permission('collections.record') and status = 'submitted');
create policy deposits_update on cash_deposits for update to authenticated using (has_permission('collections.manage')) with check (has_permission('collections.manage'));

-- staff ---------------------------------------------------------------------------------------------------------------------
create policy staff_select on staff for select to authenticated using (profile_id = auth.uid() or has_permission('staff.read'));
create policy staff_write on staff for all to authenticated using (has_permission('staff.manage')) with check (has_permission('staff.manage'));
create policy tech_select on technicians for select to authenticated using (profile_id = auth.uid() or is_staff());
create policy tech_write on technicians for all to authenticated using (has_permission('staff.manage')) with check (has_permission('staff.manage'));

-- network (credential tables intentionally have no policy => service role only) ------------------------------------------------
create policy routers_select on routers for select to authenticated using (has_permission('network.read'));
create policy routers_write on routers for all to authenticated using (has_permission('network.manage')) with check (has_permission('network.manage'));
create policy mt_accounts_select on mikrotik_accounts for select to authenticated using (has_permission('network.read'));
create policy mt_accounts_write on mikrotik_accounts for all to authenticated using (has_permission('network.manage')) with check (has_permission('network.manage'));
create policy sessions_select on network_sessions for select to authenticated using (has_permission('network.read'));
create policy commands_select on network_commands for select to authenticated using (has_permission('network.read'));
create policy sync_logs_select on network_sync_logs for select to authenticated using (has_permission('network.read'));

-- installation & support ------------------------------------------------------------------------------------------------------
create policy install_select on installation_jobs for select to authenticated using (
  has_permission('installations.read_all') or technician_id = auth.uid() or customer_id = current_customer_id());
create policy install_insert on installation_jobs for insert to authenticated with check (has_permission('installations.manage'));
create policy install_update on installation_jobs for update to authenticated using (
  has_permission('installations.manage') or (technician_id = auth.uid() and has_permission('installations.read_assigned')))
  with check (has_permission('installations.manage') or (technician_id = auth.uid() and has_permission('installations.read_assigned')));

create policy tickets_select on support_tickets for select to authenticated using (
  customer_id = current_customer_id() or has_permission('tickets.read_all')
  or (assigned_technician_id = auth.uid() and has_permission('tickets.read_assigned')));
create policy tickets_insert_customer on support_tickets for insert to authenticated with check (
  (customer_id = current_customer_id() and status = 'open' and assigned_technician_id is null and created_by = auth.uid())
  or has_permission('tickets.manage'));
create policy tickets_update on support_tickets for update to authenticated using (
  has_permission('tickets.manage') or (assigned_technician_id = auth.uid() and has_permission('tickets.read_assigned')))
  with check (has_permission('tickets.manage') or (assigned_technician_id = auth.uid() and has_permission('tickets.read_assigned')));
create policy ticket_comments_select on ticket_comments for select to authenticated using (
  exists (select 1 from support_tickets t where t.id = ticket_id)                       -- inherits ticket visibility
  and (not is_internal or is_staff()));                                                  -- customers never see internal notes
create policy ticket_comments_insert on ticket_comments for insert to authenticated with check (
  author_id = auth.uid() and exists (select 1 from support_tickets t where t.id = ticket_id)
  and (not is_internal or (is_staff() and has_permission('tickets.comment_internal'))));
create policy ticket_att_select on ticket_attachments for select to authenticated using (exists (select 1 from support_tickets t where t.id = ticket_id));
create policy ticket_att_insert on ticket_attachments for insert to authenticated with check (
  uploaded_by = auth.uid() and exists (select 1 from support_tickets t where t.id = ticket_id));

-- expenses / notifications ------------------------------------------------------------------------------------------------------
create policy exp_cat_select on expense_categories for select to authenticated using (has_permission('expenses.read'));
create policy exp_cat_write on expense_categories for all to authenticated using (has_permission('expenses.manage')) with check (has_permission('expenses.manage'));
create policy expenses_select on expenses for select to authenticated using (has_permission('expenses.read'));
create policy expenses_insert on expenses for insert to authenticated with check (has_permission('expenses.manage') and created_by = auth.uid());
create policy expenses_update on expenses for update to authenticated using (has_permission('expenses.manage')) with check (has_permission('expenses.manage'));
create policy templates_select on notification_templates for select to authenticated using (has_permission('notifications.manage'));
create policy templates_write on notification_templates for all to authenticated using (has_permission('notifications.manage')) with check (has_permission('notifications.manage'));
create policy notifications_select on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_logs_select on notification_logs for select to authenticated using (has_permission('notifications.manage'));

-- Explicitly lock down RPCs: only signed-in users may call the public ones -----------------------------------------------------
do $$
declare f text;
begin
  for f in select unnest(array[
    'change_subscription_package(uuid,uuid,text)','set_subscription_status(uuid,subscription_status,text)',
    'set_customer_status(uuid,customer_status,text)','update_my_profile(text,text,text,text,text)','claim_customer_account()',
    'record_payment(uuid,numeric,payment_method,text,uuid[],timestamptz,text)','verify_payment(uuid,boolean,text)',
    'create_refund(uuid,numeric,text)','apply_invoice_adjustment(uuid,text,numeric,text)','create_credit_note(uuid,numeric,text)',
    'cancel_invoice(uuid,text)','issue_invoice(uuid)','generate_invoices(date,uuid[],boolean)','customer_credit(uuid)',
    'has_permission(text)','has_role(text)','is_staff()','is_super_admin()','current_customer_id()','is_assigned_to_customer(uuid)','can_see_customer(uuid,text,text)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

revoke all on function setting_text(text, text) from public, anon, authenticated;
revoke all on function setting_int(text, int) from public, anon, authenticated;

-- Numbering/guard triggers need to call internal helpers the client role cannot execute.
alter function assign_customer_code() security definer set search_path = public;
alter function subscriptions_before_write() security definer set search_path = public;
alter function invoices_guard() security definer set search_path = public;
alter function payments_guard() security definer set search_path = public;
alter function numbering_defaults() security definer set search_path = public;
alter function ops_numbering() security definer set search_path = public;
alter function invoice_items_guard() security definer set search_path = public;
