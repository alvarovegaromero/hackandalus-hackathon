-- A completed communication request is not a completed field operation.
-- Supersede migration 014: mission execution never releases assigned resources.
create or replace function public.subagent_execution(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  return public.subagent_execution_before_release(p_kind,p_token,p_data);
end;
$$;
revoke all on function public.subagent_execution(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subagent_execution(text,uuid,jsonb) to service_role;
