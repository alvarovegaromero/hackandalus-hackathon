-- Separate report filtering from model execution; preserve later arrivals on commit.
alter table public.coordinator_runtime add column if not exists lease_event_ids jsonb not null default '[]';
create or replace function public.coordinate_crisis(p_kind text, p_token uuid, p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  row public.coordinator_runtime%rowtype; s jsonb; existing jsonb; item jsonb;
  target_event_id uuid; stamp text; events jsonb; units jsonb; proposal jsonb; assigned integer;
begin
  select * into strict row from public.coordinator_runtime where singleton for update;
  s := row.state;
  stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if p_kind='enqueue' then
    target_event_id := (p_data#>>'{report,id}')::uuid;
    if p_data#>>'{report,runId}' is distinct from s->>'runId' then return jsonb_build_object('code','RUN_CONFLICT'); end if;
    select input into existing from public.coordinator_events where coordinator_events.event_id=target_event_id;
    if found then
      if (existing #- '{report,receivedAt}') <> (p_data #- '{report,receivedAt}') then return jsonb_build_object('code','EVENT_CONFLICT'); end if;
      return jsonb_build_object('code','OK','duplicate',true);
    end if;
    if (select count(*) from public.coordinator_events)>=100 then return jsonb_build_object('code','EVENT_LIMIT'); end if;
    insert into public.coordinator_events(event_id,input) values(target_event_id,p_data);
    s := s || jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    update public.coordinator_runtime set state=s where singleton;
    return jsonb_build_object('code','OK','duplicate',false);
  end if;
  if p_kind='claim' then
    if row.lease_until > now() then return jsonb_build_object('code','BUSY'); end if;
    if not exists(select 1 from public.coordinator_events where status='pending') and
      (jsonb_array_length(s->'events')=0 or row.last_attempt_at > now()-interval '5 seconds') then
      return jsonb_build_object('code','IDLE');
    end if;
    update public.coordinator_runtime set lease_token=p_token,lease_until=now()+interval '120 seconds',last_attempt_at=now(),lease_event_ids=(select coalesce(jsonb_agg(e->'eventId'),'[]') from jsonb_array_elements(s->'events') e) where singleton;
    return jsonb_build_object('code','OK','state',s);
  end if;
  if row.lease_token is distinct from p_token or row.lease_until <= now() then return jsonb_build_object('code','LEASE_LOST'); end if;
  if p_kind='prepared' then
    target_event_id := (p_data->>'eventId')::uuid;
    if not exists(select 1 from public.coordinator_events e where e.event_id=target_event_id and status='pending') then return jsonb_build_object('code','EVENT_CONFLICT'); end if;
    update public.coordinator_events e set status=p_data->>'status',evidence=p_data->'evidence' where e.event_id=target_event_id;
    if p_data->>'status'='accepted' then
      s := jsonb_set(s,'{events}',(s->'events') || jsonb_build_array(jsonb_build_object('eventId',target_event_id,
        'summary',p_data->>'summary','status','active','priority',null,'rationale',null)));
      s := s || jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
      update public.coordinator_runtime set state=s where singleton;
    end if;
    return jsonb_build_object('code','OK');
  end if;
  if p_kind='finish' then
    update public.coordinator_runtime set lease_token=null,lease_until=null where singleton;
    return jsonb_build_object('code','OK');
  end if;
  if p_kind='failure' then
    insert into public.coordinator_audit(id,trigger,input_revision,input_state,outcome)
      values(p_token,coalesce(p_data->>'trigger','timer.tick'),(s->>'revision')::bigint,s,'MODEL_OR_VALIDATION_ERROR') on conflict do nothing;
    update public.coordinator_runtime set lease_token=null,lease_until=null where singleton;
    return jsonb_build_object('code','OK');
  end if;
  if p_kind <> 'commit' then return jsonb_build_object('code','UNSUPPORTED_OPERATION'); end if;
  proposal := p_data->'proposal';
  -- Intake can advance revision while the single lease owner is planning.
  -- Filtering may add events; commit updates only the claimed event snapshot.
  -- Reset revokes this lease.
  -- Full event coverage and existing assignments are independently checked below.
  if (proposal->>'basedOnRevision')::bigint > (s->>'revision')::bigint then
    insert into public.coordinator_audit(id,trigger,input_revision,input_state,outcome,proposal)
      values(p_token,p_data->>'trigger',(proposal->>'basedOnRevision')::bigint,s,'STALE',proposal);
    update public.coordinator_runtime set lease_token=null,lease_until=null where singleton;
    return jsonb_build_object('code','STATE_CONFLICT');
  end if;
  -- Database independently enforces complete coverage and preservation of commitments.
  if jsonb_typeof(proposal->'priorities') is distinct from 'array' or jsonb_typeof(proposal->'assignments') is distinct from 'array' then raise exception 'Invalid proposal arrays'; end if;
  if jsonb_array_length(proposal->'priorities')<>jsonb_array_length(row.lease_event_ids) or
    (select count(distinct value->>'eventId') from jsonb_array_elements(proposal->'priorities'))<>jsonb_array_length(row.lease_event_ids) or
    exists(select 1 from jsonb_array_elements(proposal->'priorities') p where not exists(select 1 from jsonb_array_elements_text(row.lease_event_ids) id where id=p->>'eventId') or p->>'priority' not in ('low','medium','high','critical')) then raise exception 'Invalid priority coverage'; end if;
  if (select count(distinct value->>'ambulanceId') from jsonb_array_elements(proposal->'assignments'))<>jsonb_array_length(proposal->'assignments') or
    exists(select 1 from jsonb_array_elements(proposal->'assignments') a where
      not exists(select 1 from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'id'=a->>'ambulanceId') or
      not exists(select 1 from jsonb_array_elements(s->'events') e where e->>'eventId'=a->>'eventId')) or
    exists(select 1 from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'status'='assigned' and not exists(
      select 1 from jsonb_array_elements(proposal->'assignments') a where a->>'ambulanceId'=u->>'id' and a->>'eventId'=u->>'eventId')) then raise exception 'Invalid assignment or attempted release'; end if;
  select coalesce(jsonb_agg(e || case when p is null then '{}'::jsonb else jsonb_build_object('priority',p->'priority','rationale',p->'rationale') end order by e->>'eventId'),'[]') into events
    from jsonb_array_elements(s->'events') e left join jsonb_array_elements(proposal->'priorities') p on e->>'eventId'=p->>'eventId';
  select jsonb_agg(jsonb_build_object('id',u->'id','status',case when a is null then 'available' else 'assigned' end,'eventId',a->'eventId') order by (substring(u->>'id' from 11))::int) into units
    from jsonb_array_elements(s#>'{ambulances,units}') u left join jsonb_array_elements(proposal->'assignments') a on a->>'ambulanceId'=u->>'id';
  assigned := jsonb_array_length(proposal->'assignments');
  existing := s || jsonb_build_object('events',events,'situationOverview',proposal->'situationOverview','plan',proposal->'plan',
    'ambulances',jsonb_build_object('total',10,'available',10-assigned,'allocated',assigned,'units',units));
  if existing <> s then existing := existing || jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp); end if;
  insert into public.coordinator_audit(id,trigger,input_revision,input_state,outcome,proposal)
    values(p_token,p_data->>'trigger',(s->>'revision')::bigint,s,case when existing=s then 'UNCHANGED' else 'COMMITTED' end,proposal);
  update public.coordinator_runtime set state=existing,lease_token=null,lease_until=null where singleton;
  return jsonb_build_object('code','OK','state',existing);
end;
$$;
revoke all on function public.coordinate_crisis(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.coordinate_crisis(text,uuid,jsonb) to service_role;

create or replace function public.prepare_coordinator_report(p_run_id uuid,p_event_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; stored jsonb; old_status text; stamp text;
begin
  select state into strict s from public.coordinator_runtime where singleton for update;
  if s->>'runId' <> p_run_id::text then return jsonb_build_object('code','RUN_CONFLICT'); end if;
  select input,status into stored,old_status from public.coordinator_events where event_id=p_event_id;
  if not found or stored#>>'{report,runId}' <> p_run_id::text then return jsonb_build_object('code','EVENT_CONFLICT'); end if;
  if old_status <> 'pending' then return jsonb_build_object('code','DUPLICATE'); end if;
  if p_data->>'status' not in ('accepted','filtered','error') then raise exception 'Invalid filtering status'; end if;
  update public.coordinator_events set status=p_data->>'status',evidence=p_data->'evidence' where event_id=p_event_id;
  if p_data->>'status'='accepted' then
    stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    s := jsonb_set(s,'{events}',s->'events' || jsonb_build_array(jsonb_build_object('eventId',p_event_id,
      'summary',p_data->>'summary','status','active','priority',null,'rationale',null)));
    s := s || jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    update public.coordinator_runtime set state=s where singleton;
  end if;
  return jsonb_build_object('code','OK','status',p_data->>'status');
end;
$$;
revoke all on function public.prepare_coordinator_report(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_coordinator_report(uuid,uuid,jsonb) to service_role;
