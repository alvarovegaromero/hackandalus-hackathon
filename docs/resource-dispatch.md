# Resource Dispatch

Implemented in migration 016 and src/lib/dispatch/. This is the active
coordinator integration, separate from the legacy in-memory action callback.
Apply 016 after 015 and deploy the matching application. No shared migration or
real call was performed during implementation.

## Execution and identity

With ACTION_EXECUTION_MODE=happyrobot, the existing mission worker dispatches
resources already reserved by the parent, bypassing the mock communication
agent. The database validates the mission lease, current run and reservations,
creates durable records, then claims each send before HTTP.

The resource_dispatches table identifies an operational assignment by dispatch_id
and unique (run_id, resource_id, event_id). V2 previously had no assignment UUID.
Mission ID/revision and original event are retained. Worker retries, mission
updates and equivalent missions cannot call that same resource/event again.
Reset creates a new run without deleting dispatch audit.

The client reuses happyRobotConfig and runEndpoint:
POST {HAPPYROBOT_BASE_URL}/workflows/{HAPPYROBOT_DISPATCH_WORKFLOW_ID}/runs,
body {payload, environment}. Existing auth/path settings remain configurable.

Exactly the existing 15 trigger parameters are sent:

| Field                                      | Source                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| dispatch_id                                | Persisted dispatch UUID                                                |
| incident_id                                | Coordinator run UUID                                                   |
| plan_id                                    | Run UUID + colon + committed state revision                            |
| action_id                                  | Mission UUID; no additional trigger parameter required                 |
| resource_id, resource_display_name         | Reserved resource ID                                                   |
| resource_type                              | ambulance / police / civil_guard                                       |
| resource_contact_name, resource_phone      | Server-configured approved contact                                     |
| mission_summary                            | Mission objective                                                      |
| mission_destination, mission_requested_eta | Empty: no verified structured destination/ETA in current mission model |
| mission_instructions                       | Mission instructions, including any known destination                  |
| context                                    | Incident summary                                                       |
| requested_at                               | Persisted preparation timestamp                                        |

Only HAPPYROBOT_RESOURCE_CONTACTS supplies recipients. This server-only JSON map
uses resource IDs as keys and values with name, phone (E.164), demoSafe:true.
Configure every resource that may be dispatched. Missing/invalid contacts block
the mission visibly; no phone is inferred from model text. Never commit contacts.

A real run_id is required. No fabricated ID or automatic HTTP retry:
HappyRobot's idempotency header is not a verified exactly-once guarantee.
A 4xx becomes start_failed; network errors, timeouts, 5xx and invalid/missing run
IDs become unknown. Reservations stay committed. A callback can resolve an
unknown start. Legacy MAX_ATTEMPTS and response-ID fallback do not apply here.

## Callback

POST /api/dispatch/results, JSON, header x-happyrobot-secret.
Both configured HAPPYROBOT_WEBHOOK_SECRET and FARO_WEBHOOK_SECRET are accepted
using constant-time comparisons. Existing inbound credentials remain valid.
Prefer the same value in both workflows, then retain one canonical secret.
Missing configuration fails closed. The /api/signals body/response is unchanged.

Send the normalized object directly, under dispatch_result, or as the JSON
string dispatch_result_json:

```json
{
  "dispatch_result": {
    "dispatch_id": "<echo dispatch_id>",
    "action_id": "<echo action_id: mission UUID>",
    "incident_id": "<echo incident_id>",
    "plan_id": "<echo plan_id>",
    "resource_id": "<echo resource_id>",
    "dispatch_status": "unavailable",
    "constraint_description": "The access road is closed.",
    "rejection_reason": null,
    "responder_statement": "We cannot reach the destination.",
    "eta_minutes": null,
    "native_interaction_id": "<conversation ID if available>",
    "run_id": "<HappyRobot run ID if available>",
    "transcript_reference": null,
    "completed_at": "2026-09-19T18:00:00Z"
  }
}
```

Required: dispatch UUID, known resource ID, whitelisted dispatch_status.
Other references, when supplied, must match persistence. Optional mission_id
aliases action_id; assignment_id must equal dispatch_id. Do not confuse the
conversation ID with the run ID. Summary, transcript, claims, limitations/reason,
ETA, timestamp and additional structured data are retained as evidence.
Maximum body: 128,000 bytes. No transcript URL is fetched.

Success: HTTP 200 with code=OK, dispatchId, missionId, resourceId, outcome,
duplicate, stale, status=processed|recorded_stale and replanning=scheduled.
Scheduling is not proof of model completion. Errors: 400 invalid payload,
401 wrong secret, 404 unknown dispatch, 409 correlation/result conflict,
413 oversized body, 503 missing configuration/storage.

SQL serializes callbacks and stores a canonical JSON fingerprint. The first
terminal result wins. Retries must preserve normalized content, timestamps and
references; object key order and envelope may change. Exact duplicates return
200 without repeating state changes/audit. Changed content returns 409.
Do not send intermediate statuses as final dispatch outcomes.

