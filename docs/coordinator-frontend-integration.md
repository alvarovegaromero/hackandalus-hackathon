# Coordinator v2: frontend integration and input/output examples

Canonical contract: [global coordinator v2](coordinator-state-contract.md).
Full valid response: [coordinator-state.example.json](coordinator-state.example.json).
The numbers below are observed synthetic model scenarios, not fixed allocation rules.

## Run and read

Run `npm run dev` and `npm run coordinator:work` in separate terminals on Node 24.
The v1 and v2 migrations are already applied to the shared development Supabase.
Other databases need both resource migrations in order. Do not reapply them blindly.

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

Event SSE at `/api/telemetry` remains a separate intake receipt stream, not a stream
of global plans. Coordinator-state polling is authoritative for allocations and
priorities. `/api/map` supplies illustrative geography without advancing a scenario.
The old `/api/situation` and per-report `/api/agent/plan` return 410.

Authorization follows the existing pipeline policy: local development without a
configured token is open; otherwise the backend requires Bearer authentication.
Never embed CRISIS_API_TOKEN in browser code or NEXT_PUBLIC variables. Production
FE requires an operator-authenticated server request path; that auth integration
is not implemented by this POC. A 401/503 is not an empty inventory.

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
release/transfer attempts or a stale input revision cannot partially modify state.

```text
INPUT                         PROCESS                         OUTPUT TO FE
Report POST -> 202             Durable queue                   Existing state while pending
                              Jev -> P3 facts
                              Global prompt + current state
                              Validate + atomic commit        GET /api/state: newer revision
                                                              overview + plan + priorities
                                                              complete ambulance inventory

5-second backend tick         Reconsider active events         Updated state only if changed
New event during LLM call     Reject obsolete proposal         Preserve prior valid assignments
Future resource-release input Not implemented                  Assigned vehicles stay assigned
```

Five seconds is the scheduling interval, not a response-time guarantee. One model
call runs at a time. Calls may exceed five seconds; pending inputs are coalesced
and a stale response is discarded before committing. The worker must be running;
opening the FE alone does not start it.

## Verification and limits

Three live model scenarios passed. Eight SQL scenarios passed locally and in
Supabase inside rollback: idempotent intake, single-worker lease, atomic commit,
unchanged output, blocked release, invented vehicle, unsupported release operation
and stale-result rejection. HTTP state/auth and retired/disabled routes were also
checked. The complete live HTTP input -> Jev -> global LLM -> persisted plan path
has not yet been exercised as one E2E scenario. Resource-sizing quality is not
established by these contract checks. All dispatch remains simulated.
