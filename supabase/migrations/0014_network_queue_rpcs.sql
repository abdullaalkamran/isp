-- 0014: atomic queue claim / completion for the router worker (service role only). Idempotent.

-- Claims up to p_limit due commands (also re-claims commands stuck in 'running' for > 5 minutes).
create or replace function claim_network_commands(p_limit int default 10)
returns setof network_commands language plpgsql security definer set search_path = public as
$$
begin
  return query
  with due as (
    select id from network_commands
     where (status = 'queued' and next_attempt_at <= now())
        or (status = 'running' and next_attempt_at <= now() - interval '5 minutes')
     order by next_attempt_at, created_at
     limit greatest(p_limit, 1)
     for update skip locked)
  update network_commands c
     set status = 'running', attempts = c.attempts + 1, next_attempt_at = now()
    from due where c.id = due.id
  returning c.*;
end $$;

-- Records the outcome. Failures retry with exponential backoff (2, 4, 8… minutes) until max_attempts.
create or replace function complete_network_command(p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare c network_commands;
begin
  select * into c from network_commands where id = p_id for update;
  if c.id is null then raise exception 'command not found'; end if;
  if p_ok then
    update network_commands set status = 'succeeded', result = p_result, last_error = null, completed_at = now() where id = p_id;
  elsif c.attempts >= c.max_attempts then
    update network_commands set status = 'failed', last_error = left(p_error, 500), completed_at = now() where id = p_id;
  else
    update network_commands set status = 'queued', last_error = left(p_error, 500),
           next_attempt_at = now() + (power(2, c.attempts) * interval '1 minute') where id = p_id;
  end if;
end $$;

-- Operators can retry a failed command from the UI.
create or replace function retry_network_command(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not has_permission('network.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update network_commands set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null, completed_at = null
   where id = p_id and status = 'failed';
  if not found then raise exception 'only failed commands can be retried'; end if;
end $$;

revoke all on function claim_network_commands(int) from public, anon, authenticated;
revoke all on function complete_network_command(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function claim_network_commands(int), complete_network_command(uuid, boolean, jsonb, text) to service_role;
revoke all on function retry_network_command(uuid) from public, anon;
grant execute on function retry_network_command(uuid) to authenticated, service_role;
