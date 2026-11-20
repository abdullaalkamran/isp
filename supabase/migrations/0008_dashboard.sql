-- 0008: dashboard statistics, computed from real records only
create or replace function dashboard_stats(p_from date default null, p_to date default null,
                                           p_area uuid default null, p_service service_type default null)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_today date := dhaka_today();
  v_from date := coalesce(p_from, date_trunc('month', dhaka_today())::date);
  v_to date := coalesce(p_to, dhaka_today());
  v_month_start date := date_trunc('month', dhaka_today())::date;
  r jsonb;
begin
  if not has_permission('dashboard.view') then raise exception 'forbidden' using errcode = '42501'; end if;

  with scope as (
    select c.* from customers c
     where c.archived_at is null
       and (p_area is null or c.area_id = p_area)
       and (p_service is null or exists (select 1 from subscriptions s where s.customer_id = c.id and s.service_type = p_service))
  ), subs as (
    select s.* from subscriptions s join scope on scope.id = s.customer_id
     where p_service is null or s.service_type = p_service
  ), pays as (
    select p.* from payments p join scope on scope.id = p.customer_id where p.verification_status = 'verified'
  ), openinv as (
    select i.* from invoices i join scope on scope.id = i.customer_id where i.status in ('issued', 'partially_paid', 'overdue')
  )
  select jsonb_build_object(
    'customers', jsonb_build_object(
      'total', (select count(*) from scope),
      'active', (select count(*) from scope where status = 'active'),
      'inactive', (select count(*) from scope where status = 'inactive'),
      'suspended', (select count(*) from scope where status = 'suspended'),
      'pending', (select count(*) from scope where status = 'pending'),
      'new_in_range', (select count(*) from scope where (created_at at time zone 'Asia/Dhaka')::date between v_from and v_to),
      'new_this_month', (select count(*) from scope where (created_at at time zone 'Asia/Dhaka')::date >= v_month_start)),
    'services', jsonb_build_object(
      'cable_subscribers', (select count(distinct customer_id) from subs where service_type = 'cable_tv' and status = 'active'),
      'internet_subscribers', (select count(distinct customer_id) from subs where service_type = 'internet' and status = 'active'),
      'both', (select count(*) from (select customer_id from subs where status = 'active'
                 group by customer_id having count(distinct service_type) = 2) b),
      'expiring_7d', (select count(*) from subs where status = 'active' and expiry_date between v_today and v_today + 7),
      'mrr', (select coalesce(sum(monthly_price), 0) from subs where status = 'active')),
    'finance', jsonb_build_object(
      'today_collections', (select coalesce(sum(amount), 0) from pays where (paid_at at time zone 'Asia/Dhaka')::date = v_today),
      'month_collections', (select coalesce(sum(amount), 0) from pays where (paid_at at time zone 'Asia/Dhaka')::date >= v_month_start),
      'range_collections', (select coalesce(sum(amount), 0) from pays where (paid_at at time zone 'Asia/Dhaka')::date between v_from and v_to),
      'outstanding_amount', (select coalesce(sum(balance_due), 0) from openinv),
      'outstanding_count', (select count(*) from openinv),
      'overdue_amount', (select coalesce(sum(balance_due), 0) from openinv where status = 'overdue'),
      'overdue_count', (select count(*) from openinv where status = 'overdue')),
    'network', jsonb_build_object(
      'routers_online', (select count(*) from routers where is_active and status = 'online'),
      'routers_offline', (select count(*) from routers where is_active and status in ('offline', 'degraded'))),
    'operations', jsonb_build_object(
      'pending_tickets', (select count(*) from support_tickets t join scope on scope.id = t.customer_id
                           where t.status in ('open', 'assigned', 'in_progress', 'waiting_customer', 'escalated')),
      'pending_installations', (select count(*) from installation_jobs j join scope on scope.id = j.customer_id
                                 where j.status in ('pending', 'assigned', 'scheduled')))
  ) into r;
  return r;
