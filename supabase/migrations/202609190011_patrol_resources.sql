-- Add finite patrol inventories while retaining the existing ambulance contract.
do $$
declare k text; prefix text; inventory jsonb;
begin
  foreach k in array array['police','civilGuard'] loop
    prefix := case when k='police' then 'police-' else 'civil-guard-' end;
    select jsonb_build_object('total',10,'available',10,'allocated',0,'units',jsonb_agg(jsonb_build_object('id',prefix||i,'status','available','eventId',null) order by i)) into inventory from generate_series(1,10) i;
    update public.coordinator_runtime set state=jsonb_set(state,array[k],inventory) where singleton and not state ? k;
  end loop;
  update public.coordinator_runtime set state=state||jsonb_build_object('revision',(state->>'revision')::bigint+1),lease_token=null,lease_until=null where singleton;
end $$;

alter function public.coordinate_crisis(text,uuid,jsonb) rename to coordinate_crisis_before_patrols;
create function public.coordinate_crisis(p_kind text,p_token uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.coordinator_runtime%rowtype; result jsonb; k text; field text; inv jsonb; allocations jsonb; units jsonb; inventories jsonb := '{}'; n integer; stamp text;
begin
  if p_kind <> 'commit' then return public.coordinate_crisis_before_patrols(p_kind,p_token,p_data); end if;
  select * into strict r from public.coordinator_runtime where singleton for update;
  if r.lease_token is distinct from p_token or r.lease_until<=now() then return jsonb_build_object('code','LEASE_LOST'); end if;
  foreach k in array array['police','civilGuard'] loop
    field := case when k='police' then 'policeAssignments' else 'civilGuardAssignments' end;
    inv := r.state->k; allocations := p_data->'proposal'->field;
    if jsonb_typeof(allocations) is distinct from 'array' then raise exception 'Missing patrol assignments'; end if;
    if jsonb_array_length(allocations)>10 or (select count(distinct a->>'unitId') from jsonb_array_elements(allocations) a)<>jsonb_array_length(allocations) or
      exists(select 1 from jsonb_array_elements(allocations) a where not exists(select 1 from jsonb_array_elements(inv->'units') u where u->>'id'=a->>'unitId') or not exists(select 1 from jsonb_array_elements(r.state->'events') e where e->>'eventId'=a->>'eventId')) or
      exists(select 1 from jsonb_array_elements(inv->'units') u where u->>'status'='assigned' and not exists(select 1 from jsonb_array_elements(allocations) a where a->>'unitId'=u->>'id' and a->>'eventId'=u->>'eventId')) then raise exception 'Invalid patrol assignments'; end if;
    select jsonb_agg(jsonb_build_object('id',u->'id','status',case when a is null then 'available' else 'assigned' end,'eventId',a->'eventId') order by u->>'id') into units from jsonb_array_elements(inv->'units') u left join jsonb_array_elements(allocations) a on a->>'unitId'=u->>'id';
    n := jsonb_array_length(allocations);
    inventories := inventories || jsonb_build_object(k,jsonb_build_object('total',10,'available',10-n,'allocated',n,'units',units));
  end loop;
  result := public.coordinate_crisis_before_patrols(p_kind,p_token,p_data);
  if result->>'code'<>'OK' then return result; end if;
  select * into strict r from public.coordinator_runtime where singleton for update;
  if r.state->'police' is distinct from inventories->'police' or r.state->'civilGuard' is distinct from inventories->'civilGuard' then
    stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    r.state := r.state || inventories || jsonb_build_object('revision',(r.state->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    update public.coordinator_runtime set state=r.state where singleton;
  end if;
  return result || jsonb_build_object('state',r.state);
end $$;
revoke all on function public.coordinate_crisis(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.coordinate_crisis(text,uuid,jsonb) to service_role;

alter function public.reset_coordinator_demo() rename to reset_coordinator_before_patrols;
create function public.reset_coordinator_demo() returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; k text; prefix text; inventory jsonb;
begin
  s := public.reset_coordinator_before_patrols();
  foreach k in array array['police','civilGuard'] loop
    prefix := case when k='police' then 'police-' else 'civil-guard-' end;
    select jsonb_build_object('total',10,'available',10,'allocated',0,'units',jsonb_agg(jsonb_build_object('id',prefix||i,'status','available','eventId',null) order by i)) into inventory from generate_series(1,10) i;
    s := jsonb_set(s,array[k],inventory);
  end loop;
  update public.coordinator_runtime set state=s where singleton;
  return s;
end $$;
revoke all on function public.reset_coordinator_demo() from public,anon,authenticated;
grant execute on function public.reset_coordinator_demo() to service_role;
