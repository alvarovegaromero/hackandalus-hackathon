# Person B: subagents, communication tools and execution results

This module implements Person B from the agreed split. Person A owns the parent
agent, its spawn/create-mission tool, global priorities, plan and resource reservations.
Person B receives an immutable reserved mission, runs its communication tools and
persists status, activity and a parent-readable result. No frontend files are changed.

## Handoff to Person A

Call `submitReservedMission(input)` from `src/lib/subagents/repository.ts` after
committing the parent's resource assignments. This is a server-only enqueue adapter,
not an LLM tool and not a resource allocator. Wrap it in the parent's spawn tool.
Use the same missionId and identical input on retries. There is one mission per
runId/eventId, including completed missions. Changed content or a new mission ID for
the same incident returns MISSION_CONFLICT. Revision is 1 in this first contract;
instruction updates and reopening terminal missions need a future versioned input.

```json
{
  "missionId": "20000000-0000-4000-8000-000000000001",
  "runId": "10000000-0000-4000-8000-000000000002",
  "eventId": "10000000-0000-4000-8000-000000000003",
  "revision": 1,
  "objective": "Coordinate medical assistance for the threatened residential area",
  "instructions": "Confirm safe access and medical assistance needs through simulated contacts",
  "context": {
    "incidentSummary": "Wildfire near a residential area",
    "priority": "high"
  },
  "assignedResourceIds": ["ambulance-2"],
  "allowedTools": ["contactService", "getContactResult"]
}
```

IDs must reference the current coordinator run and an active incident. Each supplied
ambulance must already be assigned to that incident. Empty resource lists are allowed
for information-gathering missions. Allowed tools are selected by trusted backend
policy, never copied from untrusted event text or granted by the child agent.

Successful enqueue returns `{missionId, duplicate, storage: "supabase"}`. It means
accepted, not executed. The parent must make its reservation/mission creation durable
and retry this handoff after interruptions (an outbox is suitable). The adapter cannot
make a previous separate reservation transaction atomic. Alternatively Person A can
call the SQL submit operation inside its own reservation transaction. The execution
module takes a shared inventory lock to verify reservations and never updates it.

## Worker and tools

Apply `supabase/migrations/202609190009_subagent_execution.sql` after coordinator
migration 005; 006 is not required. The new migration is only verified locally and
has not been applied to shared Supabase. Run Node 24:

```text
npm run subagents:work
npm run subagents:work -- --once
```

The worker uses the existing configured AI SDK model/provider. It processes one
mission at a time per process; multiple workers use SKIP LOCKED and per-mission
120-second leases. Each model invocation has a 45-second timeout and five-step
limit, with the final step restricted to producing the structured result.

Tools available to a subagent:

| Tool             | Input            | Behavior                                                                                        |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| contactService   | service, message | Persist one mock contact per mission/service; return pending operation                          |
| getContactResult | operationId      | Mock acknowledges that mission's operation on first query; later queries return the same result |

Services are medical_coordination and emergency_coordination. Provider is always
happyrobot_mock and realActionsExecuted is always false. No telephone number, external
URL or API key is model-controlled. No HappyRobot credentials are read by these tools.
They do not contact actual emergency services. Rewording a repeated contact does not
create another operation: the original message/result is retained.

The supported lifecycle is queued -> running -> waiting / blocked / completed / failed.
Waiting is persisted and retried after ten seconds, not an open LLM call. Restarted
workers recover expired leases and receive existing operations. There are at most
three attempts across waiting/recovery. Exhaustion becomes failed with a parent-visible
result. Model/configuration/validation errors also become failed; there is no silent
provider fallback. Blocked, failed and completed missions are terminal in this version.

Completed requires at least one acknowledged mock contact, no pending operations and
no outstanding resource request. This is a communication-task outcome, not proof of
evacuation, dispatch or service arrival. Completing or failing never frees ambulances.

## Result contract

The model chooses status, summary and optional resourceRequest. Backend supplies IDs,
operation references, simulation flags and needsParentDecision. Results persist in
subagent_missions.result and as activity; Person A consumes updates by updateId and
revises its global plan. No parent invocation or existing SSE schema is changed here.

```json
{
  "updateId": "20000000-0000-4000-8000-000000000002",
  "missionId": "20000000-0000-4000-8000-000000000001",
  "missionRevision": 1,
  "status": "blocked",
  "summary": "Simulation: additional capacity requires a parent decision",
  "resourceRequest": {
    "type": "ambulance",
    "additionalQuantity": 2,
    "reason": "Additional assistance required by the mission"
  },
  "needsParentDecision": true,
  "externalOperationIds": [],
  "executionMode": "simulation",
  "realActionsExecuted": false
}
```

resourceRequest is null when absent. Operation IDs reference persisted mock operations,
not external provider IDs. No private chain of thought is saved or returned.

## Read API for parent and frontend

- GET /api/subagents: up to 100 missions, oldest first; no execution is triggered.
- GET /api/subagents/:missionId: one mission plus its latest 100 activity entries in
  chronological order. Unknown ID returns 404; invalid UUID returns 400.
