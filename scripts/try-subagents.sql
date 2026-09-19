-- Run manually against local PostgreSQL or a reviewed development DB, with workers stopped.
-- Every mission/activity write is rolled back. Existing inventory is never modified.
begin;
do $$
declare
  s jsonb; m jsonb; r jsonb; first_op jsonb; result jsonb; before_state jsonb;
  mid uuid:=gen_random_uuid(); tok uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  eid text; rejected boolean:=false;
begin
  select state into strict s from public.coordinator_runtime where singleton;
  before_state:=s;
  if exists(select 1 from public.subagent_missions) then raise exception 'Use an empty subagent queue for this exercise'; end if;
  select value->>'eventId' into eid from jsonb_array_elements(s->'events') limit 1;
  if eid is null then raise exception 'Requires an existing active incident; use a local synthetic fixture'; end if;
  m:=jsonb_build_object('missionId',mid,'runId',s->'runId','eventId',eid,'revision',1,
    'objective','Coordinate simulated medical assistance','instructions','Confirm access through a mock contact',
    'context',jsonb_build_object('incidentSummary','Synthetic wildfire','priority','high'),
    'assignedResourceIds',coalesce((select jsonb_agg(u->'id') from jsonb_array_elements(s#>'{ambulances,units}') u where u->>'eventId'=eid),'[]'),
    'allowedTools',jsonb_build_array('contactService','getContactResult'));
  r:=public.subagent_execution('submit',tok,jsonb_set(m,'{assignedResourceIds}','["ambulance-999"]'));
  if r->>'code'<>'RESOURCE_NOT_RESERVED' then raise exception 'Invented resource accepted'; end if;
  raise notice 'PASS: execution cannot reserve or invent resources';
  r:=public.subagent_execution('submit',tok,m);
  if r->>'code'<>'OK' or r->>'duplicate'<>'false' then raise exception 'Submission failed'; end if;
  r:=public.subagent_execution('submit',tok,m);
  if r->>'duplicate'<>'true' then raise exception 'Duplicate mission'; end if;
  r:=public.subagent_execution('submit',tok,jsonb_set(m,'{missionId}',to_jsonb(other)));
  if r->>'code'<>'MISSION_CONFLICT' then raise exception 'Second mission for incident accepted'; end if;
  raise notice 'PASS: immutable mission retries and one mission per incident';
  r:=public.subagent_execution('claim',tok);
  if r->>'code'<>'OK' then raise exception 'Claim failed'; end if;
  r:=public.subagent_execution('claim',other);
  if r->>'code'<>'IDLE' then raise exception 'Double claim'; end if;
  r:=public.subagent_execution('contact',other,jsonb_build_object('missionId',mid));
  if r->>'code'<>'LEASE_LOST' then raise exception 'Foreign worker used lease'; end if;
  raise notice 'PASS: one execution lease per mission';
  r:=public.subagent_execution('contact',tok,jsonb_build_object('missionId',mid,'service','medical_coordination','message','Synthetic request'));
  first_op:=r->'operation';
  r:=public.subagent_execution('contact',tok,jsonb_build_object('missionId',mid,'service','medical_coordination','message','Reworded retry'));
  if r->'operation'<>first_op then raise exception 'Repeated communication'; end if;
  raise notice 'PASS: mock contacts are idempotent across reworded calls';
  begin
    perform public.subagent_execution('finish',tok,jsonb_build_object('missionId',mid,'decision',jsonb_build_object('status','completed','summary','Simulation','resourceRequest',null)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Completed pending communication'; end if;
  raise notice 'PASS: completion requires acknowledged mock evidence';
  r:=public.subagent_execution('finish',tok,jsonb_build_object('missionId',mid,'decision',jsonb_build_object('status','waiting','summary','Waiting for mock response','resourceRequest',null)));
  if r->>'code'<>'OK' then raise exception 'Waiting failed'; end if;
  r:=public.subagent_execution('claim',other);
  if r->>'code'<>'IDLE' then raise exception 'Waiting loop did not back off'; end if;
  update public.subagent_missions set next_attempt_at=now()-interval '11 seconds' where mission_id=mid;
  r:=public.subagent_execution('claim',other);
  if r->>'code'<>'OK' or jsonb_array_length(r->'operations')<>1 then raise exception 'Resume lost operations'; end if;
  r:=public.subagent_execution('contact_result',other,jsonb_build_object('missionId',mid,'operationId',gen_random_uuid()));
  if r->>'code'<>'OPERATION_NOT_FOUND' then raise exception 'Unknown contact leaked'; end if;
  raise notice 'PASS: waiting resumes with persisted operations and scoped access';
  r:=public.subagent_execution('contact_result',other,jsonb_build_object('missionId',mid,'operationId',first_op->'operationId'));
  if r#>>'{operation,status}'<>'acknowledged' then raise exception 'Mock callback failed'; end if;
  r:=public.subagent_execution('finish',other,jsonb_build_object('missionId',mid,'decision',jsonb_build_object('status','completed','summary','Mock service acknowledged; no actual dispatch','resourceRequest',null)));
  result:=r->'result';
  if result->>'status'<>'completed' or result->>'realActionsExecuted'<>'false' or jsonb_array_length(result->'externalOperationIds')<>1 then raise exception 'Invalid parent result'; end if;
  select state into s from public.coordinator_runtime where singleton;
  if s<>before_state then raise exception 'Subagent changed global inventory'; end if;
  raise notice 'PASS: completion preserves every resource commitment and returns parent update';
  r:=public.subagent_execution('claim',tok);
  if r->>'code'<>'IDLE' then raise exception 'Completed mission reran'; end if;
  if (select count(*) from public.subagent_activity where mission_id=mid and type='contact.started')<>1 then raise exception 'Duplicate activity'; end if;
  raise notice 'PASS: completed missions do not rerun; activity is durable';
end;
$$;
rollback;
select '8 subagent scenarios passed; all writes rolled back' as result;
