-- 0012: collection summaries and the cash-deposit lifecycle as RPCs (clients cannot write cash_collections). Idempotent.

create or replace function collection_summary(p_from date default null, p_to date default null)
returns table (o_agent_id uuid, o_agent_name text, o_count int, o_total numeric, o_held numeric, o_deposited numeric, o_reconciled numeric)
language plpgsql stable security definer set search_path = public as
$$
begin
  if not has_permission('collections.read') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select cc.agent_id, coalesce(p.full_name, ''), count(*)::int, coalesce(sum(cc.amount), 0),
         coalesce(sum(cc.amount) filter (where cc.status = 'held'), 0),
         coalesce(sum(cc.amount) filter (where cc.status = 'deposited'), 0),
         coalesce(sum(cc.amount) filter (where cc.status = 'reconciled'), 0)
    from cash_collections cc join profiles p on p.id = cc.agent_id
   where (p_from is null or (cc.collected_at at time zone 'Asia/Dhaka')::date >= p_from)
     and (p_to is null or (cc.collected_at at time zone 'Asia/Dhaka')::date <= p_to)
   group by cc.agent_id, p.full_name
   order by 4 desc;
end $$;

-- An agent hands in everything they currently hold; the amount must match so the books cannot drift.
create or replace function submit_cash_deposit(p_amount numeric, p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as
$$
declare v_held numeric; v_id uuid;
begin
  if not has_permission('collections.record') then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0) into v_held from cash_collections where agent_id = auth.uid() and status = 'held';
  if v_held <= 0 then raise exception 'you have no cash held'; end if;
  if p_amount is distinct from v_held then raise exception 'deposit amount must equal the cash you hold (%)', v_held; end if;
  insert into cash_deposits (agent_id, amount, reference, notes, status) values (auth.uid(), v_held, nullif(trim(p_reference), ''), p_notes, 'submitted')
    returning id into v_id;
  update cash_collections set status = 'deposited', deposit_id = v_id where agent_id = auth.uid() and status = 'held';
  insert into audit_logs (actor_id, category, action, table_name, record_id, metadata)
    values (auth.uid(), 'financial', 'cash_deposit_submitted', 'cash_deposits', v_id::text, jsonb_build_object('amount', v_held));
  return v_id;
end $$;

create or replace function reconcile_deposit(p_deposit uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare d cash_deposits;
begin
  if not has_permission('collections.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into d from cash_deposits where id = p_deposit for update;
  if d.id is null then raise exception 'deposit not found'; end if;
  if d.status <> 'submitted' then raise exception 'deposit already %', d.status; end if;
  if p_approve then
    update cash_deposits set status = 'reconciled', reconciled_by = auth.uid(), reconciled_at = now(), notes = coalesce(p_note, notes) where id = p_deposit;
    update cash_collections set status = 'reconciled' where deposit_id = p_deposit;
  else
    update cash_deposits set status = 'rejected', reconciled_by = auth.uid(), reconciled_at = now(), notes = coalesce(p_note, notes) where id = p_deposit;
    update cash_collections set status = 'held', deposit_id = null where deposit_id = p_deposit;
  end if;
  insert into audit_logs (actor_id, category, action, table_name, record_id, metadata)
    values (auth.uid(), 'financial', case when p_approve then 'cash_deposit_reconciled' else 'cash_deposit_rejected' end,
            'cash_deposits', p_deposit::text, jsonb_build_object('amount', d.amount));
end $$;

do $$
declare f text;
begin
  for f in select unnest(array['collection_summary(date,date)', 'submit_cash_deposit(numeric,text,text)', 'reconcile_deposit(uuid,boolean,text)']) loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
