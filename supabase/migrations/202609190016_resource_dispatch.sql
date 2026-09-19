-- Durable Resource Dispatch. No calls are made by SQL. Apply after migration 015.
-- Lock order: coordinator singleton -> mission -> dispatch. Provider results are
-- evidence, never instructions. The existing coordinator remains the only planner.
alter table public.coordinator_runtime add column dispatch_replan_pending boolean not null default false;

create table public.resource_dispatches (
  dispatch_id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.subagent_missions(mission_id),
  mission_revision integer not null check (mission_revision > 0),
  run_id uuid not null,
  event_id uuid not null,
  resource_id text not null,
  payload jsonb not null,
  status text not null default 'prepared' check (status in (
    'prepared','sending','awaiting_result','unknown','start_failed',
    'accepted','accepted_with_constraint','rejected','unavailable','unclear','no_answer','failed')),
  provider_run_id text,
  result jsonb,
  result_fingerprint text,
  start_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Rewording a mission or retrying its worker must never place another call.
  unique(run_id,resource_id,event_id)
);
create index resource_dispatch_mission on public.resource_dispatches(mission_id,mission_revision);
alter table public.resource_dispatches enable row level security;
revoke all on public.resource_dispatches from anon,authenticated;
grant select,insert,update on public.resource_dispatches to service_role;

