-- Local demo reset: serialize with the worker and revoke its in-flight lease.
create or replace function public.reset_coordinator_demo()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s jsonb; stamp text; units jsonb;
begin
  select state into strict s from public.coordinator_runtime where singleton for update;
  stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select jsonb_agg(jsonb_build_object('id','ambulance-'||i,'status','available','eventId',null) order by i)
    into units from generate_series(1,10) i;
  s := s || jsonb_build_object('stateId',gen_random_uuid(),'runId',gen_random_uuid(),
    'revision',0,'updatedAt',stamp,'generatedAt',stamp,'situationOverview','','plan',null,
    'events','[]'::jsonb,'ambulances',jsonb_build_object('total',10,'available',10,'allocated',0,'units',units));
  delete from public.coordinator_events where event_id is not null;
  update public.coordinator_runtime set state=s,lease_token=null,lease_until=null,last_attempt_at=null where singleton;
  return s;
end;
$$;
revoke all on function public.reset_coordinator_demo() from public, anon, authenticated;
grant execute on function public.reset_coordinator_demo() to service_role;
