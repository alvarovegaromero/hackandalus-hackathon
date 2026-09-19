-- Hold the runtime lock only for short database operations, never during model calls.
-- All callers lock runtime before missions, matching reset and parent handoff.
create or replace function public.subagent_execution(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare active_run uuid; job_run uuid;
begin
  select (state->>'runId')::uuid into strict active_run
    from public.coordinator_runtime where singleton for share;
  if p_data ? 'runId' and p_data->>'runId' is distinct from active_run::text then
    return jsonb_build_object('code','RUN_CONFLICT');
  end if;
  if p_kind not in ('claim','submit') then
    select run_id into job_run from public.subagent_missions
      where mission_id=(p_data->>'missionId')::uuid;
    if job_run is null then return jsonb_build_object('code','NOT_FOUND'); end if;
    if job_run <> active_run then return jsonb_build_object('code','RUN_CONFLICT'); end if;
  end if;
  return public.subagent_execution_before_release(p_kind,p_token,p_data);
end;
$$;
revoke all on function public.subagent_execution(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subagent_execution(text,uuid,jsonb) to service_role;

alter function public.reset_coordinator_demo() rename to reset_coordinator_before_execution_fence;
create function public.reset_coordinator_demo()
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous_run uuid; snapshot jsonb;
begin
  select (state->>'runId')::uuid into strict previous_run
    from public.coordinator_runtime where singleton for update;
  snapshot := public.reset_coordinator_before_execution_fence();
  with cancelled as (
    update public.subagent_missions set status='cancelled',lease_token=null,lease_until=null,
      updated_at=now()
    where run_id=previous_run and status in ('queued','running','waiting','blocked')
    returning mission_id
  )
  insert into public.subagent_activity(mission_id,type,payload)
    select mission_id,'mission.cancelled',jsonb_build_object('reason','demo.reset') from cancelled;
  return snapshot;
end;
$$;
revoke all on function public.reset_coordinator_demo() from public,anon,authenticated;
grant execute on function public.reset_coordinator_demo() to service_role;
-- The renamed implementation is internal; prevent bypass through PostgREST.
revoke all on function public.reset_coordinator_before_execution_fence() from public,anon,authenticated,service_role;
