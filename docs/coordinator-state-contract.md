# Global coordinator: state contract v2

Decision on 2026-09-19: use one coordinating LLM prompt for the active catastrophe,
rebuilding its context as events arrive and on a five-second backend tick. The
coordinator updates the situation overview, event priorities, a global plan and
individual ambulance assignments. Few events are assumed in this POC.

This contract is implemented by the global coordinator runtime. The historical
[resource state v1](resource-state-contract.md) is superseded after applying
supabase/migrations/202609190005_global_coordinator.sql. Its audit is preserved;
legacy allocation RPC access is revoked. Resource release is disabled in v2.

## One prompt, refreshed context

Keep one fixed system instruction template. Each invocation receives the latest
persisted state, accepted events for the active run, existing assignments, P2
relevance results and P3 impact calculations. Build this context from durable
records; do not make a growing conversation or the last model summary the only
source of truth. Report text and event responses are data, never instructions.

P2 still filters noise; uncertain events continue. P3's source-of-truth formula
remains evidence. The coordinator chooses and revises the final priority of each
active event using the global situation and resource availability. No subagents
or new dispatch tools are needed for this iteration. External tools come later.

The prompt should tell the model to:

1. Review all active events and existing commitments together.
2. Update a concise situation overview and ordered global plan.
3. Set each active event's priority and brief evidence-based rationale.
4. Propose assignments of known, available ambulance IDs to known active events.
5. State resource shortages in the plan; do not invent vehicles or completion.

Audit stores the input revision/event set, trigger, final output, validation result
and committed revision. Rationale is a concise decision explanation, not private
chain of thought.

## Triggers and execution

- `event.received`: request an update after an event passes existing validation
  and filtering. Duplicate delivery does not create a second event.
- `timer.tick`: backend checks every 5,000 ms and requests reconsideration when
  there are active events. This is independent of frontend polling or open tabs.
- `event.completed` / action responses: future triggers, explicitly TBD. They
  will update authoritative lifecycle facts before the next planning invocation.

Allow only one model call in flight per run. Merge pending triggers; never create
an unbounded queue of ticks. If a call lasts longer than five seconds, wait for it
and then process the latest context. Events received during a call mark its input
stale; discard the stale proposal and recalculate from the latest persisted state.
Do not let a slower result overwrite a newer event or assignment.

Five seconds is a scheduling interval, not a guarantee of a new plan every five
seconds: observed P4 calls have taken roughly 8-10 seconds. With no active events,
skip the model call. Identical validated output does not increment state revision.
On provider failure, retain the last committed state and record the failure for
the next update; never clear reservations or publish a fabricated empty plan.

## GET /api/state: v2 response

The endpoint remains read-only and returns direct JSON with `Cache-Control:
no-store`. Existing pipeline auth applies. FE polling remains every 3,000 ms;
the separate backend reconsideration interval is 5,000 ms.

The complete synthetic response is in
[coordinator-state.example.json](coordinator-state.example.json).

| Field                   | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| schemaVersion           | 2; incompatible with the aggregate-only v1 payload                             |
| stateId / runId         | Inventory generation and active catastrophe UUIDs                              |
| revision                | Backend-owned revision of the committed global state                           |
| updatedAt               | Last committed change; polling does not change it                              |
| generatedAt             | Response timestamp                                                             |
| storage / executionMode | supabase / simulation                                                          |
| pollAfterMs             | 3000                                                                           |
| situationOverview       | Current model-authored situation summary; not raw evidence                     |
| plan                    | null before the first valid plan; otherwise objective and ordered string steps |
| events                  | Event IDs, summaries, lifecycle status, final priority and rationale           |
| ambulances              | Object containing total, available, allocated and units[]                      |

`ambulances` is an object, not an array mixing counters and entries. Its `units`
array contains the complete fixed catalog: ambulance-1 through ambulance-10.
Each unit has `{id,status,eventId}`. Available units require eventId=null; assigned
units require a known active eventId. Initial priorities/rationales can be null
until the first successful coordinator decision. Initial situationOverview can
be empty and plan is null. Event status starts as active; completion is future work.

Backend derives counters from units: total=units.length,
available=count(status=available), allocated=count(status=assigned). All IDs are
unique. If one of ten ambulances is assigned, counts must be 10 / 9 / 1.
Other resource types remain deferred; a later version can generalize this catalog.

## Model output versus committed state

The model returns only a proposal:

