# Coordinator v2: frontend integration and input/output examples

Canonical contract: [global coordinator v2](coordinator-state-contract.md).
Full valid response: [coordinator-state.example.json](coordinator-state.example.json).
The numbers below are observed synthetic model scenarios, not fixed allocation rules.

## Run and read

Run `npm run dev` on Node 24. Intake endpoints schedule processing with Next.js
`after()`; do not start the old standalone worker. Migrations 004–008 are applied
to the shared development Supabase. Other databases need them in order.

Jev processes up to eight pending reports concurrently, independently of model
execution. The first accepted report starts a two-second grouping window. A single
coordinator call receives all accepted events in its claimed snapshot. Reports
accepted during that call retain their initial null priorities and trigger a later
plan; the first result cannot erase them. Polling never triggers processing.

This is an in-process POC, not a durable scheduler: after a restart, the next intake
resumes stored pending reports. Background work remains subject to hosting duration
limits. Model failures keep the previous plan and retry on a subsequent intake.

`GET /api/state` returns direct JSON with `schemaVersion: 2` and `pollAfterMs: 3000`.
Fetch immediately, then poll without overlapping requests. GET never runs the LLM.
Keep the last value marked stale on errors. Compare revisions only within a stateId.
`plan` and event priority/rationale can be null before the first successful update.
The complete ambulance list always has ten entries, including unavailable-to-new-work
units whose status is `assigned`. There is no resource release operation yet.

| UI element        | Response field                                             |
| ----------------- | ---------------------------------------------------------- |
| Situation text    | situationOverview                                          |
| Objective         | plan.objective, when plan is non-null                      |
| Ordered steps     | plan.steps[]                                               |
| Alert priority    | events[].priority and rationale                            |
| Available counter | ambulances.available / ambulances.total                    |
| Vehicle detail    | ambulances.units[].id, status, eventId                     |
| Freshness         | revision and updatedAt; generatedAt only identifies a read |

The dashboard now reads `/api/map` once, polls `/api/state` without overlapping
requests, and displays the overview, ordered plan, all ambulances and event priorities.
Errors retain the last state with a stale warning. GET requests never run the model.

`/api/telemetry` reads durable coordinator receipts and Jev results every second.
It replays the current run on connection/reconnection, sends `reset` before replay,
and publishes `filtering.completed` / `filtering.failed` using the original eventId.
The log folds these into one green/red/amber row. Reconnect uses full bounded replay
(up to 100 events), not the old in-memory cursor history. Database failures emit an
`unavailable` notification; the browser retains its last records while retrying.

The development **Reset & run events** button calls POST `/api/demo/reset` then
POST `/api/demo/events`. Reset uses migrations 006, 011 and 017;
it clears coordinator reports, resets the plan and thirty units, rotates stateId/runId,
and revokes the worker lease atomically. Audit history is retained. This affects the
shared database, not just one browser. Routes require development mode and same-origin
POSTs. The previous legacy `/api/demo/reset` situation-reset behavior is replaced.
Old demo sequences stop on runId mismatch. Next.js performs background processing after intake.

To install only the reset function (no reset is performed during installation), run
`node scripts/apply-resource-migration.mjs --apply --reset` with psql available and
SUPABASE_DIRECT_DB_URL or SUPABASE_POOLER_DB_URL configured locally. Add `--pooler
--session` when needed. Other existing migrations must already be installed.

State and telemetry reads accept same-origin browser requests in development;
otherwise existing pipeline Bearer authentication applies. Never put backend tokens
in browser code. Production operator authentication remains pending.

## Input: submit a report

POST `/api/coordinator/events` with Content-Type application/json. Replace the
synthetic runId with the active runId returned by GET `/api/state`. Preserve the
same report ID and content on retries. Structured P3 `factors` are optional;
missing gravity, population, vulnerability and time remain unknown.