- Both return `{schemaVersion: 1, executionMode: "simulation", pollAfterMs: 3000,
missions: [...], activity: [...]}` with no-store. The list has empty activity.
- Mission rows expose mission_id, input, status, attempts, result, operations,
  created_at and updated_at. Lease tokens are never exposed. Activity rows contain
  id, mission_id, type, payload and created_at. No SSE bridge is implemented.
- Existing pipeline Bearer authentication applies; production must not expose the
  server token in browser code. Operator authentication remains owned by integration.
- /api/state and frontend components remain unchanged. FE may render cards from
  this additive API when its engineer integrates it.

## Manual validation

`scripts/try-subagents.sql` runs eight scenarios inside a rollback. It requires an
empty subagent queue, an existing active incident and stopped workers. It checks
pre-reserved resources, mission deduplication, lease exclusion, contact idempotency,
completion evidence, waiting/resume, unchanged inventory and persisted activity.
All eight passed on local PostgreSQL 18. No automated tests were added or run.
Shared Supabase deployment, parent handoff/replanning and
frontend integration remain unverified/unconnected. Real HappyRobot calls and
incoming callbacks require a separate adapter; do not enable them by setting a key.

## Live model tool-selection script

Run npm run subagents:try (or append -- --limit 1 through 5). This is on-demand,
not part of check/CI. It uses the configured real LLM, the same executeMissionAgent
and createMissionTools as the worker, and an isolated in-memory persistence adapter.
It neither writes to Supabase nor performs real communications. The SQL harness
above independently covers durable storage; this is not a full production E2E.

Five live cases passed on Windows with Node 24:

| Mission                            | Required tool sequence                                   | Observed result                               |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Medical coordination               | contactService(medical_coordination), getContactResult   | completed                                     |
| Emergency coordination             | contactService(emergency_coordination), getContactResult | completed                                     |
| Resume pending contact             | getContactResult only                                    | completed, no repeat contact                  |
| No permitted tools                 | none                                                     | blocked                                       |
| Need two ambulances, none assigned | none                                                     | blocked, resourceRequest.additionalQuantity=2 |

The script checks exact tool sequence, service selection, result status, resource
request and unchanged assigned resource IDs. It exits nonzero on a failure and
writes per-case input, tool arguments, operation results and decisions to
.data/subagent-tool-results.json. Provider errors are redacted. No private chain
of thought is exported. A passing run is evidence for these scenarios, not a
guarantee of future model behavior; runtime and database validation remain mandatory.

Parent plan updates are available as a separate integration module: [updateGlobalPlan](parent-plan-tool.md).

## Inline dashboard integration

The parent now proposes missions alongside the global plan. After a successful
commit, missions are submitted with their reserved ambulance/patrol IDs and executed
in Next.js, three at a time. Parent context includes current-run mission results.
Dashboard mission polling is read-only and scoped to the active run.

New missions allow contactService and getContactResult. contactService persists an
idempotent operation and uses src/lib/subagents/communication.ts to acknowledge it
immediately: this is a no-op, with no external communications. Completion means the
request was acknowledged, never that field conditions were verified. The dashboard
labels this execution mode. Existing missions retain their original permissions;
use Reset & run events for new missions. Model-readable output is Spanish.

The communication adapter is the replacement boundary for HappyRobot execution.
A real asynchronous integration will also need callback handling and an updated
persistence contract (the current provider and completion metadata are mock-only).
The historical tool-selection harness above expects a separate result lookup;
its exact-sequence expectations predate immediate no-op acknowledgement.
Migration 012 validates patrol reservations and excludes previous-run missions
from claims. Reset hides old missions through run identity; history is retained.

## Evolving missions (migration 013)

Mission inputs retain eventId as the primary event for older consumers and add
optional eventIds (new missions always supply it). revision/missionRevision are
positive integers. The parent emits explicit create/update/cancel changes;
omission means keep. Terminal completed/cancelled missions cannot be updated.
Cancellation adds the cancelled status and invalidates any active lease. Updates
archive the previous input/result in activity, queue the same mission ID with a
new revision, and invalidate the previous activation. No-op operation history
remains in activity; new revisions start with no current operations.

Mission result writes trigger parent planning, even without new reports. Agents
run only for queued work and exit after returning a result. Waiting missions are
not polled by an LLM; a future real callback adapter must explicitly resume them.
No external callback integration or durable recovery scheduler is introduced.
Dashboard polling includes cancelled and displays mission revision. Existing
stored missions remain readable; Reset & run events starts with the new prompts.

## Resources remain assigned after communication (migration 015)

Migration 015 supersedes automatic release from migration 014. Completing a
subagent mission ends its communication task only. Ambulances and patrols remain
assigned, with unchanged counters and map associations. Cancellation also does
not release resources. A future explicit operational confirmation must identify
when field work is finished; successful calls are not that confirmation.
Previously released resources are not automatically reconstructed. Reset and run
the demo to start a clean scenario with this behavior.

Parent handoff handles stale update/cancel and reservation conflicts per mission:
remaining changes are still submitted, then a mission.conflict cycle reloads the
current state and mission results. A completed mission is never reopened by an
outdated parent decision. Other handoff errors are logged per change.