```text
basedOnRevision
situationOverview
plan: {objective, steps[]}
priorities: [{eventId, priority, rationale}]
assignments: [{ambulanceId, eventId}]
```

Assignments describe the complete desired set of assigned units, including
existing commitments. Backend owns IDs, event lifecycle, totals, timestamps and
revision. Priority values remain low / medium / high / critical. Validate unique
known IDs, complete priority coverage, and no duplicate ambulance assignment.
Unknown events or vehicles reject the whole proposal, with no partial commit.

Existing assignments remain unchanged. No release operation is enabled in this version.
Omitting an existing assignment is not a release. The coordinator cannot mark an
event completed, silently transfer an ambulance, or free resources because its
plan changed. A future validated resource-release input will free specified units and trigger reconsideration of waiting active alerts.
Completion-response handling and preemption policy remain TBD.

Backend atomically validates the proposal against its input revision and persists
the new global state and audit. A successful update can change overview, priorities,
plan and assignments together. Scarcity changes the feasible response, not the P3
impact score. No physical dispatch or HappyRobot communication occurs in this mode.

## Running the POC

Use Node 24. Apply the v2 migration once after the v1 inventory migration. Run
npm run dev and, in another terminal, npm run coordinator:work. The worker is a
separate long-running backend process; it is not a browser timer or a serverless
background task. Production hosting needs this process supervised separately.
State and pending reports survive a worker restart; an abandoned lease expires
in 120 seconds. Model calls abort after 30 seconds. Do not start the continuous
worker during a transactional SQL smoke exercise.

The worker checks for pending events every second; the database permits a new
active-situation attempt after five seconds from the previous attempt's start.
Only one input is filtered per cycle, then pending inputs are drained before a
global plan is generated. No simultaneous LLM calls or unbounded timer queue.
A database lease excludes a second worker. New pending inputs or a changed
revision invalidate an in-flight proposal. The worker retries from fresh state.

- POST /api/coordinator/events accepts {report: NormalizedReport, factors?: ImpactFactors}.
  Read runId from GET /api/state. Client supplies a stable report UUID for retries.
  Persist first and return 202; identical retries return 200. Reusing an ID for
  changed content returns 409. The initial POC limits the run to 100 stored reports.
- POST /api/events keeps its existing input shape, queues durable normalized input
  and publishes the existing SSE receipt. It no longer executes the old scenario
  projection. Unprovided P3 factors remain unknown.
- POST /api/signals keeps its authenticated HappyRobot input/receipt; processed
  means durably handed to the coordinator, not LLM completion. Original signal
  payload remains persisted. The coordinator currently consumes its report summary.
- Jev irrelevant reports are stored as filtered and logged. Jev failures are stored
  as error and do not proceed. Automatic retry of failed filtering is deferred.
- POST /api/agent/plan returns 410: per-report mutation is retired.
- POST /api/state/release returns 501. The v2 RPC has no release operation.
- GET /api/situation remains the legacy scaffold endpoint until the frontend engineer
  migrates the dashboard. It is separate from durable coordination and is not its
  source of truth. GET /api/map supplies read-only illustrative geography.
- Frontend integration is deliberately excluded from this change. The frontend
  engineer should poll /api/state every three seconds and render its plan, priorities
  and assignments. The existing demo button still runs the standalone legacy filter;
  use POST /api/coordinator/events or POST /api/events to exercise the coordinator.

Supabase stores coordinator_runtime (snapshot and lease), coordinator_events
(immutable inputs and Jev/P3 evidence), and coordinator_audit (revision, state,
trigger, proposal and outcome). No memory fallback or external dispatch.

## On-demand validation

- npm run coordinator:try: three real model calls with synthetic state: existing
  commitment, a new critical event, and exhaustion. No database reservations.
  Full results: .data/coordinator-smoke-results.json.
- npm run coordinator:work -- --once: one real worker cycle using Supabase.
  With active or pending events this can commit simulated assignments. It exits
  after the bounded cycle and does not leave a continuous model loop running.
- scripts/try-coordinator.sql: eight checks inside ROLLBACK. Run through psql or
  Supabase SQL Editor while the worker is stopped. Requires one free ambulance
  and no pending inputs. Exercises deduplication, single-worker lease, atomic
  plan/allocation, unchanged output, rejected release, invented vehicles,
  unsupported release input and stale-result rejection.