```json
{
  "report": {
    "id": "10000000-0000-4000-8000-000000000004",
    "runId": "10000000-0000-4000-8000-000000000002",
    "source": "operator",
    "receivedAt": "2026-09-19T15:01:00Z",
    "text": "Flood traps 120 nursing-home residents; immediate evacuation needed.",
    "extracted": {}
  }
}
```

Receipt (202; 200 for an identical retry):

```json
{
  "eventId": "10000000-0000-4000-8000-000000000004",
  "duplicate": false,
  "storage": "supabase",
  "status": "awaiting_filtering"
}
```

This receipt is not a plan. Jev may filter the report. Relevant and uncertain
reports proceed to P3 and the global prompt. Existing POST `/api/events` is still
supported with its original input shape and SSE receipt; it now queues the same
durable coordinator. HappyRobot POST `/api/signals` is also connected.

## Observed input/output scenarios

Three independent scenarios from `npm run coordinator:try`:

| Initial state / input                                                       | Result                                                                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wildfire near residential area; ambulance-2 already assigned; timer tick    | Existing assignment retained, high priority, 9/10 available. Plan verifies exposure and access without consuming vehicles just because a timer fired.          |
| Same wildfire commitment plus new flood trapping 120 nursing-home residents | Flood becomes critical; nine free units proposed for flood; ambulance-2 remains on wildfire; 0/10 available. Global plan explains remaining evacuation demand. |
| Ten ambulances already committed to wildfire plus the new flood             | All ten commitments retained; flood remains critical and unserved. Plan seeks alternatives and verification; no vehicle is taken from wildfire.                |

The LLM returns a complete proposal. Only the backend validates and commits vehicle
assignments, counts, timestamps and revision. Invalid IDs, duplicate vehicle use,
release/transfer attempts or an invalidated worker lease cannot partially modify state.

```text
INPUT                         PROCESS                         OUTPUT TO FE
Report POST -> 202             Durable queue                   Existing state while pending
                              Jev -> P3 facts
                              Global prompt + current state
                              Validate + atomic commit        GET /api/state: newer revision
                                                              overview + plan + priorities
                                                              complete ambulance inventory

New accepted reports          Two-second grouping window       Updated state after model response
New event during LLM call     Queue for next assessment        Commit plan for processed events
Future resource-release input Not implemented                  Assigned vehicles stay assigned
```

The model sees a snapshot of accepted reports. Migration 008 records its event IDs
under the database lease and merges priorities only for that snapshot. Concurrent
filtering remains visible immediately; new events are included in the next plan.
Reset revokes the model lease and rejects late filtering results from previous runs.

## Verification and limits

Three live model scenarios passed. Eight SQL scenarios passed locally and in
Supabase inside rollback: idempotent intake, single-worker lease, atomic commit,
unchanged output, blocked release, invented vehicle, unsupported release operation
and stale-result rejection. HTTP state/auth and retired/disabled routes were also
checked. The complete live HTTP input -> Jev -> global LLM -> persisted plan path
has not yet been exercised as one E2E scenario. Resource-sizing quality is not
established by these contract checks. All dispatch remains simulated.

## Ambulance map controls

The top resource card shows total, assigned and available counts from `/api/state`.
Assigned units join SSE receipt coordinates by eventId; selecting a unit centers
and opens its map marker. Units at the same coordinates share an ambulance marker
with a count. These positions represent assigned reports, not live vehicle GPS.
Missing coordinates disable map navigation rather than inventing a position.

## Reset execution fencing (migration 017)

Reset now returns `{ runId, state }`. Existing clients reading only `runId` remain
compatible. The dashboard immediately applies `state`, invalidates earlier poll
responses and reconnects SSE; it then starts fixtures through the existing events
endpoint. Repeated starts use stable fixture IDs within a run.

Apply `202609190017_reset_execution_fence.sql` after 016 for cross-process stale
mission rejection and cancellation on reset. Local aborts stop model generation
and late scheduling callbacks. Migration installation itself does not reset the
demo. See [agentic review](agentic-review.md) for verification and recovery limits.