create function public.refresh_dispatch_mission(p_mission_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare job public.subagent_missions%rowtype; final_status text; summary text; ids jsonb;
  real_actions boolean; needs_decision boolean; result_data jsonb;
begin
  select * into strict job from public.subagent_missions where mission_id=p_mission_id for update;
  if job.status='cancelled' or not exists(select 1 from public.resource_dispatches d
    where d.mission_id=job.mission_id and d.mission_revision=(job.input->>'revision')::int) then return; end if;
  select
    case when bool_or(d.status in ('start_failed','unknown','rejected','unavailable','unclear','no_answer','failed')) then 'blocked'
      when bool_or(d.status in ('prepared','sending','awaiting_result')) then 'waiting' else 'completed' end,
    left(string_agg(d.resource_id || ': ' || d.status || coalesce(' — ' || nullif(concat_ws(' · ',
      d.result->>'constraint_description',d.result->>'rejection_reason',d.result->>'responder_statement',d.result->>'summary',d.start_error),''),''), '; ' order by d.resource_id),4000),
    jsonb_agg(d.dispatch_id order by d.resource_id),
    case when bool_or(d.provider_run_id is not null or d.result is not null) then true
      when bool_or(d.status in ('sending','unknown')) then null else false end,
    bool_or(d.status not in ('accepted','prepared','sending','awaiting_result'))
  into final_status,summary,ids,real_actions,needs_decision
  from public.resource_dispatches d where d.mission_id=job.mission_id and d.mission_revision=(job.input->>'revision')::int;
  result_data := jsonb_build_object('updateId',gen_random_uuid(),'missionId',job.mission_id,
    'missionRevision',job.input->'revision','status',final_status,'summary',summary,'resourceRequest',null,
    'executionMode','happyrobot','realActionsExecuted',real_actions,'needsParentDecision',needs_decision,
    'externalOperationIds',ids);
  update public.subagent_missions set status=final_status,result=result_data,
    lease_token=null,lease_until=null,updated_at=now() where mission_id=job.mission_id;
  insert into public.subagent_activity(mission_id,type,payload) values(job.mission_id,'dispatch.mission_updated',result_data);
end $$;
revoke all on function public.refresh_dispatch_mission(uuid) from public,anon,authenticated;
grant execute on function public.refresh_dispatch_mission(uuid) to service_role;

create function public.resource_dispatch(p_kind text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; job public.subagent_missions%rowtype; d public.resource_dispatches%rowtype;
  rid text; unit jsonb; did uuid; items jsonb := '[]'; outcome text; wire jsonb;
  stale boolean; inv_key text; units jsonb; stamp text; target uuid; n integer;
begin
  select state into strict s from public.coordinator_runtime where singleton for update;
  stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if p_kind='prepare' then
    select * into job from public.subagent_missions where mission_id=(p_data->>'missionId')::uuid for update;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    if job.run_id::text is distinct from s->>'runId' or job.status<>'running' or
      job.lease_token is distinct from (p_data->>'token')::uuid or job.lease_until<=now() then
      return jsonb_build_object('code','LEASE_LOST'); end if;
    for rid in select jsonb_array_elements_text(job.input->'assignedResourceIds') loop
      select value into unit from jsonb_array_elements((s#>'{ambulances,units}') || (s#>'{police,units}') || (s#>'{civilGuard,units}')) u
        where u->>'id'=rid and u->>'status'='assigned' and coalesce(job.input->'eventIds',jsonb_build_array(job.event_id)) ? (u->>'eventId');
      if not found then continue; end if;
      did := gen_random_uuid();
      insert into public.resource_dispatches(dispatch_id,mission_id,mission_revision,run_id,event_id,resource_id,payload)
        values(did,job.mission_id,(job.input->>'revision')::int,job.run_id,(unit->>'eventId')::uuid,rid,
          jsonb_build_object('dispatch_id',did,'incident_id',job.run_id,'plan_id',job.run_id::text||':'||(s->>'revision'),
            'action_id',job.mission_id,'resource_id',rid,'resource_display_name',rid,
            'resource_type',case when rid like 'ambulance-%' then 'ambulance' when rid like 'police-%' then 'police' else 'civil_guard' end,
            'resource_contact_name','','resource_phone','','mission_summary',job.input->>'objective',
            'mission_destination','','mission_requested_eta','','mission_instructions',job.input->>'instructions',
            'context',job.input#>>'{context,incidentSummary}','requested_at',stamp))
        on conflict(run_id,resource_id,event_id) do nothing returning * into d;
      if found then items := items || jsonb_build_array(to_jsonb(d)); end if;
    end loop;
    if jsonb_array_length(items)=0 then
      update public.subagent_missions set status='blocked',lease_token=null,lease_until=null,
        result=jsonb_build_object('updateId',gen_random_uuid(),'missionId',job.mission_id,'missionRevision',job.input->'revision',
          'status','blocked','summary','No new dispatch: resources are unassigned or already have a dispatch. Inspect existing dispatch evidence.',
          'resourceRequest',null,'needsParentDecision',true,'externalOperationIds','[]'::jsonb,'executionMode','happyrobot','realActionsExecuted',false),updated_at=now()
        where mission_id=job.mission_id;
    else
      perform public.refresh_dispatch_mission(job.mission_id);
    end if;
    return jsonb_build_object('code','OK','dispatches',items);
  end if;
  target := coalesce(p_data->>'dispatchId',p_data#>>'{result,dispatch_id}')::uuid;
  select * into d from public.resource_dispatches where dispatch_id=target;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select * into strict job from public.subagent_missions where mission_id=d.mission_id for update;
  select * into strict d from public.resource_dispatches where dispatch_id=target for update;
  stale := d.run_id::text is distinct from s->>'runId' or job.status='cancelled' or
    d.mission_revision <> (job.input->>'revision')::int;
  if p_kind='send' then
    if stale or d.status<>'prepared' then return jsonb_build_object('code','NOT_SENDABLE'); end if;
    if not exists(select 1 from jsonb_array_elements((s#>'{ambulances,units}')||(s#>'{police,units}')||(s#>'{civilGuard,units}')) u
      where u->>'id'=d.resource_id and u->>'eventId'=d.event_id::text and u->>'status'='assigned') then
      return jsonb_build_object('code','RESOURCE_NOT_RESERVED'); end if;
    update public.resource_dispatches set status='sending',updated_at=now() where dispatch_id=target;
    return jsonb_build_object('code','OK');
  end if;
  if p_kind='start_result' then
    if p_data->>'status' not in ('awaiting_result','failed','unknown') then raise exception 'Invalid dispatch start status'; end if;
    if d.result is not null then
      if p_data->>'runId' is not null and (d.provider_run_id is null or d.provider_run_id=p_data->>'runId') then
        update public.resource_dispatches set provider_run_id=p_data->>'runId' where dispatch_id=target;
      end if;
      return jsonb_build_object('code','OK','duplicate',true);
    end if;
    if d.status not in ('prepared','sending') then return jsonb_build_object('code','OK','duplicate',true); end if;
    update public.resource_dispatches set status=case when p_data->>'status'='failed' then 'start_failed' else p_data->>'status' end,
      provider_run_id=p_data->>'runId',start_error=p_data->>'error',updated_at=now() where dispatch_id=target;
    insert into public.subagent_activity(mission_id,type,payload) values(d.mission_id,'dispatch.started',p_data);
    if not stale then perform public.refresh_dispatch_mission(d.mission_id); end if;
  elsif p_kind='callback' then
    wire := p_data->'result'; outcome := wire->>'dispatch_status';
    if outcome is null or outcome not in ('accepted','accepted_with_constraint','rejected','unavailable','unclear','no_answer','failed') then
      return jsonb_build_object('code','INVALID_OUTCOME'); end if;
    if wire->>'resource_id' is distinct from d.resource_id or
      (wire->>'mission_id' is not null and wire->>'mission_id'<>d.mission_id::text) or
      (wire->>'action_id' is not null and wire->>'action_id'<>d.mission_id::text) or
      (wire->>'assignment_id' is not null and wire->>'assignment_id'<>d.dispatch_id::text) or
      (wire->>'incident_id' is not null and wire->>'incident_id'<>d.run_id::text) or
      (wire->>'plan_id' is not null and wire->>'plan_id'<>d.payload->>'plan_id') or
      (wire->>'run_id' is not null and d.provider_run_id is not null and wire->>'run_id'<>d.provider_run_id) then
      return jsonb_build_object('code','CORRELATION_CONFLICT'); end if;
    if d.result is not null then
      if d.result_fingerprint is distinct from p_data->>'fingerprint' then return jsonb_build_object('code','RESULT_CONFLICT'); end if;
      return jsonb_build_object('code','OK','duplicate',true,'stale',stale,'dispatchId',target,'missionId',d.mission_id,'resourceId',d.resource_id,'outcome',outcome);
    end if;
    if d.status='prepared' then return jsonb_build_object('code','NOT_SENT'); end if;
    update public.resource_dispatches set status=outcome,result=wire,result_fingerprint=p_data->>'fingerprint',
      provider_run_id=coalesce(provider_run_id,wire->>'run_id'),updated_at=now() where dispatch_id=target;
    insert into public.subagent_activity(mission_id,type,payload) values(d.mission_id,'dispatch.result',
      jsonb_build_object('dispatchId',target,'stale',stale,'result',wire));
    -- A late answer still provides evidence in its original run, but cannot
    -- mutate a revised/cancelled mission or reservations for a different run.
    if not stale then
      if outcome in ('rejected','unavailable') then
        inv_key := case when d.resource_id like 'ambulance-%' then 'ambulances' when d.resource_id like 'police-%' then 'police' else 'civilGuard' end;
        select jsonb_agg(case when u->>'id'=d.resource_id and u->>'eventId'=d.event_id::text then
          u||jsonb_build_object('status','unavailable','eventId',null) else u end) into units from jsonb_array_elements(s#>array[inv_key,'units']) u;
        select count(*) into n from jsonb_array_elements(units) u where u->>'status'='assigned';
        s := jsonb_set(s,array[inv_key],jsonb_build_object('total',10,'allocated',n,'available',
          (select count(*) from jsonb_array_elements(units) u where u->>'status'='available'),
          'unavailable',(select count(*) from jsonb_array_elements(units) u where u->>'status'='unavailable'),'units',units));
      end if;
      perform public.refresh_dispatch_mission(d.mission_id);
    end if;
  else return jsonb_build_object('code','UNSUPPORTED_OPERATION'); end if;
  if d.run_id::text=s->>'runId' then
    s := s||jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    -- Invalidate in-flight proposals: the next prompt must consume this evidence.
    update public.coordinator_runtime set state=s,dispatch_replan_pending=true,
      lease_token=null,lease_until=null,last_attempt_at=null where singleton;
  end if;
  return jsonb_build_object('code','OK','duplicate',false,'stale',stale,'dispatchId',target,'missionId',d.mission_id,'resourceId',d.resource_id,'outcome',outcome);
end $$;
revoke all on function public.resource_dispatch(text,jsonb) from public,anon,authenticated;
grant execute on function public.resource_dispatch(text,jsonb) to service_role;

-- Existing allocation validators preserve assigned units. Add the operational
-- unavailable state without allowing the planner to release or revive units.
alter function public.coordinate_crisis(text,uuid,jsonb) rename to coordinate_crisis_before_dispatch;
create function public.coordinate_crisis(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_state jsonb; new_state jsonb; r jsonb; k text; field text; id_field text; units jsonb; n int;
begin
  if p_kind<>'commit' then return public.coordinate_crisis_before_dispatch(p_kind,p_token,p_data); end if;
  select state into strict old_state from public.coordinator_runtime where singleton for update;
  if not exists(select 1 from public.coordinator_runtime where singleton and lease_token=p_token and lease_until>now()) then
    return jsonb_build_object('code','LEASE_LOST');
  end if;
  foreach k in array array['ambulances','police','civilGuard'] loop
    field := case k when 'ambulances' then 'assignments' when 'police' then 'policeAssignments' else 'civilGuardAssignments' end;
    id_field := case k when 'ambulances' then 'ambulanceId' else 'unitId' end;
    if exists(select 1 from jsonb_array_elements(old_state#>array[k,'units']) u join jsonb_array_elements(p_data->'proposal'->field) a on a->>id_field=u->>'id'
      where u->>'status'='unavailable') then return jsonb_build_object('code','RESOURCE_UNAVAILABLE'); end if;
  end loop;
  r := public.coordinate_crisis_before_dispatch(p_kind,p_token,p_data);
  if r->>'code'<>'OK' then return r; end if;
  new_state := r->'state';
  foreach k in array array['ambulances','police','civilGuard'] loop
    select jsonb_agg(case when old->>'status'='unavailable' then old else u end) into units
      from jsonb_array_elements(new_state#>array[k,'units']) u join jsonb_array_elements(old_state#>array[k,'units']) old on u->>'id'=old->>'id';
    select count(*) into n from jsonb_array_elements(units) u where u->>'status'='unavailable';
    if n>0 then new_state := jsonb_set(new_state,array[k],jsonb_build_object('total',10,'unavailable',n,
      'available',(select count(*) from jsonb_array_elements(units) u where u->>'status'='available'),
      'allocated',(select count(*) from jsonb_array_elements(units) u where u->>'status'='assigned'),'units',units)); end if;
  end loop;
  update public.coordinator_runtime set state=new_state,dispatch_replan_pending=false where singleton;
  return r||jsonb_build_object('state',new_state);
end $$;
revoke all on function public.coordinate_crisis(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.coordinate_crisis(text,uuid,jsonb) to service_role;

alter function public.reset_coordinator_demo() rename to reset_coordinator_before_dispatch;
create function public.reset_coordinator_demo() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
  s := public.reset_coordinator_before_dispatch();
  update public.coordinator_runtime set dispatch_replan_pending=false where singleton;
  return s;
end $$;
revoke all on function public.reset_coordinator_demo() from public,anon,authenticated;
grant execute on function public.reset_coordinator_demo() to service_role;