Local PostgreSQL 18 verification preserved six existing v1 commitments during
migration and passed all eight checks. Three live model cases passed: the existing
commitment remained, nine free units could serve a new critical incident, and no
units were taken away from previous events under exhaustion. This demonstrates
contract/inventory invariants, not calibrated resource sizing.

## Future resource-release inputs

No release, completion, reassignment, external tools or HappyRobot dispatch is
implemented here. Later, an authenticated, idempotent input will identify which
committed vehicles became free. Backend will validate and free those units before
incrementing revision and requesting a global update. All active unserved alerts
remain visible in the prompt, allowing the next proposal to allocate the newly
available vehicles without an independent waiting queue for this small POC.

## Deployment verification (Windows, 2026-09-19)

V2 migration applied to Supabase through SQL Editor in an explicit transaction.
All eight SQL smoke cases also passed against Supabase and rolled back, preserving
10 available vehicles, no active alerts, and revision 0. The bounded real worker
returned IDLE without invoking a model. A temporary production HTTP server verified
state v2 (200), map (200), retired planner route (410), disabled release
(501), and missing-token rejection (401). The situation tombstone checked during development was reverted to preserve the
frontend engineer's existing scaffold. npm run check passed; existing scaffold
filesystem-tracing build warnings remain. Temporary servers were stopped.

The continuous worker is not left running by validation. Start coordinator:work
alongside the app to enable event processing and periodic planning. Live model
scenarios, database scenarios and HTTP reads were verified separately; a live
report-to-model-to-persisted-plan HTTP E2E demo remains an on-demand next exercise.

Frontend handoff: [input/output examples and integration](coordinator-frontend-integration.md).

Migration filenames were renumbered to 202609190004/202609190005 when integrating
main to avoid colliding with the signals reconciliation migration. Their SQL was
already applied manually to the shared development database; do not reapply it.

## Live intake scheduling update (migration 007)

The worker filters up to eight reports concurrently per cycle and plans without
waiting for an empty queue. Enqueue-only revision changes do not invalidate a plan:
the exclusive worker lease prevents another worker from changing active events or
assignments during generation. Commit still requires full active-event coverage and
preserves assignments; reset revokes the lease. This supersedes the earlier rule
that every arrival invalidates an in-flight proposal. New pending reports are
assessed in the next cycle, after the current model call completes.

## In-process POC execution (migration 008)

HTTP intake schedules filtering and planning with Next.js after(). No standalone
worker is required. Filtering uses a separate run-checked, idempotent RPC and can
continue during model generation. Claim records the model's active event IDs;
commit requires exact priority coverage of those IDs and preserves newer active
events with their existing priorities. The next call incorporates those events.
This supersedes the exclusive filtering/planning behavior above. Reset still
revokes the model lease. Restart recovery needs another intake request; there is
no durable scheduling guarantee or timer-only replanning in this local POC.

## Patrols and missions (migrations 011–012)

State v2 adds police and civilGuard inventories, each with total=10, available,
allocated and ten units. IDs are police-1..10 and civil-guard-1..10. Existing
ambulance fields remain unchanged. Consumers must upgrade to accept these fields;
apply migration 011 with this code release. Reset restores all thirty units.

Proposals require policeAssignments and civilGuardAssignments arrays with unitId
and eventId. Mission changes contain action (create/update/cancel), missionId and
expectedRevision (null on create), eventIds, objective and instructions. Existing
ambulance assignments still use ambulanceId. Validation forbids unknown IDs,
duplicates, release and reassignment across all inventories. Allocation is simulated.
Mission handoff happens after commit and validates reserved resources; failed handoff
does not roll back the global plan. Migration 013 permits multiple missions per event,
multiple events per mission, revisions and cancellation. Omitted missions are unchanged.
Updating an open mission queues a new activation; completed/cancelled missions remain
terminal. Old execution leases cannot commit after an update or cancellation.
No-op communication tools acknowledge requests without external actions.
Persisted execution results schedule a new coordinator cycle (mission.result).
The current process keeps running until planning and mission activations settle;
restart recovery and real HappyRobot callbacks remain deferred.

All model-generated human text is requested in Spanish (Spain); IDs, enum values
and JSON field names retain their technical spelling. Existing stored English text
is not translated until a new model decision replaces it.

## Communication completion does not release resources (migration 015)

Migration 015 supersedes the automatic release introduced in 014. Mission
completion preserves all resource assignments and counters. Subagents coordinate
communications; they cannot infer when a patrol or ambulance finishes field work.
Explicit operational release remains deferred. Prior releases are not reversed.
