# Finite resource contract v1

Current implementation: [global coordinator state v2](coordinator-state-contract.md) uses
one refreshed prompt, a dedicated worker, event/five-second triggers and individual
ambulance commitments. Apply the v2 migration and run npm run coordinator:work
alongside the app. Release is disabled; the v1 sections below are historical.

The backend persists **10 ambulances** shared by one active catastrophe run.
Only ambulance is supported; resources[] allows future catalog expansion.
Canonical validators: src/lib/contracts/resource-state.ts.
Complete FE fixture: [resource-state.example.json](resource-state.example.json).

## GET /api/state

Returns the snapshot directly as JSON, with Cache-Control: no-store. Read-only:
no allocation, release, scenario progression or model call occurs on GET.

| Field         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| schemaVersion | 1                                                                |
| stateId       | Inventory generation UUID; survives app restarts                 |
| runId         | Backend-owned active catastrophe UUID                            |
| revision      | Increments once per committed plan/allocation or release         |
| generatedAt   | Response timestamp                                               |
| updatedAt     | Last mutation timestamp                                          |
| storage       | supabase                                                         |
| executionMode | simulation                                                       |
| pollAfterMs   | 3000                                                             |
| resources     | Array containing ambulance total, available and allocated counts |
| allocations   | Active reservations with event/execution/plan IDs                |

Show **available / total**: 7/10 means seven free, three allocated. Quantities
count vehicles, not seats, patients or crews. Every counter satisfies
available + allocated = total; allocated counts match active reservations.
An allocation contains allocationId, eventId, executionId, planId,
resources: [{resourceType,quantity}], allocatedAt, expectedReleaseAt: null.

FE: fetch immediately, then every three seconds, with at most one request in
flight. Abort on unmount; ignore older revisions in the same stateId.
Pause polling while hidden and refresh on return. Retain the last snapshot marked
stale on errors; never display errors as zero or fabricate initial capacity.
Resource polling coexists with event SSE.

Pipeline auth applies: configured bearer tokens are always enforced; local dev
without a token is open; production without configuration returns 503. Never put
server tokens in NEXT_PUBLIC variables. Production FE needs an authenticated
server request path. Errors: {error,code}, 401 UNAUTHORIZED, 503 STATE_UNAVAILABLE.
Unsupported methods return 405.

## Persistence and setup

Apply supabase/migrations/202609190004_resource_inventory.sql once through the
normal migration process, or node scripts/apply-resource-migration.mjs --apply
with psql on PATH and .env.local database credentials. This creates two new tables
with RLS and no browser grants. Only the server service role invokes the RPC.
The migration seeds the backend capacity constant (10); changing the TypeScript
constant alone does not alter an existing database. No memory fallback is used.
Missing migration/credentials returns 503 rather than fictional availability.

For this small POC, resource_inventory is one JSONB snapshot and append-only
resource_operations stores commands, validated plans, messages, tool audit and
commit results. This deliberately serializes writes and is not a multi-run fleet
database. Snapshots and allocations survive process restarts.

## Agent execution and release

- POST /api/agent/plan: {request: AgentRequest, context: PlanningContext}.
  Use the active runId from state when constructing P1/P3 input. The backend
  supplies current finite inventory to P4, validates the completed plan, then
  atomically saves the plan/audit and reservation. Returns {planning,state,replayed}.
- POST /api/state/release: {operationId,allocationId,stateId,runId,expectedRevision}.
  Returns {state,replayed}. References an existing reservation; no caller quantity.
  Use a new operation UUID for release and preserve the entire body on retry.

All routes use pipeline authorization. Mutation validation errors return 400;
resource conflicts return 409 with {code,state}; provider/database failures 503.
The FE read contract does not require calling mutation endpoints.

P3 report + Jev + impact -> backend reads inventory -> P4 sees free ambulances
-> mock proposal -> validated final plan -> atomic database commit.
Enough capacity + same revision saves plan/audit, reserves and increments revision.
Stale state or shortage returns 409 + current state, without a partial reservation.
Explicit completion/cancellation releases an allocation for a later event to use.

The LLM cannot change totals, write counters, release another incident's resources,
or bypass capacity limits. It proposes ambulance counts and explains unmet demand.
Zero available permits an empty proposal and an action plan requesting assistance;
it does not lower P3 impact. HappyRobot communications and physical dispatch remain
mocked. Simulated inventory is consumed only after final validation.

