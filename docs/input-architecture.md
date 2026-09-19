# Event ingestion: how signals enter FARO

The confirmed [report input contract](input-contract.md) defines the public
payload, normalized triage input, synchronous receipt and asynchronous processing,
and the migration from the existing code. Read it before implementing intake.

## Pipeline

```text
report / channel adapter
  -> validate context and payload
  -> deduplicate delivery, persist original, start durable Workflow
  -> acknowledge receipt
  -> normalize and extract claims
  -> triage
  -> correlate incidents
  -> plan and execute
```

The reporter supplies text and optional location only. The server supplies
identity, crisis context and provenance. Normalization preserves the original
and produces a common envelope; triage assesses relevance, urgency and confidence.
A claimed or inferred fact is not confirmed evidence.

The HTTP request waits for persistence and confirmed scheduling, not model
interpretation or triage. Batches have bounded concurrency and per-item outcomes.
Supabase Realtime, when connected, delivers later state changes to the dashboard;
it does not replace durable Workflow execution. No separate broker or worker is
part of the confirmed stack.

## Implemented today

Two application trees coexist. Next.js serves root `app/` and ignores `src/app/`.

| Path                                    | Current behavior                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/api/events/route.ts`               | Active single-event endpoint using `lib/validation.ts`. Calls `addEvent` synchronously; responds 201 for new events or 200 for duplicates.             |
| `lib/store.ts`                          | In-memory state, optional local persistence, five-minute duplicate lookup, occurrence increments and synchronous replanning.                           |
| `src/app/api/events/route.ts`           | Unserved batch endpoint, bearer `CRISIS_API_TOKEN`, single event / array / `{ events }`, maximum 50.                                                   |
| `src/lib/ingest.ts`                     | Validation, event-ID deduplication and bounded workflow starts; reports accepted, duplicates, rejected and errors.                                     |
| `src/lib/ingest-server.ts`              | Supabase persistence when configured, otherwise process-local deduplication; `?wait=1` waits for workflow results.                                     |
| `src/app/api/scenario/signals/route.ts` | Unserved demo bridge; validates simulator signals and calls batch ingestion with waiting enabled. Production requires `SCENARIO_AGENT_ENABLED=true`.   |
| `src/lib/signals/to-event.ts`           | Simulator adapter: `signalToReport` emits the `NormalizedReport` envelope plus the original signal; legacy `signalToEvent` (same ID) feeds the bridge. |

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

## Delivery milestones

1. **Contract and normalization:** the decision is fixed in
   [input-contract.md](input-contract.md); the envelope schema and scenario
   adapter exist, the public validator and other adapters are next.
2. **Durable ingestion:** reconcile the target data model, migrate the workflow
   input and expose the route under root `app/`. Preserve existing callers until
   migrated. Do not describe in-memory acceptance as durable.
3. **Dashboard updates:** connect Supabase Realtime with operator authentication
   and appropriate read policies. This does not change the producer payload.

The [data-model proposal](data-model.md) still needs reconciliation
for unassessed reports. Its former public `incomingSignalSchema` has been
superseded by the simple report contract; no database migration is implied here.
Other open decisions include HappyRobot's actual callback contract, the triage
outcome enum and operator authentication. See
[open questions](../thoughts/open-questions.md) and [TASKS.md](../TASKS.md).
