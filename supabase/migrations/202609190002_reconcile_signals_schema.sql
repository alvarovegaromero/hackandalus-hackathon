-- Reconcile the deployed triage-oriented signals table with the durable
-- HappyRobot receipt expected by src/lib/signals/repository.ts.
-- Existing triage rows and columns are preserved.

begin;

alter table public.signals
  add column if not exists external_identity text,
  add column if not exists raw_payload jsonb,
  add column if not exists processing_status text default 'received',
  add column if not exists event_id text,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_error text;

-- Give existing rows a stable transport identity without claiming that they
-- came from HappyRobot. Preserve their complete prior representation as the
-- raw payload because the deployed table's `raw` column may be null.
update public.signals as signal
set external_identity = 'legacy:signal:' || signal.id::text
where external_identity is null;

update public.signals as signal
set raw_payload = coalesce(signal.raw, to_jsonb(signal) - 'raw_payload')
where raw_payload is null;

update public.signals
set processing_status = 'received'
where processing_status is null;

alter table public.signals
  alter column external_identity set not null,
  alter column raw_payload set not null,
  alter column processing_status set default 'received',
  alter column processing_status set not null;

create unique index if not exists signals_external_identity_key
  on public.signals (external_identity);

create index if not exists signals_status_created_idx
  on public.signals (processing_status, created_at);

alter table public.signals
  drop constraint if exists signals_processing_status_check,
  add constraint signals_processing_status_check
    check (processing_status in ('received', 'processing', 'processed', 'failed')),
  drop constraint if exists signals_processed_event_check,
  add constraint signals_processed_event_check
    check ((processing_status = 'processed') = (event_id is not null)),
  drop constraint if exists signals_failed_error_check,
  add constraint signals_failed_error_check
    check (processing_status <> 'failed' or processing_error is not null);

-- The deployed table also represents interpreted/triaged signals. These
-- fields cannot be required while FARO is persisting an observation before
-- interpretation. Existing populated values remain unchanged.
alter table public.signals
  alter column run_id drop not null,
  alter column title drop not null,
  alter column body drop not null,
  alter column category drop not null,
  alter column severity drop not null,
  alter column dedupe_key drop not null;

-- Keep every channel already supported by the deployed triage model and add
-- the exact inbound `voice` value emitted by HappyRobot.
alter table public.signals
  drop constraint if exists signals_channel_check,
  add constraint signals_channel_check
    check (channel in ('voice', 'call', 'sms', 'whatsapp', 'email', 'web', 'api', 'sensor'));

alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;
grant all on public.signals to service_role;

commit;