end $$;

create or replace function dashboard_charts(p_from date default null, p_to date default null,
                                            p_area uuid default null, p_service service_type default null)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_from date := coalesce(p_from, date_trunc('month', dhaka_today())::date);
  v_to date := coalesce(p_to, dhaka_today());
  v_m0 date := (date_trunc('month', dhaka_today()) - interval '11 months')::date;
  r jsonb;
begin
  if not has_permission('dashboard.view') then raise exception 'forbidden' using errcode = '42501'; end if;

  with scope as (
    select c.* from customers c
     where c.archived_at is null and (p_area is null or c.area_id = p_area)
       and (p_service is null or exists (select 1 from subscriptions s where s.customer_id = c.id and s.service_type = p_service))
  ), months as (
    select generate_series(v_m0, date_trunc('month', dhaka_today())::date, interval '1 month')::date as m
  ), pays as (
    select p.amount, (p.paid_at at time zone 'Asia/Dhaka')::date as d from payments p
      join scope on scope.id = p.customer_id where p.verification_status = 'verified'
  ), inv as (
    select i.* from invoices i join scope on scope.id = i.customer_id where i.status <> 'cancelled' and i.status <> 'draft'
  ), subs as (
    select s.* from subscriptions s join scope on scope.id = s.customer_id where (p_service is null or s.service_type = p_service)
  )
  select jsonb_build_object(
    'monthly_revenue', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'invoiced', (select coalesce(sum(total_amount), 0) from inv where date_trunc('month', invoice_date) = m),
        'collected', (select coalesce(sum(amount), 0) from pays where date_trunc('month', d) = m)) order by m), '[]') from months),
    'collection_trend', (select coalesce(jsonb_agg(jsonb_build_object('date', to_char(g, 'YYYY-MM-DD'),
        'collected', (select coalesce(sum(amount), 0) from pays where d = g::date)) order by g), '[]')
        from generate_series(v_from, v_to, interval '1 day') g),
    'customer_growth', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'new', (select count(*) from scope where date_trunc('month', created_at at time zone 'Asia/Dhaka') = m),
        'total', (select count(*) from scope where (created_at at time zone 'Asia/Dhaka')::date < (m + interval '1 month')::date)) order by m), '[]') from months),
    'service_split', jsonb_build_object(
      'cable_tv', (select count(distinct customer_id) from subs where service_type = 'cable_tv' and status = 'active'),
      'internet', (select count(distinct customer_id) from subs where service_type = 'internet' and status = 'active')),
    'status_split', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from scope group by status) x),
    'outstanding_trend', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'outstanding',
          (select coalesce(sum(total_amount), 0) from inv where invoice_date < (m + interval '1 month')::date)
        - (select coalesce(sum(a.amount), 0) from payment_allocations a join inv on inv.id = a.invoice_id
            where inv.invoice_date < (m + interval '1 month')::date and a.created_at < (m + interval '1 month'))
        - (select coalesce(sum(credited_amount), 0) from inv where invoice_date < (m + interval '1 month')::date)) order by m), '[]') from months),
    'package_popularity', (select coalesce(jsonb_agg(x order by (x->>'subscribers')::int desc), '[]') from (
        select jsonb_build_object('package', pk.name, 'package_bn', pk.name_bn, 'service_type', pk.service_type, 'subscribers', count(*)) x
          from subs s join packages pk on pk.id = s.package_id where s.status = 'active'
         group by pk.id, pk.name, pk.name_bn, pk.service_type order by count(*) desc limit 10) t)
  ) into r;
  return r;
end $$;

revoke all on function dashboard_stats(date, date, uuid, service_type) from public, anon;
revoke all on function dashboard_charts(date, date, uuid, service_type) from public, anon;
grant execute on function dashboard_stats(date, date, uuid, service_type) to authenticated;
grant execute on function dashboard_charts(date, date, uuid, service_type) to authenticated;
