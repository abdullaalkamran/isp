-- 0010: per-customer balance summary (so the client never sums invoices itself). Idempotent.
create or replace function customer_balance(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$
begin
  if not (p_customer = current_customer_id() or has_permission('invoices.read') or has_permission('payments.read')) then
    return null;
  end if;
  return jsonb_build_object(
    'outstanding', coalesce((select sum(balance_due) from invoices
                              where customer_id = p_customer and status in ('issued', 'partially_paid', 'overdue')), 0),
    'overdue', coalesce((select sum(balance_due) from invoices where customer_id = p_customer and status = 'overdue'), 0),
    'credit', customer_credit(p_customer));
end $$;

revoke all on function customer_balance(uuid) from public, anon;
grant execute on function customer_balance(uuid) to authenticated, service_role;
