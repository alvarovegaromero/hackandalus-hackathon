# Event ingestion — how signals enter FARO

How external input enters the FARO command center: the **ingest** path that turns
calls, SMS, sensors, HappyRobot callbacks and scenario beats into `signals`,
deduplicates them, and hands them to triage and incident merging. Written so a
teammate can build it.

**Sources of truth (read first):**

- `thoughts/data-model.md` — authoritative schema (`runs`, `signals`,
  `incidents`, `webhook_deliveries`, `actions`, …) and the Zod contracts. This
  guide sits on top of it and does **not** redefine tables; if the two disagree,
  the data model wins.
- `thoughts/open-questions.md` — the ingestion-related decisions still open
  (schema split, dedupe details, how call results arrive). Flagged in §7.
- `PROJECT.md` (conventions, self-updating-docs rule) and `CHALLENGE.md`.

**Scope.** Milestone A is a **synchronous** ingest endpoint that accepts **many
signals in one request** and processes them **concurrently**. Milestone B is the
**Realtime** fan-out to the dashboard (§5). Both are on the confirmed stack
(Supabase Postgres + Realtime) — no broker, no queue, no worker process.

> **Current code vs target.** The migrated scaffolding still uses the old names
> (`events` table, `crisisEventSchema`, `incidents` as the crisis container, and
> `POST /api/events`). The confirmed model renames them: input rows are
> **`signals`**, the crisis container is **`runs`**, `incidents` becomes
> **sub-incidents**, `events` is reserved for the append-only `domain_events`
> log, and the ingest contract is **`incomingSignalSchema`**. This guide targets
> the confirmed model; building it depends on the schema landing (open-questions
> phase 1 · Contracts). A mapping table is in §8.

---

## 1. Where ingestion sits (the pipeline)

- **Milestone A (implemented):** a **synchronous** ingestion endpoint that
  accepts **many events in one request** and processes them **concurrently**.
- **Milestone B (documented, deferred):** the **async / topic** evolution
  (Supabase Realtime fan-out to the dashboard). Section at the end. Do not
  implement B until A is merged and demoable.
  Ingestion is one stage, not the whole loop. Per the module map in
  `data-model.md` §3, three different modules touch a new signal in sequence:

```
producer ──▶ [ingest] ──▶ [triage] ──▶ [incidents] ──▶ planning ──▶ execution
             writes         scores       merges into
             signals,       p_*,         one incident
             webhook_       decision      (signals.incident_id)
             deliveries
```

- **ingest** — validate, deduplicate, persist the `signals` row, append a
  `domain_events` record of type `signal.received`. It does **not** score or
  assign an incident.
- **triage** — sets `p_relevant / p_truthful / urgency / fused_confidence` and
  `triage_decision` (act / verify / discard).
- **incidents** — fuses coherent signals into a single `incident` and sets
  `signals.incident_id`.

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
  Everything hangs off a `run` (one per managed crisis; multi-tenant by `run_id`).
  A signal always carries the `runId` it belongs to.

---

## 2. "One problem, not many" — the four layers

The user-visible goal is that one real-world problem shows up as **one** thing,
not N. The confirmed model already provides four distinct layers; they use
different keys and must not be conflated.

| Layer                               | Question                                      | Mechanism (data-model.md)                                                                                                                                                              | Where            |
| ----------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1. Same **message**                 | "Did I already receive this exact report?"    | `dedupe_key` + `occurrences` + time window; a repeat increments `occurrences` instead of inserting, and `merged_into_id` points a late duplicate at the original (§5.6, principle 2.5) | ingest           |
| 2. Same **problem**                 | "Is this the same real-world incident?"       | `incidents` groups coherent signals; `signals.incident_id` — "a signal belongs to at most one incident" (§5.7)                                                                         | incidents        |
| 3. Inbound **callback** re-delivery | "Did HappyRobot already deliver this result?" | `webhook_deliveries` unique `(provider, delivery_id)`, or `body_sha256` when there is no id (§5.11)                                                                                    | ingest/execution |
| 4. Outbound **action** retry        | "Did I already fire this external action?"    | `actions.idempotency_key = "<action_id>:<attempt>"` — adapter retry reuses the key, operator retry gets a new one (principle 2.5)                                                      | execution        |

**Deduplication (layer 1) answers "same message"; correlation (layer 2) answers
"same problem".** They are different keys. Dedup alone would still let two
distinct reports of one fire become two problems — it is the `incidents` module
grouping signals that keeps one problem as one.

**Triage keys off the incident, not the raw signal.** Prioritization and
resource allocation operate on the incident's consolidated state (its `gravity`,
`people_exposed`, `minutes_to_impact`, `fused_confidence` — the G·N·V·t·C of the
priority formula), not on each signal in isolation. So three reports about the
Los Pinares front feed one incident whose priority rises, not three competing
items.

---

## 3. Milestone A — synchronous, batched, concurrent ingest

### 3.1 Endpoint contract

