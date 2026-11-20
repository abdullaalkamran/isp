-- 0013: server-side report queries (so totals never depend on client pagination). Idempotent.
create or replace function report_rows(p_report text, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_from date := coalesce(p_from, (date_trunc('month', dhaka_today()) - interval '11 months')::date);
        v_to date := coalesce(p_to, dhaka_today()); v_out jsonb;
begin
  if p_report in ('revenue', 'collections_by_method', 'dues') then
    if not has_permission('reports.financial') then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif p_report = 'new_customers' then
    if not has_permission('reports.view') then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    raise exception 'unknown report';
  end if;

  if p_report = 'revenue' then
    select coalesce(jsonb_agg(r order by r.month), '[]') into v_out from (
      select to_char(m, 'YYYY-MM') as month,
             coalesce((select sum(total_amount) from invoices i where i.status <> 'cancelled' and i.status <> 'draft'
                        and i.invoice_date >= m::date and i.invoice_date < (m + interval '1 month')::date and i.invoice_date between v_from and v_to), 0) as invoiced,
             coalesce((select sum(p.amount) from payments p where p.verification_status = 'verified'
                        and (p.paid_at at time zone 'Asia/Dhaka')::date >= m::date and (p.paid_at at time zone 'Asia/Dhaka')::date < (m + interval '1 month')::date
                        and (p.paid_at at time zone 'Asia/Dhaka')::date between v_from and v_to), 0) as collected
        from generate_series(date_trunc('month', v_from), date_trunc('month', v_to), interval '1 month') m) r;
  elsif p_report = 'collections_by_method' then
    select coalesce(jsonb_agg(r order by r.amount desc), '[]') into v_out from (
      select method::text as method, count(*)::int as count, sum(amount) as amount from payments
       where verification_status = 'verified' and (paid_at at time zone 'Asia/Dhaka')::date between v_from and v_to group by method) r;
  elsif p_report = 'dues' then
    select coalesce(jsonb_agg(r order by r.outstanding desc), '[]') into v_out from (
      select c.customer_code, c.full_name, c.phone, sum(i.balance_due) as outstanding,
             coalesce(sum(i.balance_due) filter (where i.status = 'overdue'), 0) as overdue, min(i.due_date) as oldest_due
        from invoices i join customers c on c.id = i.customer_id
       where i.status in ('issued', 'partially_paid', 'overdue') group by c.customer_code, c.full_name, c.phone having sum(i.balance_due) > 0) r;
  else
    select coalesce(jsonb_agg(r order by r.month), '[]') into v_out from (
      select to_char(date_trunc('month', created_at at time zone 'Asia/Dhaka'), 'YYYY-MM') as month, count(*)::int as count
        from customers where (created_at at time zone 'Asia/Dhaka')::date between v_from and v_to group by 1) r;
  end if;
  return v_out;
end $$;

revoke all on function report_rows(text, date, date) from public, anon;
grant execute on function report_rows(text, date, date) to authenticated, service_role;