## State transitions

| Outcome                    | Communication mission                               | Resource / assignment                                                  |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| accepted                   | completed once all dispatches accept                | Remains assigned; not field completion                                 |
| accepted_with_constraint   | completed once all accept; needsParentDecision=true | Remains assigned; limitation in parent evidence                        |
| accepted_with_limitation   | Normalized alias of accepted_with_constraint        | Same                                                                   |
| rejected, unavailable      | blocked                                             | Assignment invalidated; unit unavailable, eventId=null; not free stock |
| no_answer, failed, unclear | blocked; no acceptance inferred                     | Commitment retained; unresolved outcome visible                        |

Multiple-resource missions wait for outstanding responses; any failure blocks
them. Results use executionMode=happyrobot and evidence-backed
realActionsExecuted (null when sending is uncertain). Completion describes
communication only, per migration 015. General release/reactivation is deferred.

Inventories accept unit status unavailable and an optional unavailable counter:
available + allocated + unavailable = 10. Old fixtures without the count remain
valid. Frontend schemas/cards consume this addition. SQL and TypeScript reject
assignments to unavailable units and retain existing no-release/transfer rules.

Results for reset runs or revised/cancelled missions are retained as stale and
cannot overwrite current missions/reservations. Evidence belonging to the current
run remains visible to the parent.

## Replanning and recovery

Callback, mission aggregation, resource transition, audit and the durable
dispatch_replan_pending flag commit atomically. A callback revokes an in-flight
coordinator lease to prevent stale proposals overwriting feedback.

Next.js after() schedules the existing coordinator. Its context includes dispatch
outcome, constraints, statement, provider reference and mission history. No Jev
filter discards operational feedback. The model chooses revised plans/resources;
no replacement is hardcoded. A successful commit clears the pending flag.

GET /api/state and /api/subagents show state and results. GET /api/dispatch
exposes current-run attempts/evidence, excluding outgoing payload/contact config.
These reads use existing dashboard/API auth. Protected POST /api/dispatch
resumes pending replanning after interruption; it never redials. API auth:
Authorization: Bearer <CRISIS_API_TOKEN>.

Duplicate callbacks and later intake also recover pending replanning.
Autonomous durable scheduling and provider run polling are not implemented.
Interrupted prepared/sending attempts require operator reconciliation; never
blindly retry an uncertain call.

## Public deployment and HappyRobot setup

Existing Vercel origin: https://faro-lovat-iota.vercel.app.

- Inbound: https://faro-lovat-iota.vercel.app/api/signals
- Dispatch: https://faro-lovat-iota.vercel.app/api/dispatch/results

Origin returned 200 during implementation; the new callback returned 404 before
deployment. Deploy code, migration and environment through the existing
main → production → Vercel process. No new infrastructure is required.

In FARO — Resource Dispatch (01a0b6ed-542f-7485-a6c4-d13e192b6235):

1. Preserve all 15 parameters and propagate correlation through normalization.
2. Replace the terminal BLOCKED node with a Webhook POST to the dispatch URL,
   JSON body above, content-type application/json and x-happyrobot-secret.
3. Connect no-answer/technical-failure branches to normalization and callback.
4. Preserve the outcome whitelist and actual statements/constraints. Never invent
   acceptance, ETA or completion. Copy optional run/conversation references correctly.
5. Retry the same final result on network errors/5xx, preserving completion time.
   Record FARO's response; investigate 4xx instead of retrying indefinitely.
6. Publish to the environment matching HAPPYROBOT_ENVIRONMENT and API key.
   Keep the working inbound payload unchanged.

## Verification and demo

Run npm test -- tests/dispatch.test.ts tests/signals.test.ts tests/happyrobot.test.ts.
Tests execute actual migrations 004–016 in isolated PostgreSQL (PGlite), invoke
the existing worker, send HTTP to a loopback server and commit actual callback
transactions. Replanning uses the actual scheduler/coordinator with substituted
model output: it proves wiring/persistence, not live model judgment.

Live demo:

1. Apply 016 after prior migrations, deploy this revision, configure existing
   Supabase/model/Jev credentials, API auth and HappyRobot settings.
2. Set ACTION_EXECUTION_MODE=happyrobot and approved resource contacts only.
3. Publish the HappyRobot callback. Missing-secret POST must return 401,
   not 404/503.
4. Submit a report through working inbound voice or the existing report API.
   Observe parent plan, reservation, mission and /api/dispatch run ID.
5. Answer that the access road is closed and the assignment cannot be accepted.
   Inspect the normalized unavailable outcome and FARO callback 200.
6. Inspect /api/state: unavailable unit, blocked mission, retained evidence.
   Observe a revised coordinator plan and any justified alternative assignment.
7. Replay the same callback: duplicate=true, no new call or state transition.

A local UI and public callbacks must use the same demo database/run. Production
dashboard session authentication is still a separate prerequisite; do not expose
CRISIS_API_TOKEN in public JavaScript.
