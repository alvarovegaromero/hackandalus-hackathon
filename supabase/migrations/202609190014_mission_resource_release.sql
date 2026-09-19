-- Completion releases only this mission's units that have no other open owner.
-- Lock runtime before missions, matching submit/cancel and preventing stale plan commits.
alter function public.subagent_execution(text,uuid,jsonb) rename to subagent_execution_before_release;
create function public.subagent_execution(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s jsonb; previous jsonb; result jsonb; job public.subagent_missions%rowtype;
  k text; units jsonb; n integer; stamp text;
begin
  if p_kind <> 'finish' then return public.subagent_execution_before_release(p_kind,p_token,p_data); end if;
  select state into strict s from public.coordinator_runtime where singleton for update;
  select * into job from public.subagent_missions where mission_id=(p_data->>'missionId')::uuid for update;
  result := public.subagent_execution_before_release(p_kind,p_token,p_data);
  if result->>'code' <> 'OK' or p_data#>>'{decision,status}' <> 'completed' or
    job.run_id::text is distinct from s->>'runId' then return result; end if;
  previous := s;
  foreach k in array array['ambulances','police','civilGuard'] loop
    select jsonb_agg(case when u->>'status'='assigned' and
      (job.input->'assignedResourceIds') ? (u->>'id') and
      coalesce(job.input->'eventIds',jsonb_build_array(job.input->'eventId')) ? (u->>'eventId') and
      not exists(select 1 from public.subagent_missions other
        where other.run_id=job.run_id and other.mission_id<>job.mission_id
          and other.status not in ('completed','cancelled')
          and (other.input->'assignedResourceIds') ? (u->>'id'))
      then u || jsonb_build_object('status','available','eventId',null) else u end order by ordinal)
      into units from jsonb_array_elements(s#>array[k,'units']) with ordinality as x(u,ordinal);
    select count(*) into n from jsonb_array_elements(units) u where u->>'status'='assigned';
    s := jsonb_set(s,array[k],jsonb_build_object('total',10,'available',10-n,'allocated',n,'units',units));
  end loop;
  if s is distinct from previous then
    stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    s := s || jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    update public.coordinator_runtime set state=s,lease_token=null,lease_until=null where singleton;
    insert into public.subagent_activity(mission_id,type,payload)
      values(job.mission_id,'mission.resources_released',jsonb_build_object('revision',s->'revision','resourceIds',(
        select coalesce(jsonb_agg(u->'id'),'[]') from jsonb_array_elements(
          (previous#>'{ambulances,units}')||(previous#>'{police,units}')||(previous#>'{civilGuard,units}')) u
        where u->>'status'='assigned' and exists(select 1 from jsonb_array_elements(
          (s#>'{ambulances,units}')||(s#>'{police,units}')||(s#>'{civilGuard,units}')) v
          where v->>'id'=u->>'id' and v->>'status'='available'))));
  end if;
  return result;
end;
$$;
revoke all on function public.subagent_execution(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subagent_execution(text,uuid,jsonb) to service_role;