`POST /api/signals` accepts **one signal, a bare array, or `{ "signals": [...] }`**
(normalize to an array). Body items follow `incomingSignalSchema`
(`data-model.md` §6): `runId`, `source`, `title`, `body`, `category`, `severity`,
optional `channel`, `externalRef`, `areaSlug`, `reportedConfidence`, `location`,
`occurredAt`, `raw`. Note what the caller does **not** send: no `id` (generated),
no `dedupe_key` (computed by ingest), no `incidentId` (assigned later by the
incidents module).

Response — HTTP `202` (durable async execution):

```jsonc
{
  "accepted": [{ "index": 0, "id": "…signal-uuid…" }], // new signal row
  "merged": [{ "index": 1, "id": "…original-uuid…", "occurrences": 2 }], // dedup layer 1
  "rejected": [{ "index": 2, "issues": [/* zod issues */] }]
}
```

Status codes: `202` if ≥1 accepted or merged; `400` if the body is unparseable,
empty, or every item is rejected; `413` over `MAX_BATCH`; `401 / 503` for auth
(reuse `authorize` from `src/lib/api-auth.ts`). Optional `?wait=1` awaits triage
for the demo and returns `200` with each signal's decision — never the default.

### 3.2 Pipeline (per request)

```
1. authorize()
2. parse body → signals[]                (single | array | { signals: [] })
3. per-item validate incomingSignalSchema → valid[] + rejected[]
4. for each valid signal (concurrently, bounded):
     a. compute dedupe_key (§3.4)
     b. within the run's dedup window for that key?
          YES → UPDATE occurrences = occurrences + 1  → "merged"
          NO  → INSERT signals row                     → "accepted"
     c. append domain_events(type = "signal.received")
     d. enqueue triage for accepted (new) signals only
5. respond { accepted, merged, rejected }
```

Only **accepted** (genuinely new) signals continue to triage. **Merged** repeats
do not re-trigger triage or spawn work — that is layer 1 doing its job.

### 3.3 Concurrency ("many at once")

- Validate the whole batch with a plain `.map` (cheap).
- Fan out the persist/triage-enqueue with `Promise.allSettled` so **one failing
  item does not sink the others**; each becomes its own `accepted` / `merged` /
  `rejected` / `error` entry.
- Bound it: `MAX_BATCH` (e.g. 50 → `413` beyond) and `MAX_CONCURRENT` (e.g. 10)
  with a tiny hand-rolled limiter — no dependency. Order is not guaranteed;
  downstream keys by id/dedupe_key, not arrival order.

### 3.4 dedupe_key derivation (decision — see §7)

`dedupe_key` is computed server-side and stored not-null (`signals_dedupe_idx`
is `(run_id, dedupe_key, received_at desc)`). Proposed rules:

- **Has `externalRef`** (HappyRobot call id, SMS/message id) → `"{source}:{externalRef}"`.
  Exact, cheap, correct for machine sources.