Allocation uses executionId as its idempotency key. Reusing it with different input
is rejected. Successful retries return the saved plan and current state. A lost
commit response can safely be retried with the original input. Zero demand saves
the plan without an allocation. Resource revision is independent of
expectedRunRevision: P0 run/plan supersession concurrency remains separate work.

The RPC locks the inventory row only during commit, never during a model call.
Concurrent plans using one snapshot cannot both commit: the loser receives
STATE_CONFLICT. No automatic model retry, priority preemption or waiting queue is
enabled. Replan from refreshed state after a conflict. Existing allocations
survive new plans and failures. Release frees the whole reservation exactly once.
The release trigger is explicit completion/cancellation, not a timer or GET poll.
Automatic reassignment is deferred: it requires intervention status, travel time
and a policy governing when an existing commitment can be interrupted.

## Manual exercise (no tests, hooks or CI)

- npm run resources:try -- --dry-run: validate three synthetic finite inputs.
- npm run resources:try: real P4 calls with 10, 2 and 0 available ambulances for
  the same catastrophe. Existing allocations account for occupied units. Full
  inputs/plans/outputs: .data/resources-{10,2,0}-available.json. No DB writes.
- npm run resources:try -- --db: eight SQL scenarios against the installed RPC:
  reserve three, retry, changed-content rejection, stale revision, shortage,
  release/repeated release, reassign released units, exhausted inventory.
  All mutations roll back; existing reservations remain untouched. Requires three
  free ambulances. No LLM calls. Stale-revision coverage is not a simultaneous
  multi-connection concurrency test.

## Remaining integration

Existing /api/signals and /api/events do not yet call this P4 endpoint.
The old /api/situation still supplies the map's zones/plan/world and advances its
scaffold scenario. FE migration and removal of that route must ship together;
this backend change preserves that consumer. Neither the new state endpoint nor
the allocator advances the old scenario. Full FE/intake integration remains pending.

## Verification record (Windows, 2026-09-19)

- Live OpenCode P4, same campsite catastrophe: 10 available -> 2 proposed;
  2 available -> 2 proposed; 0 available -> no resources and unmet demand stated.
  All three retained critical priority and passed output-contract validation.
  These are observed nondeterministic model outputs, not fixed expected counts.
- PostgreSQL 18 local: migration applied; eight transactional SQL scenarios passed
  and rolled back. Separate concurrent service-role reservations of six units
  yielded one success, one STATE_CONFLICT, and four remaining ambulances.
- Remote Supabase migration applied through the authenticated SQL Editor in Orca,
  inside an explicit transaction. The final SELECT returned ten available
  ambulances, zero allocated, no reservations and revision 0.
- Independent HTTPS REST verification with the server credential returned 200
  and the same initial inventory. Direct PostgreSQL DNS/pooler TCP connectivity
  remained unavailable; using SQL Editor avoided that local connection problem.
- Full `npm run check` passed on Node 24: secret scan, formatting, lint, types,
  production build and Graft. Existing filesystem-tracing build warnings remain.
  No automated test suite or pre-commit checks were run.

### Post-migration manual rerun

Executed `npm run resources:try` with the configured OpenCode model on 2026-09-19.
All three cases passed their downstream contracts, with zero errors:

| Available ambulances | Proposed | Priority | Observed behavior                                                           |
| -------------------- | -------- | -------- | --------------------------------------------------------------------------- |
| 10                   | 10       | critical | Proposed all available vehicles for the threatened campsite                 |
| 2                    | 2        | critical | Explained unmet evacuation demand and requested additional capacity         |
| 0                    | 0        | critical | Produced a plan and verification needs without taking existing reservations |

These calls used synthetic inventory snapshots, not persistent reservations.
The first count differs from the earlier run (2), so respecting the capacity
constraint does not establish optimal or stable resource sizing.
Full plans and inputs are in `.data/resources-{10,2,0}-available.json`.

Executed the unchanged `scripts/try-resource-inventory.sql` in the authenticated
Supabase SQL Editor because local PostgreSQL TCP connectivity remained unavailable.
All eight cases passed: reserve three, identical retry, changed-command rejection,
stale revision rejection, insufficient capacity, release/repeated release,
reassignment after release, and exhaustion. The final SELECT after ROLLBACK
confirmed 10 available, zero allocated, no reservations and revision 0.
This verifies the live database RPC separately from P4; it is not an HTTP/intake
E2E execution of the LLM-to-persisted-plan path. No physical dispatch occurred.
