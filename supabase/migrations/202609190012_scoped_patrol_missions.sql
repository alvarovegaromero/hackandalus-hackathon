create or replace function public.subagent_execution(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  job public.subagent_missions%rowtype; snapshot jsonb; op jsonb; decision jsonb;
  result_data jsonb; target uuid; final_status text;
begin
  if p_kind='submit' then
    -- Serialize handoff with parent inventory writes; never change the inventory.
    select state into strict snapshot from public.coordinator_runtime where singleton for share;
    if p_data->>'runId' is distinct from snapshot->>'runId' or not exists(
      select 1 from jsonb_array_elements(snapshot->'events') e where e->>'eventId'=p_data->>'eventId') then
      return jsonb_build_object('code','EVENT_CONFLICT');
    end if;
    if jsonb_typeof(p_data->'assignedResourceIds') is distinct from 'array' or
       jsonb_typeof(p_data->'allowedTools') is distinct from 'array' or
       p_data->>'revision' is distinct from '1' then raise exception 'Invalid mission contract'; end if;
    if (select count(distinct value) from jsonb_array_elements(p_data->'assignedResourceIds')) <> jsonb_array_length(p_data->'assignedResourceIds') or
      exists(select 1 from jsonb_array_elements_text(p_data->'assignedResourceIds') r where not exists(
        select 1 from jsonb_array_elements((snapshot#>'{ambulances,units}') || (snapshot#>'{police,units}') || (snapshot#>'{civilGuard,units}')) u where u->>'id'=r and u->>'eventId'=p_data->>'eventId' and u->>'status'='assigned')) then
      return jsonb_build_object('code','RESOURCE_NOT_RESERVED');
    end if;
    if exists(select 1 from jsonb_array_elements_text(p_data->'allowedTools') t where t not in ('contactService','getContactResult')) then
      return jsonb_build_object('code','TOOL_NOT_ALLOWED');
    end if;
    insert into public.subagent_missions(mission_id,run_id,event_id,input)
      values((p_data->>'missionId')::uuid,(p_data->>'runId')::uuid,(p_data->>'eventId')::uuid,p_data)
      on conflict do nothing returning * into job;
    if not found then
      select * into job from public.subagent_missions where mission_id=(p_data->>'missionId')::uuid;
      if found and job.input=p_data then return jsonb_build_object('code','OK','duplicate',true); end if;
      return jsonb_build_object('code','MISSION_CONFLICT');
    end if;
    insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'mission.queued','{}');
    return jsonb_build_object('code','OK','duplicate',false);
  end if;
  if p_kind='claim' then
    select * into job from public.subagent_missions
      where run_id=(select (state->>'runId')::uuid from public.coordinator_runtime where singleton) and ((status in ('queued','waiting') and next_attempt_at<=now()) or (status='running' and lease_until<=now()))
      order by next_attempt_at,created_at limit 1 for update skip locked;
    if not found then return jsonb_build_object('code','IDLE'); end if;
    if job.attempts<3 then
      update public.subagent_missions set status='running',attempts=attempts+1,
        lease_token=p_token,lease_until=now()+interval '120 seconds',updated_at=now() where mission_id=job.mission_id;
      insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'mission.running',jsonb_build_object('attempt',job.attempts+1));
      return jsonb_build_object('code','OK','mission',job.input,'operations',job.operations);
    end if;
    -- Exhausted waiting/recovery budgets become an explicit parent-visible failure.
    p_kind := 'fail';
  else
    target := (p_data->>'missionId')::uuid;
    select * into job from public.subagent_missions where mission_id=target for update;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    if job.status<>'running' or job.lease_token is distinct from p_token or job.lease_until<=now() then
      return jsonb_build_object('code','LEASE_LOST');
    end if;
  end if;
  if p_kind='inspect' then return jsonb_build_object('code','OK','operations',job.operations); end if;
  if p_kind='contact' then
    if not (job.input->'allowedTools') ? 'contactService' then return jsonb_build_object('code','TOOL_NOT_ALLOWED'); end if;
    if p_data->>'service' is null or p_data->>'service' not in ('medical_coordination','emergency_coordination') or
      jsonb_typeof(p_data->'message') is distinct from 'string' or length(p_data->>'message') not between 1 and 2000 then raise exception 'Invalid mock contact'; end if;
    select value into op from jsonb_array_elements(job.operations) where value->>'service'=p_data->>'service';
    if found then return jsonb_build_object('code','OK','operation',op); end if;
    op := jsonb_build_object('operationId',gen_random_uuid(),'service',p_data->'service','message',p_data->'message',
      'provider','happyrobot_mock','status','pending','realActionsExecuted',false);
    update public.subagent_missions set operations=operations||jsonb_build_array(op),updated_at=now() where mission_id=job.mission_id;
    insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'contact.started',op);
    return jsonb_build_object('code','OK','operation',op);
  end if;
  if p_kind='contact_result' then
    if not (job.input->'allowedTools') ? 'getContactResult' then return jsonb_build_object('code','TOOL_NOT_ALLOWED'); end if;
    select value into op from jsonb_array_elements(job.operations) where value->>'operationId'=p_data->>'operationId';
    if not found then return jsonb_build_object('code','OPERATION_NOT_FOUND'); end if;
    if op->>'status'='pending' then
      op := op||jsonb_build_object('status','acknowledged');
      update public.subagent_missions set operations=(select jsonb_agg(case when value->>'operationId'=p_data->>'operationId' then op else value end) from jsonb_array_elements(job.operations)),updated_at=now() where mission_id=job.mission_id;
      insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'contact.acknowledged',op);
    end if;
    return jsonb_build_object('code','OK','operation',op);
  end if;
  if p_kind not in ('finish','fail') then return jsonb_build_object('code','UNSUPPORTED_OPERATION'); end if;
  if p_kind='fail' then
    decision := jsonb_build_object('status','failed','summary','Subagent failed or exhausted its recovery budget; review required. Simulation only.','resourceRequest',null);
  else
    decision := p_data->'decision';
    if decision->>'status' is null or decision->>'status' not in ('completed','waiting','blocked') or
      jsonb_typeof(decision->'summary') is distinct from 'string' or length(decision->>'summary') not between 1 and 4000 then raise exception 'Invalid mission result'; end if;
    if decision->>'status'='completed' and (jsonb_array_length(job.operations)=0 or
      exists(select 1 from jsonb_array_elements(job.operations) o where o->>'status'<>'acknowledged') or
      decision->'resourceRequest' is distinct from 'null'::jsonb) then raise exception 'Completion lacks acknowledged mock evidence'; end if;
    if decision->>'status'='waiting' and not exists(select 1 from jsonb_array_elements(job.operations) o where o->>'status'='pending') then raise exception 'Waiting lacks pending operation'; end if;
  end if;
  final_status := decision->>'status';
  result_data := decision||jsonb_build_object('updateId',gen_random_uuid(),'missionId',job.mission_id,'missionRevision',job.input->'revision',
    'executionMode','simulation','realActionsExecuted',false,'needsParentDecision',final_status in ('failed','blocked') or decision->'resourceRequest'<>'null'::jsonb,
    'externalOperationIds',(select coalesce(jsonb_agg(value->'operationId'),'[]') from jsonb_array_elements(job.operations)));
  update public.subagent_missions set status=final_status,result=result_data,lease_token=null,lease_until=null,
    next_attempt_at=now()+interval '10 seconds',updated_at=now() where mission_id=job.mission_id;
  insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'mission.'||final_status,result_data);
  return jsonb_build_object('code','OK','result',result_data);
end;
$$;
revoke all on function public.subagent_execution(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.subagent_execution(text,uuid,jsonb) to service_role;
