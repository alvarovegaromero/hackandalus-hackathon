# Event ingestion: how signals enter FARO

The HappyRobot inbound contract is runtime-validated by
`src/lib/signals/happyrobot.ts`. The broader multi-source contract in
[input-contract.md](input-contract.md) remains future work.

The legacy `/api/events` input and SSE transport are now integrated in `main`, as
specified in [POC module contracts](poc-contracts.md). Their process-local receipt
is separate from the durable HappyRobot Signal receipt below. The SSE
envelope/cursors/reset remain the transport to extend with filter, triage and
agent payloads.

## Pipeline

```text
HappyRobot normalized_report
  -> authenticate and validate POST /api/signals
  -> persist the complete raw payload and deduplicate transport delivery
  -> processSignal (synchronous first slice)
  -> deterministic FARO interpretation into active CrisisEvent
  -> addCrisisEvent
  -> existing Digital Twin, planning, actions and dashboard flow
```

HappyRobot supplies observations and provenance. FARO supplies operational
category, zone assignment, severity and confidence. Claims remain losslessly
embedded in `signals.raw_payload`; separate Claim/Evidence rows and incident
correlation are not part of this first slice.

The HTTP request persists first and then waits for deterministic interpretation.
A processing failure leaves the Signal in `failed` state for a later retry.
Vercel Workflow, queues, batch intake, and Supabase Realtime are not used here.
The dashboard continues to poll `GET /api/situation` every four seconds.
The existing SSE transport remains unchanged and is not the processing trigger.

## Implemented today

Next.js serves the unified `src/app/` tree. The duplicate scaffold endpoints
were retired; backend module consolidation does not imply integration.

| Path                            | Current behavior                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/signals/route.ts`  | Authenticated HappyRobot intake; exact validation, durable idempotent persistence, synchronous processing, compact result.          |
| `src/lib/signals/happyrobot.ts` | Exact `normalized_report` schema plus source-scoped deterministic identities.                                                       |
| `src/lib/signals/repository.ts` | Supabase `signals` persistence, atomic processing claim, success/failure recording.                                                 |
| `src/lib/signals/process.ts`    | Explicit deterministic interpretation into active `src/lib/types.ts::CrisisEvent`.                                                  |
| `src/app/api/events/route.ts`   | Legacy interpreted-event input; process-local receipt, telemetry publication and command-center projection.                         |
| `src/lib/store.ts`              | `addCrisisEvent` is the shared interpreted-Event seam; it updates state, Twin, actions, plan and audit.                             |
| `src/lib/ingest.ts`             | Reusable batch validation, event-ID deduplication and bounded processing starts; not called by the active route.                    |
| `src/lib/signals/to-event.ts`   | `signalToReport` emits the shared envelope and preserves scenario evidence; legacy `signalToEvent` remains available for migration. |

Luis's batch implementation is reusable orchestration, but is not the served
endpoint or the final report schema. The exact adaptation plan is in
[input-contract.md](input-contract.md#compatibility-with-luiss-work).

## Four different identity problems

| Concern                                   | Boundary                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Re-delivery of the same report            | Intake deduplication; preserve signal identity and avoid duplicate processing. |
| Different reports about the same incident | Incident correlation after triage; retain distinct evidence.                   |
| Re-delivery of a HappyRobot callback      | Provider delivery identity at the callback boundary.                           |
| Retry of an outbound action               | Execution idempotency key; distinct from signal deduplication.                 |

Do not merge reports solely because they share a category or area. Fallback
deduplication and its window remain open. An atomic occurrence update and
recovery after persistence succeeds but scheduling fails must be resolved during
implementation. A stored report alone is not proof of scheduled work.

## Request and retry contract

Send `POST /api/signals` with `Content-Type: application/json` and
`x-happyrobot-secret: <HAPPYROBOT_WEBHOOK_SECRET>`. A successful response is:

```json
{ "signalId": "...", "eventId": "...", "duplicate": false, "status": "processed" }
```

Transport identity is `happyrobot:<channel>:<native_interaction_id>`. When the
native ID is absent, FARO hashes the canonical complete payload. Re-delivery of
an already processed Signal returns its existing identifiers and creates no new
Event. Failed interpretation records `processing_status = failed` without
altering `raw_payload`; sending the same report again claims and retries it.

The migration `202609190001_happyrobot_signals.sql` must be applied before live
intake. The `signals` table is service-role-only with deny-by-default RLS.

The [data-model proposal](data-model.md) still needs reconciliation
for unassessed reports. Its former public `incomingSignalSchema` has been
superseded by the simple report contract; no database migration is implied here.
Other open decisions include HappyRobot's actual callback contract, the triage
outcome enum and operator authentication. See
[open questions](../thoughts/open-questions.md) and [TASKS.md](../TASKS.md).
