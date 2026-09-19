-- One active catastrophe inventory. All writes go through the server-only RPC.
create table public.resource_inventory (
  singleton boolean primary key default true check (singleton),
  state jsonb not null
);
create table public.resource_operations (
  operation_id uuid primary key,
  command jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.resource_inventory enable row level security;
alter table public.resource_operations enable row level security;
revoke all on public.resource_inventory, public.resource_operations from anon, authenticated;
grant select, update on public.resource_inventory to service_role;
grant select, insert on public.resource_operations to service_role;

-- Backend-owned demo capacity: 10 ambulances. Never reseed on GET or app restart.
insert into public.resource_inventory (state) values (jsonb_build_object(
  'schemaVersion', 1, 'stateId', gen_random_uuid(), 'runId', gen_random_uuid(),
  'revision', 0, 'generatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'storage', 'supabase', 'executionMode', 'simulation', 'pollAfterMs', 3000,
  'resources', jsonb_build_array(jsonb_build_object('resourceType', 'ambulance',
    'label', 'Ambulances', 'unit', 'vehicle', 'total', 10, 'available', 10, 'allocated', 0)),
  'allocations', '[]'::jsonb
));

create function public.mutate_resource_inventory(p_operation_id uuid, p_command jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s jsonb; previous public.resource_operations%rowtype; a jsonb;
  qty integer; available integer; stamp text; response jsonb;
begin
  -- Lock only during commit, never while waiting for the LLM.
  select state into strict s from public.resource_inventory where singleton for update;
  select * into previous from public.resource_operations where operation_id = p_operation_id;
  if found then
    if previous.command <> p_command then
      return jsonb_build_object('code', 'IDEMPOTENCY_CONFLICT', 'state', s);
    end if;
    return previous.result || jsonb_build_object('state', s, 'replayed', true);
  end if;
  if p_command->>'stateId' is distinct from s->>'stateId'
     or p_command->>'runId' is distinct from s->>'runId'
     or p_command->>'expectedRevision' is distinct from s->>'revision' then
    return jsonb_build_object('code', 'STATE_CONFLICT', 'state', s);
  end if;
  available := (s#>>'{resources,0,available}')::integer;
  stamp := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if p_command->>'kind' = 'allocate' then
    qty := (p_command->>'quantity')::integer;
    if qty is null or qty < 0 or qty > 10 then
      return jsonb_build_object('code', 'INVALID_QUANTITY', 'state', s);
    end if;
    if qty > available then
      return jsonb_build_object('code', 'INSUFFICIENT_RESOURCES', 'state', s);
    end if;
    if p_command#>>'{planning,plan,runId}' is distinct from s->>'runId'
       or p_command#>>'{planning,plan,executionId}' is distinct from p_operation_id::text then
      return jsonb_build_object('code', 'INVALID_CONTEXT', 'state', s);
    end if;
    if qty > 0 then
      a := jsonb_build_object('allocationId', p_operation_id,
        'eventId', p_command#>>'{planning,plan,eventId}',
        'executionId', p_operation_id, 'planId', p_command#>>'{planning,plan,planId}',
        'resources', jsonb_build_array(jsonb_build_object('resourceType', 'ambulance', 'quantity', qty)),
        'allocatedAt', stamp, 'expectedReleaseAt', null);
      s := jsonb_set(s, '{allocations}', (s->'allocations') || jsonb_build_array(a));
    end if;
    available := available - qty;
  elsif p_command->>'kind' = 'release' then
    select value into a from jsonb_array_elements(s->'allocations')
      where value->>'allocationId' = p_command->>'allocationId';
    if a is null then
      return jsonb_build_object('code', 'ALLOCATION_NOT_FOUND', 'state', s);
    end if;
    available := available + (a#>>'{resources,0,quantity}')::integer;
    s := jsonb_set(s, '{allocations}', coalesce((select jsonb_agg(value)
      from jsonb_array_elements(s->'allocations')
      where value->>'allocationId' <> p_command->>'allocationId'), '[]'::jsonb));
  else
    return jsonb_build_object('code', 'INVALID_OPERATION', 'state', s);
  end if;
  s := jsonb_set(s, '{resources,0,available}', to_jsonb(available));
  s := jsonb_set(s, '{resources,0,allocated}', to_jsonb(10 - available));
  s := s || jsonb_build_object('revision', (s->>'revision')::bigint + 1,
    'updatedAt', stamp, 'generatedAt', stamp);
  update public.resource_inventory set state = s where singleton;
  response := jsonb_build_object('code', 'OK', 'state', s, 'replayed', false);
  -- Includes the validated plan, rationale, messages and mock tool audit on allocation.
  insert into public.resource_operations(operation_id, command, result)
    values(p_operation_id, p_command, response);
  return response;
end;
$$;
revoke all on function public.mutate_resource_inventory(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_resource_inventory(uuid, jsonb) to service_role;
