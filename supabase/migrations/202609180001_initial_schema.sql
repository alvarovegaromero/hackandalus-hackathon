-- Apply manually to a development project. No public access until operator auth
-- and incident-specific RLS policies are implemented.
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open' check (status in ('open', 'paused', 'closed')),
  created_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key,
  incident_id uuid not null references public.incidents(id),
  summary text not null check (length(summary) between 1 and 2000),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  source text not null check (source in ('operator', 'sensor', 'webhook')),
  created_at timestamptz not null default now()
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  name text not null,
  capacity integer not null default 1 check (capacity >= 0),
  status text not null default 'available' check (status in ('available', 'assigned', 'unavailable'))
);
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  decision jsonb not null,
  mode text not null check (mode in ('simulation', 'ai')),
  created_at timestamptz not null default now()
);
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id),
  idempotency_key text not null unique,
  kind text not null check (kind in ('review', 'notify', 'allocate')),
  description text not null,
  status text not null default 'proposed' check (status in ('proposed', 'running', 'succeeded', 'failed', 'cancelled', 'blocked', 'simulated')),
  created_at timestamptz not null default now()
);
create table public.results (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index events_incident_created_idx on public.events (incident_id, created_at desc);
create index resources_incident_idx on public.resources (incident_id);
create index plans_event_idx on public.plans (event_id);
create index actions_plan_idx on public.actions (plan_id);
create index results_action_idx on public.results (action_id);

alter table public.incidents enable row level security;
alter table public.events enable row level security;
alter table public.resources enable row level security;
alter table public.plans enable row level security;
alter table public.actions enable row level security;
alter table public.results enable row level security;
revoke all on public.incidents, public.events, public.resources, public.plans, public.actions, public.results from anon, authenticated;
grant all on public.incidents, public.events, public.resources, public.plans, public.actions, public.results to service_role;
alter publication supabase_realtime add table public.events;
