-- Durable raw observations received from external and simulated sources.
-- Interpretation stays in FARO; raw_payload is immutable provenance.
create table public.signals (
  id uuid primary key,
  source text not null check (source in ('happyrobot')),
  channel text not null check (channel in ('voice', 'sms', 'whatsapp')),
  external_identity text not null unique,
  received_at timestamptz not null,
  raw_payload jsonb not null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed')),
  event_id text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  check ((processing_status = 'processed') = (event_id is not null)),
  check (processing_status <> 'failed' or processing_error is not null)
);

create index signals_status_created_idx
  on public.signals (processing_status, created_at);

alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;
grant all on public.signals to service_role;