- **No external ref** (a neighbor's free report) → a natural key such as
  `"{source}:{category}:{areaSlug}"`, deduped only **within a time window** so
  that a genuinely new report an hour later is not swallowed.

The **window length** and whether the increment must be atomic (a DB function /
partial unique index vs read-then-update) are open — flag, don't guess. Within a
single batch, dedupe in memory first so two identical items in one request
collapse before hitting the DB.

### 3.5 Persistence & degraded mode

Ingest writes `signals` (and, for inbound callbacks, `webhook_deliveries`) via
the service-role client (`src/lib/supabase/server.ts`), which bypasses RLS.
If Supabase is unconfigured, `createServerSupabase()` throws — decide explicitly:
return `503`, or (recommended for the credential-free demo) skip persistence,
run triage in-memory, and log a warning. Every signal needs an existing `run`
(and, if `areaSlug` is given, a matching `area`); seed the run/areas first (the
demo seeds `wildfire-sierra-bermeja`).

### 3.6 Validation & errors

- Keep `.strict()` on `incomingSignalSchema`; reject unknown fields loudly.
- Never let one bad item 500 the request — map failures to `rejected` (validation)
  or `error` (persist) with the item `index`.
- Do not report a signal `accepted` until its insert resolves (`PROJECT.md`:
  don't claim success the result doesn't support).

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

### 3.7 Implementation checklist

- [ ] `src/lib/domain/signal.ts` — `incomingSignalSchema` + a batch helper
      (single | array | `{ signals }` → `IncomingSignal[]`).
- [ ] `src/lib/ingest.ts` _(new)_ — pure: normalize → validate → dedupe(compute
      key, window) → persist → `{ accepted, merged, rejected }`. Framework-free,
      unit-testable.
- [ ] `src/app/api/signals/route.ts` — thin controller: `authorize` → body →
      ingest → response + status.
- [ ] `README.md` — batch contract, run/area seed step, degraded mode.
- [ ] `TASKS.md` — check off Fase 3 "persistir y deduplicar eventos".

Tests (Vitest — decisions & failure paths):

- [ ] mixed batch → correct `accepted` / `merged` / `rejected` split.
- [ ] same `dedupe_key` twice in one batch → one accepted, one merged.
- [ ] repeat within window across two requests → `occurrences` increments, **no
      new triage** (mock the dedup lookup to hit).
- [ ] repeat outside the window → new accepted signal.
- [ ] one persist rejects → that item `error`, others still succeed.
- [ ] batch > `MAX_BATCH` → `413`; empty / all-invalid → `400`.

---

## 4. Triage & incident handoff (brief)

Milestone A has shipped; this is the next step. It is the "more interesting"
event-driven design and the piece that makes the **dashboard react live** to a
changing scenario (the CHALLENGE's core requirement). It is cheap because
Supabase Realtime does the fan-out — **no broker, no queue, no worker process.**
Ingest returns fast; the rest is separate modules (out of scope here, tracked in
`TASKS.md` Fase 3):

- **triage** scores the new signal and sets act / verify / discard. A discarded
  signal is excluded, not deleted (`data-model.md` 2.2).
- **incidents** merges the signal into an existing incident or opens a new one —
  this is layer 2, "one problem = one incident".
- **planning** re-plans: plans are versioned, `one current per run`; a re-plan
  supersedes the previous. The demo-friendly shortcut for "the same problem
  changed" is **supersede** (mark the old plan `superseded`), not a long-running
  workflow that waits — workflow `waits` are later (Fase 3).

---

## 5. Milestone B — Realtime fan-out (target)

Confirmed stack includes Supabase Realtime, so the dashboard reacts live instead
of polling. Publish `signals`, `incidents`, and `plans` changes; the operator
panel subscribes per `run`/`incident` (the `subscribeToIncident` helper in
`src/lib/supabase/browser.ts` is the seed of this — widen it to carry the row and
key it by `run_id`). Realtime respects RLS, so a read policy scoped to the
operator (deny-by-default today) must land first — gated on operator auth
(open-questions "Real time to the panel"). No broker/queue/worker; ingest is
unchanged — Realtime only adds consumers on top of the same writes.

---

## 6. Demo script (FARO · Sierra Bermeja)

Seed a `run` (`scenario_id = wildfire-sierra-bermeja`) with its areas
(Estepona, Jubrique, Genalguacil, Benahavís, Los Pinares) and vulnerable sites
(care home 45, rural school, campsite 120). Then drive the confirmed beats and
show each layer:

| #   | Input                                                                | Expected                                                                           | Shows                                     |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Signal: smoke on the Los Pinares north front (`sensor`, `high`)      | New signal → new incident, priority set                                            | Normal intake + layer 2 (incident opened) |
| 2   | The **same** report again (neighbor call, same `externalRef`/window) | `occurrences` → 2, **no** new incident, no new triage                              | **Layer 1** (same message)                |
| 3   | A second, distinct report on the same front (different signal)       | Merged into the **same** incident; priority rises                                  | **Layer 2** (same problem, not a new one) |
| 4   | Chaos beat **wind shift** (`world_change`)                           | Assumption `wind.direction = …` breaks → **re-plan** (new current plan supersedes) | Changing scenario → replan                |
| 5   | Chaos beat **A-397 cut**                                             | Assumption `roads.A-397 = open` breaks → route/assignment changes                  | Assumption invalidation                   |
| 6   | Chaos beat **SMS channel down**                                      | Channel fallback SMS → WhatsApp/voice                                              | Execution resilience                      |
| 7   | HappyRobot call result **re-delivered** (same `delivery_id`)         | `webhook_deliveries` dedup → moves nothing                                         | **Layer 3** (callback idempotency)        |
| 8   | Retry an outbound `notify` action                                    | Sent **once** (same `idempotency_key`)                                             | **Layer 4** (action idempotency)          |

Steps 1–3 as one batch also demonstrate §3 concurrency and the
`accepted` / `merged` partition.

---

## 7. Open decisions (see `thoughts/open-questions.md`)

Do not invent these; they gate the build:

- **Schema split** ground-truth vs perceived state, and adding `infrastructure` /
  `intelligence_tasks` (phase 1 · Contracts). The ingest target tables depend on
  it.
- **`dedupe_key` derivation and window length**, and whether the `occurrences`
  increment is atomic (DB function / partial index) — not yet specified.
- **How HappyRobot call results arrive** (webhook vs executions API vs both) —
  shapes `webhook_deliveries` use and the workflow wait step.
- **Triage outcomes**: three (act/verify/discard) vs the proposed five — widens
  the enum and the triage step, downstream of ingest.

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

## 8. Current-code → target mapping

| Scaffolding (in code today)                   | Confirmed target (`data-model.md`)                            |
| --------------------------------------------- | ------------------------------------------------------------- |
| `events` table                                | `signals`                                                     |
| `incidents` (crisis container)                | `runs`                                                        |
| —                                             | `incidents` (sub-incidents)                                   |
| `events` (name)                               | reserved for `domain_events` (append-only log)                |
| `crisisEventSchema` (`id/incidentId/summary`) | `incomingSignalSchema` (`runId/source/title/body/category/…`) |
| dedup by `event.id` (PK)                      | `dedupe_key` + `occurrences` + window                         |
| `POST /api/events`                            | `POST /api/signals`                                           |
| `actions.idempotency_key`                     | unchanged, `"<action_id>:<attempt>"`                          |

Ship A first (real, testable, backwards-compatible with the durable `202`
execution); B adds live fan-out without touching the producer.
