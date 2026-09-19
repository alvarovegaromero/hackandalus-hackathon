-- On-demand v2 database exercise. No persistent reservations or releases.
begin;
do $$
declare
  s jsonb; after_commit jsonb; result jsonb; proposal jsonb; payload jsonb;
  event_id uuid := gen_random_uuid(); second_event uuid := gen_random_uuid();
  token uuid := gen_random_uuid(); second_token uuid := gen_random_uuid();
  ambulance text; rejected boolean := false;
begin
  select state into strict s from public.coordinator_runtime where singleton for update;
  if exists(select 1 from public.coordinator_events where status='pending') then raise exception 'Run with no pending inputs'; end if;
  if exists(select 1 from public.coordinator_runtime where lease_until > now()) then raise exception 'Stop the worker before this manual exercise'; end if;
  select u->>'id' into ambulance from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'status'='available' limit 1;
  if ambulance is null then raise exception 'One free ambulance required'; end if;
  payload := jsonb_build_object('report',jsonb_build_object('id',event_id,'runId',s->'runId','source','scenario','text','Synthetic wildfire report','receivedAt','2026-09-19T00:00:00Z','extracted','{}'::jsonb));
  result := public.coordinate_crisis('enqueue',token,payload);
  if result->>'code'<>'OK' or result->>'duplicate'<>'false' then raise exception 'Enqueue failed'; end if;
  result := public.coordinate_crisis('enqueue',token,payload);
  if result->>'duplicate'<>'true' then raise exception 'Duplicate failed'; end if;
  raise notice 'PASS: durable event and deduplicated retry';
  result := public.coordinate_crisis('claim',token);
  if result->>'code'<>'OK' then raise exception 'Claim failed'; end if;
  result := public.coordinate_crisis('claim',second_token);
  if result->>'code'<>'BUSY' then raise exception 'Concurrent worker was not blocked'; end if;
  raise notice 'PASS: one worker lease at a time';
  result := public.coordinate_crisis('prepared',token,jsonb_build_object('eventId',event_id,'status','accepted','summary','Synthetic wildfire','evidence','{}'::jsonb));
  if result->>'code'<>'OK' then raise exception 'Preparation failed'; end if;
  select state into s from public.coordinator_runtime where singleton;
  proposal := jsonb_build_object('basedOnRevision',s->'revision','situationOverview','Simulated response','plan',jsonb_build_object('objective','Coordinate simulated assistance','steps',jsonb_build_array('Verify access')),
    'priorities',(select jsonb_agg(jsonb_build_object('eventId',e->'eventId','priority','high','rationale','Synthetic observation')) from jsonb_array_elements(s->'events') e),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('ambulanceId',u->'id','eventId',u->'eventId')) from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'status'='assigned'),'[]'::jsonb) || jsonb_build_array(jsonb_build_object('ambulanceId',ambulance,'eventId',event_id)));
  result := public.coordinate_crisis('commit',token,jsonb_build_object('trigger','manual','proposal',proposal));
  if result->>'code'<>'OK' then raise exception 'Commit failed'; end if;
  after_commit := result->'state';
  if (after_commit#>>'{ambulances,allocated}')::int <> (s#>>'{ambulances,allocated}')::int+1 then raise exception 'Allocation mismatch'; end if;
  raise notice 'PASS: global plan and assignment commit together';
  update public.coordinator_runtime set last_attempt_at=now()-interval '6 seconds' where singleton;
  result := public.coordinate_crisis('claim',second_token);
  proposal := proposal || jsonb_build_object('basedOnRevision',after_commit->'revision');
  result := public.coordinate_crisis('commit',second_token,jsonb_build_object('trigger','timer.tick','proposal',proposal));
  if result->'state' <> after_commit then raise exception 'Unchanged tick modified state'; end if;
  raise notice 'PASS: unchanged timer result does not increment revision';
  update public.coordinator_runtime set last_attempt_at=now()-interval '6 seconds' where singleton;
  token := gen_random_uuid(); result := public.coordinate_crisis('claim',token);
  begin
    perform public.coordinate_crisis('commit',token,jsonb_build_object('trigger','manual','proposal',proposal || jsonb_build_object('assignments','[]'::jsonb)));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Release was accepted'; end if;
  raise notice 'PASS: existing assignments cannot be removed';
  rejected := false;
  begin
    perform public.coordinate_crisis('commit',token,jsonb_build_object('trigger','manual','proposal',proposal || jsonb_build_object('assignments',jsonb_build_array(jsonb_build_object('ambulanceId','ambulance-999','eventId',event_id)))));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Invented vehicle accepted'; end if;
  raise notice 'PASS: invented resource rejected';
  result := public.coordinate_crisis('release',token);
  if result->>'code'<>'UNSUPPORTED_OPERATION' then raise exception 'Release input enabled'; end if;
  raise notice 'PASS: release operation disabled';
  payload := jsonb_set(payload,'{report,id}',to_jsonb(second_event));
  perform public.coordinate_crisis('enqueue',second_token,payload);
  result := public.coordinate_crisis('commit',token,jsonb_build_object('trigger','manual','proposal',proposal));
  if result->>'code'<>'STATE_CONFLICT' then raise exception 'Stale result accepted'; end if;
  raise notice 'PASS: newly arrived event invalidates in-flight proposal';
end;
$$;
rollback;
select '8 coordinator scenarios passed; changes rolled back' as result, state from public.coordinator_runtime where singleton;

