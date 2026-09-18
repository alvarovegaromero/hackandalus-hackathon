# Input / event-ingestion architecture

Design + implementation guide for the **input** side of the crisis system: how
external events enter, get validated, deduplicated, persisted, and turned into
workflow runs. Written so a teammate can implement it without re-deriving the
design.

Scope of this document:

- **Milestone A (implemented):** a **synchronous** ingestion endpoint that
  accepts **many events in one request** and processes them **concurrently**.
- **Milestone B (documented, deferred):** the **async / topic** evolution
  (Supabase Realtime fan-out to the dashboard). Section at the end. Do not
  implement B until A is merged and demoable.

Read `PROJECT.md`, `CHALLENGE.md`, and `README.md` first. This doc is the
authoritative reference for the ingestion path; keep it in sync with the code
(see the self-updating-docs rule in `PROJECT.md` → "Implementation and
verification").

---

## 1. What exists today

- `POST /api/events` - `src/app/api/events/route.ts`. Authorizes with the
  static bearer token `CRISIS_API_TOKEN` (`src/lib/api-auth.ts`), normalizes one
  event, an array or `{ events }`, and delegates to `ingestBatch`.
- `ingestBatch` - `src/lib/ingest-server.ts`. Size checks (`400`/`413`),
  persistence (Supabase or in-memory fallback), `start(crisisWorkflow, [event])`
  per new event, optional `wait` mode.
- `ingest` - `src/lib/ingest.ts`. Framework-free pipeline: validate, in-batch
  dedup, persist, bounded concurrent starts, per-event partition. Unit tests in
  `src/lib/ingest.test.ts`.
- `POST /api/scenario/signals` - `src/app/api/scenario/signals/route.ts`. Demo
  bridge with no token: the dashboard's scenario panel sends simulated `Signal`s,
  which `signalToEvent` (`src/lib/signals/to-event.ts`) maps to `CrisisEvent`s
  with stable ids, then calls `ingestBatch` in wait mode. Open in development;
  in production it answers `503` unless `SCENARIO_AGENT_ENABLED=true`.
- `GET /api/runs/[runId]` - polls a run's status and result.
- DB schema - `supabase/migrations/202609180001_initial_schema.sql`. Ingestion
  writes `incidents` (on demand) and `events`. `plans`, `actions` and `results`
  are not written yet.

---

## 2. Two meanings of "async" (so nobody talks past each other)

- **Async _execution_** — the HTTP handler returns `202 { runId }` immediately
  and the workflow runs durably in the background. **We already have this** and
  Milestone A keeps it.
- **Async _architecture_ (topic / event-driven)** — producers publish events to
  a topic; multiple consumers (workflow **and** dashboard) react independently
  via fan-out. **We do not have this** — it is Milestone B.

Milestone A is "synchronous" in the sense that the **caller gets a complete,
per-event acknowledgement for the whole batch in a single round-trip** (accepted
/ duplicate / rejected + runIds), instead of firing one request per event and
polling each. Execution stays durable/async underneath.

---

## 3. Milestone A — synchronous multi-event ingestion

### 3.1 Endpoint contract

`POST /api/events` accepts **one event, a bare array, or `{ "events": [...] }`**.
Normalize all three to an array server-side.

Request:

```http
POST /api/events
Authorization: Bearer <CRISIS_API_TOKEN>
Content-Type: application/json

{ "events": [ { /* CrisisEvent */ }, { /* CrisisEvent */ } ] }
```

Response — default (durable async execution), HTTP `202`:

```jsonc
{
  "accepted": [{ "index": 0, "id": "…uuid…", "runId": "…" }],
  "duplicates": [{ "index": 1, "id": "…uuid…" }], // already ingested before
  "rejected": [{ "index": 2, "issues": [/* zod issues */] }],
}
```

Status codes:

- `202` — at least one event accepted (some may be duplicate/rejected).
- `400` — body unparseable, empty batch, or **every** item rejected.
- `413` — batch larger than `MAX_BATCH` (see 3.3).
- `401 / 503` — unchanged auth behavior from `src/lib/api-auth.ts`.

Optional **wait mode** (`POST /api/events?wait=1`) for the demo: await each
accepted run's `returnValue`, add a `result` field per accepted entry, return
`200`. Do not make this the default — long/failed runs would block the request.

### 3.2 Processing pipeline (per request)

```
1. authorize()                          → reuse src/lib/api-auth.ts unchanged
2. parse body → events[]                → accept single | array | { events: [] }
3. per-event validate (crisisEventSchema.safeParse)
                                        → split into valid[] and rejected[]
4. in-batch dedup by event.id           → drop later repeats of the same id
5. persist valid events (idempotent)    → upsert into public.events,
                                          ignore-on-conflict(id); the rows that
                                          were actually inserted are "new"
6. for each NEW event: start(crisisWorkflow, [event])  (concurrent)
7. build accepted[] / duplicates[] / rejected[] and respond
```

Steps 3 and 6 run **concurrently** across events; see 3.3.

### 3.3 Concurrency model ("many events at once")

- Validation is CPU-cheap — validate the whole batch with a plain `.map`.
- Starting runs is I/O — fan out with `Promise.allSettled` so **one failing
  `start` does not sink the others**. Each event becomes an independent
  `accepted` or `error` entry.
- Bound the blast radius with two constants (put them near the handler or in a
  small `src/lib/ingest.ts`):
  - `MAX_BATCH = 50` — reject larger batches with `413` (protects the handler
    and the DB from a pathological payload).
  - `MAX_CONCURRENT_STARTS = 10` — cap simultaneous `start()` calls. For a
    hackathon a tiny hand-rolled limiter is enough; don't add a dependency:

    ```ts
    async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>) {
      const out: R[] = new Array(items.length);
      let i = 0;
      const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
          const idx = i++;
          out[idx] = await fn(items[idx]);
        }
      });
      await Promise.all(workers);
      return out;
    }
    ```

- **Order is not guaranteed** across concurrent events. That is fine: each event
  carries its own `id`/`incidentId`; downstream keying is by id, not arrival
  order. Do **not** assume batch order equals processing order.

### 3.4 Idempotency & deduplication (must-have)

Duplicate events **must not** spawn duplicate workflow runs (see `PROJECT.md` →
"Implementation and verification": "Avoid duplicate external actions when
retrying or receiving repeated events").

- **Event-level (ingest):** the event's own `id` is the idempotency key.
  `public.events.id` is the primary key (`…initial_schema.sql:10`), so an
  idempotent insert gives free dedup:

  ```ts
  const { data: inserted } = await supabase
    .from("events")
    .upsert(validEvents, { onConflict: "id", ignoreDuplicates: true })
    .select("id"); // returns only rows that were actually inserted
  const insertedIds = new Set(inserted?.map((r) => r.id));
  // start a run ONLY for events whose id is in insertedIds; the rest are duplicates
  ```

  A retried POST with the same `id` inserts nothing → no second run.

- **Action-level (execution):** `public.actions.idempotency_key` is
  `not null unique` (`…initial_schema.sql:34`). When actions get persisted,
  derive a **stable** key (e.g. `` `${eventId}:${kind}:${index}` ``) so replaying
  a plan cannot enqueue the same external action twice.

- **Field to add:** none required for dedup — `id` already carries it. If callers
  cannot generate stable ids, add an optional `idempotencyKey` to
  `crisisEventSchema` and dedup on that instead. Prefer stable `id`s.

### 3.5 Persistence

`events` is the only table the input path must write for Milestone A (via the
`service_role` client `createServerSupabase()` — `src/lib/supabase/server.ts:4-9`).
`plans`, `actions`, `results` are written by the **workflow**, not the ingest
handler — out of scope here, tracked separately in `TASKS.md` (Fase 3).

Note the schema requires each event's `incident_id` to reference an existing
`public.incidents` row (`…initial_schema.sql:11`). For the demo, seed one
incident row (or insert `incidents` on-demand) before posting events, otherwise
the FK insert fails. Document the seed step in `README.md` when you wire this.

If Supabase env vars are unset, `createServerSupabase()` throws. Decide the
degraded behavior explicitly: either (a) return `503` from `/api/events` when DB
is unconfigured, or (b) skip persistence and still start runs (keeps the current
credential-free demo working). Recommended: **(b) with a logged warning**, so the
endpoint stays usable without Supabase, matching today's credential-free demo.

### 3.6 Validation & error handling

- Keep `.strict()` on `crisisEventSchema` — reject unknown fields loudly.
- **Never** let one bad event 500 the whole request. Every failure maps to a
  `rejected` (validation) or `error` (start/persist) entry with its `index`.
- On totally unparseable JSON → `400 { error: "Invalid body" }` (mirror the
  existing single-event 400 shape at `route.ts:10-11`).
- Do not mark an event `accepted` until its `start()` resolves with a `runId`
  (`PROJECT.md`: don't report success the result doesn't support).

### 3.7 Implementation notes

Implemented as designed, with these decisions:

- The body normalizer lives in `src/lib/ingest.ts` (`normalizeBatch`), not in
  `src/lib/domain.ts`; the single-event schema is unchanged.
- Status mapping (`ingestStatus`): `202` if any event is accepted, `400` if all
  are rejected, `500` if none is accepted and some failed to persist or start,
  `200` if all were duplicates. Wait mode answers `200` instead of `202`.
- If persistence fails, every event in the batch is an `error` and no run starts.
- Without Supabase, dedup falls back to an in-process set (lost on restart and
  not shared across serverless instances), with a one-time warning.
- With Supabase, the ingest upserts one `incidents` row per new `incidentId`
  (title `Incidente <id prefix>`), so no manual seed step is needed.
- Scenario signals have no severity: `signalToEvent` sends `medium` and leaves
  triage to the agent. Each scenario run uses a fresh `incidentId`, so rehearsals
  are not deduplicated away; resending a signal within a run is.

Tests cover the mixed-batch partition, in-batch and cross-request duplicates,
isolated `start()` failures, persistence failure and the all-rejected `400`.
The `413` and empty-body `400` checks live in `ingestBatch` and were verified
manually (3.8).

### 3.8 Manual verification

```bash
# a single event is still accepted
curl -sS -X POST localhost:3000/api/events \
  -H "Authorization: Bearer $CRISIS_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"…uuid…","incidentId":"…uuid…","summary":"Smoke plume N sector","severity":"high","source":"sensor"}'

# batch of events, processed concurrently
curl -sS -X POST localhost:3000/api/events \
  -H "Authorization: Bearer $CRISIS_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"events":[ {…}, {…}, {…} ]}'

# replay the same batch → expect all in "duplicates", zero new runs
```

---

## 4. Milestone B — async / topic evolution (deferred)

Milestone A has shipped; this is the next step. It is the "more interesting"
event-driven design and the piece that makes the **dashboard react live** to a
changing scenario (the CHALLENGE's core requirement). It is cheap because
Supabase Realtime does the fan-out — **no broker, no queue, no worker process.**

Pattern — **table-as-topic**:

```
Producer                 Topic (Supabase)          Consumers (live fan-out)
POST /api/events   →   INSERT public.events   →   ├─ dashboard  (subscribeToIncident → UI updates live)
                                                   └─ workflow   (writes plan/actions back → Realtime → dashboard)
```

Milestone A already does the producer half (insert into `events`). What B adds:

1. **Dashboard consumes the topic.** `subscribeToIncident()` already exists
   (`src/lib/supabase/browser.ts:15-28`) and `events` is already in the
   `supabase_realtime` publication (`…initial_schema.sql:60`). Wire it into
   `src/components/dashboard.tsx` (replace the in-browser `useState` sim at
   `:16-43`) and have the callback carry the changed row (the current helper
   takes an argument-less `onChange` — widen it to pass the payload).
2. **RLS read policy.** Realtime respects RLS. Today `events` is deny-all for
   `anon/authenticated` (`…initial_schema.sql:58`). Add a read policy scoped to
   the operator's incident **before** the browser can receive anything. This is
   gated on operator auth (deferred — see `TASKS.md` Fase 3).
3. **Workflow writes back.** Persist `plans` / `actions` / `results` from the
   workflow so state changes also fan out to the dashboard (the screen "moves
   on its own"). Separate task from ingestion.
4. **(Optional) True event-driven trigger.** If you want the workflow started by
   the DB insert rather than by the POST, add a consumer (DB trigger / edge
   function). **Not recommended for the demo** — a separate consumer process is
   one more thing to fail live. Keep the POST starting the workflow directly.

What stays out of scope even in B: real message broker / queue, background
workers, and workflow `waits`/timers for continuous replanning (`TASKS.md`
Fase 3).

---

## 5. Summary

| Concern     | Milestone A (implemented)                  | Milestone B (later)                        |
| ----------- | ------------------------------------------ | ------------------------------------------ |
| Intake      | `POST /api/events`, single **or batch**    | same producer                              |
| Concurrency | `Promise.allSettled` + `MAX_CONCURRENT`    | unchanged                                  |
| Execution   | durable async (`202 { runId }`)            | unchanged                                  |
| Dedup       | event `id` upsert + action idempotency key | unchanged                                  |
| Persistence | insert `events`                            | + `plans`/`actions`/`results` writeback    |
| Dashboard   | scenario panel posts, reads wait results   | Realtime fan-out via `subscribeToIncident` |
| New infra   | none                                       | RLS read policy + operator auth            |

A is real, testable and handles many events at once without new
infrastructure. B layers the live fan-out on top without changing the producer.
