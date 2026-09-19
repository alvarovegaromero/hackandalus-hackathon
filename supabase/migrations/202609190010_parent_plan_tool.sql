-- Parent-only plan text mutation. Requires coordinator_runtime and coordinator_audit (005).
-- Preserves the FE object shape and any additive plan fields; no inventory mutation.
create function public.update_parent_plan(p_run_id uuid,p_update_id uuid,p_expected_revision bigint,p_plan jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; before_state jsonb; prior public.coordinator_audit%rowtype; request jsonb; response jsonb; stamp text;
begin
  select state into strict s from public.coordinator_runtime where singleton for update;
  if s->>'runId' is distinct from p_run_id::text then return jsonb_build_object('code','RUN_CONFLICT'); end if;
  request:=jsonb_build_object('runId',p_run_id,'expectedRevision',p_expected_revision,'plan',p_plan,'reason',p_reason);
  select * into prior from public.coordinator_audit where id=p_update_id;
  if found then
    if prior.trigger<>'parent.plan_updated' or prior.proposal->'request' is distinct from request then
      return jsonb_build_object('code','UPDATE_CONFLICT');
    end if;
    return (prior.proposal->'response')||jsonb_build_object('duplicate',true);
  end if;
  if p_expected_revision is distinct from (s->>'revision')::bigint then return jsonb_build_object('code','STATE_CONFLICT'); end if;
  if exists(select 1 from public.coordinator_events where status='pending') then return jsonb_build_object('code','INPUT_PENDING'); end if;
  if jsonb_typeof(p_plan) is distinct from 'object' then raise exception 'Invalid plan'; end if;
  if p_plan - 'objective' - 'steps' <> '{}'::jsonb or jsonb_typeof(p_plan->'objective') is distinct from 'string' or
    length(p_plan->>'objective') not between 1 and 2000 or jsonb_typeof(p_plan->'steps') is distinct from 'array' or
    p_reason is null or length(p_reason) not between 1 and 2000 then raise exception 'Invalid plan fields'; end if;
  if jsonb_array_length(p_plan->'steps') not between 1 and 20 or exists(
    select 1 from jsonb_array_elements(p_plan->'steps') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 2000) then raise exception 'Invalid plan steps'; end if;
  before_state:=s;
  s:=jsonb_set(s,'{plan}',coalesce(nullif(s->'plan','null'::jsonb),'{}')||p_plan);
  if s<>before_state then
    stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    s:=s||jsonb_build_object('revision',(s->>'revision')::bigint+1,'updatedAt',stamp,'generatedAt',stamp);
    -- Current inline coordinator permits intake revision changes. Cancel its lease
    -- explicitly so an older model proposal cannot overwrite this plan edit.
    update public.coordinator_runtime set state=s,lease_token=null,lease_until=null,last_attempt_at=now() where singleton;
  end if;
  response:=jsonb_build_object('code','OK','revision',s->'revision','changed',s<>before_state,'duplicate',false);
  insert into public.coordinator_audit(id,trigger,input_revision,input_state,outcome,proposal)
    values(p_update_id,'parent.plan_updated',(before_state->>'revision')::bigint,before_state,
      case when s=before_state then 'UNCHANGED' else 'COMMITTED' end,jsonb_build_object('request',request,'response',response));
  return response;
end;
$$;
revoke all on function public.update_parent_plan(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.update_parent_plan(uuid,uuid,bigint,jsonb,text) to service_role;
