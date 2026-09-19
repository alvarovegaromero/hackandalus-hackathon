-- On-demand transactional smoke exercise. All changes are rolled back.
begin;
do $$
declare
  initial jsonb; s jsonb; command jsonb; answer jsonb;
  op uuid := gen_random_uuid(); release_op uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid(); plan_id uuid := gen_random_uuid();
begin
  select state into initial from public.resource_inventory where singleton for update;
  if (initial#>>'{resources,0,available}')::integer < 3 then
    raise exception 'Need at least three free ambulances for this manual exercise';
  end if;
  command := jsonb_build_object('kind', 'allocate', 'stateId', initial->'stateId',
    'runId', initial->'runId', 'expectedRevision', initial->'revision', 'quantity', 3,
    'planning', jsonb_build_object('plan', jsonb_build_object('runId', initial->'runId',
      'executionId', op, 'eventId', event_id, 'planId', plan_id)));
  answer := public.mutate_resource_inventory(op, command);
  s := answer->'state';
  if answer->>'code' <> 'OK' or (s#>>'{resources,0,available}')::int <> (initial#>>'{resources,0,available}')::int - 3
    then raise exception 'Allocation failed'; end if;
  raise notice 'PASS: allocate three ambulances';
  answer := public.mutate_resource_inventory(op, command);
  if answer->>'replayed' <> 'true' or answer->'state' <> s then raise exception 'Replay failed'; end if;
  raise notice 'PASS: retry does not consume twice';
  answer := public.mutate_resource_inventory(op, command || '{"quantity":2}'::jsonb);
  if answer->>'code' <> 'IDEMPOTENCY_CONFLICT' then raise exception 'Identity conflict failed'; end if;
  raise notice 'PASS: changed operation rejected';
  answer := public.mutate_resource_inventory(gen_random_uuid(), command);
  if answer->>'code' <> 'STATE_CONFLICT' then raise exception 'Stale revision failed'; end if;
  raise notice 'PASS: stale snapshot rejected';
  answer := public.mutate_resource_inventory(gen_random_uuid(), command || jsonb_build_object(
    'expectedRevision', s->'revision', 'quantity', (s#>>'{resources,0,available}')::int + 1));
  if answer->>'code' <> 'INSUFFICIENT_RESOURCES' then raise exception 'Shortage failed'; end if;
  raise notice 'PASS: insufficient resources rejected';
  command := jsonb_build_object('kind', 'release', 'stateId', s->'stateId', 'runId', s->'runId',
    'expectedRevision', s->'revision', 'allocationId', op);
  answer := public.mutate_resource_inventory(release_op, command);
  if answer->>'code' <> 'OK' or answer#>'{state,resources}' <> initial->'resources'
    then raise exception 'Release failed'; end if;
  answer := public.mutate_resource_inventory(release_op, command);
  if answer->>'replayed' <> 'true' or answer#>'{state,resources}' <> initial->'resources'
    then raise exception 'Release replay failed'; end if;
  raise notice 'PASS: release and repeated release restore capacity once';
  -- Reassign only after release; the old allocation must never reappear.
  s := answer->'state';
  op := gen_random_uuid();
  command := jsonb_build_object('kind', 'allocate', 'stateId', s->'stateId', 'runId', s->'runId',
    'expectedRevision', s->'revision', 'quantity', (s#>>'{resources,0,available}')::int,
    'planning', jsonb_build_object('plan', jsonb_build_object('runId', s->'runId',
      'executionId', op, 'eventId', gen_random_uuid(), 'planId', gen_random_uuid())));
  answer := public.mutate_resource_inventory(op, command);
  if answer->>'code' <> 'OK' or answer#>>'{state,resources,0,available}' <> '0'
    then raise exception 'Reallocation failed'; end if;
  raise notice 'PASS: released units can be assigned to a different event';
  s := answer->'state';
  answer := public.mutate_resource_inventory(gen_random_uuid(), command || jsonb_build_object(
    'expectedRevision', s->'revision', 'quantity', 1));
  if answer->>'code' <> 'INSUFFICIENT_RESOURCES' then raise exception 'Exhaustion failed'; end if;
  raise notice 'PASS: exhausted inventory cannot be overdrawn';
end;
$$;
rollback;
