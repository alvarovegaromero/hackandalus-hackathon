-- V2 preserves the v1 inventory and audit, and disables its mutation RPC.
create table public.coordinator_runtime (
  singleton boolean primary key default true check (singleton),
  state jsonb not null,
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz
);
create table public.coordinator_events (
  event_id uuid primary key,
  input jsonb not null,
  status text not null default 'pending' check(status in ('pending','accepted','filtered','error')),
  evidence jsonb,
  created_at timestamptz not null default now()
);
create table public.coordinator_audit (
  id uuid primary key,
  trigger text not null,
  input_revision bigint not null,
  input_state jsonb not null,
  outcome text not null,
  proposal jsonb,
  created_at timestamptz not null default now()
);
create index coordinator_events_pending on public.coordinator_events(created_at) where status='pending';
alter table public.coordinator_runtime enable row level security;
alter table public.coordinator_events enable row level security;
alter table public.coordinator_audit enable row level security;
revoke all on public.coordinator_runtime, public.coordinator_events, public.coordinator_audit from anon, authenticated;
grant select,update on public.coordinator_runtime to service_role;
grant select,insert,update on public.coordinator_events to service_role;
grant select,insert on public.coordinator_audit to service_role;

do $$
declare old jsonb; units jsonb := '[]'; events jsonb := '[]'; a jsonb; n integer := 0; i integer;
begin
  select state into strict old from public.resource_inventory where singleton for update;
  for a in select value from jsonb_array_elements(old->'allocations') loop
    if not exists(select 1 from jsonb_array_elements(events) e where e->>'eventId'=a->>'eventId') then
      events := events || jsonb_build_array(jsonb_build_object('eventId',a->'eventId',
        'summary','Existing ambulance commitment migrated from v1','status','active','priority',null,'rationale',null));
    end if;
    for i in 1..(a#>>'{resources,0,quantity}')::int loop
      n := n+1;
      units := units || jsonb_build_array(jsonb_build_object('id','ambulance-'||n,'status','assigned','eventId',a->'eventId'));
    end loop;
  end loop;
  if n > 10 then raise exception 'Cannot migrate overallocated inventory'; end if;
  for i in (n+1)..10 loop
    units := units || jsonb_build_array(jsonb_build_object('id','ambulance-'||i,'status','available','eventId',null));
  end loop;
  insert into public.coordinator_runtime(state) values ((old - 'resources' - 'allocations') || jsonb_build_object(
    'schemaVersion',2,'situationOverview','','plan',null,'events',events,
    'ambulances',jsonb_build_object('total',10,'available',10-n,'allocated',n,'units',units)));
end;
$$;
revoke execute on function public.mutate_resource_inventory(uuid,jsonb) from service_role;

create function public.coordinate_crisis(p_kind text, p_token uuid, p_data jsonb default '{}')
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
    update public.coordinator_runtime set lease_token=p_token,lease_until=now()+interval '120 seconds',last_attempt_at=now() where singleton;
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
  if proposal->>'basedOnRevision' is distinct from s->>'revision' or exists(select 1 from public.coordinator_events where status='pending') then
    insert into public.coordinator_audit(id,trigger,input_revision,input_state,outcome,proposal)
      values(p_token,p_data->>'trigger',(proposal->>'basedOnRevision')::bigint,s,'STALE',proposal);
    update public.coordinator_runtime set lease_token=null,lease_until=null where singleton;
    return jsonb_build_object('code','STATE_CONFLICT');
  end if;
  -- Database independently enforces complete coverage and preservation of commitments.
  if jsonb_typeof(proposal->'priorities') is distinct from 'array' or jsonb_typeof(proposal->'assignments') is distinct from 'array' then raise exception 'Invalid proposal arrays'; end if;
  if jsonb_array_length(proposal->'priorities')<>jsonb_array_length(s->'events') or
    (select count(distinct value->>'eventId') from jsonb_array_elements(proposal->'priorities'))<>jsonb_array_length(s->'events') or
    exists(select 1 from jsonb_array_elements(proposal->'priorities') p where not exists(select 1 from jsonb_array_elements(s->'events') e where e->>'eventId'=p->>'eventId') or p->>'priority' not in ('low','medium','high','critical')) then raise exception 'Invalid priority coverage'; end if;
  if (select count(distinct value->>'ambulanceId') from jsonb_array_elements(proposal->'assignments'))<>jsonb_array_length(proposal->'assignments') or
    exists(select 1 from jsonb_array_elements(proposal->'assignments') a where
      not exists(select 1 from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'id'=a->>'ambulanceId') or
      not exists(select 1 from jsonb_array_elements(s->'events') e where e->>'eventId'=a->>'eventId')) or
    exists(select 1 from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'status'='assigned' and not exists(
      select 1 from jsonb_array_elements(proposal->'assignments') a where a->>'ambulanceId'=u->>'id' and a->>'eventId'=u->>'eventId')) then raise exception 'Invalid assignment or attempted release'; end if;
  select coalesce(jsonb_agg(e || jsonb_build_object('priority',p->'priority','rationale',p->'rationale') order by e->>'eventId'),'[]') into events
    from jsonb_array_elements(s->'events') e join jsonb_array_elements(proposal->'priorities') p on e->>'eventId'=p->>'eventId';
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
