# Agentic flow and reset review

Scope: P0/P4 orchestration, mission execution, P1 fixture delivery and the dashboard
reset handoff. Local review of the September 19 implementation; no live calls,
production deployment or production migration performed.

Merge note: main now includes Resource Dispatch (migration 016) and authenticated
callbacks. Its [contract](resource-dispatch.md) supersedes the historical mock-only
findings below. The reset fence is renumbered to 017 and wraps the dispatch-aware
reset; the merged scheduler preserves dispatch-result replanning. The SQL checks
below describe the pre-merge isolated verification, not a deployment of either migration.

## Flow at review time

1. Intake persists a report and schedules Next.js `after()` work.
2. Jev filters independently of the coordinator model. Persisted receipts and
   decisions are replayed by SSE; the dashboard polls coordinator state/missions.
3. The coordinator receives all accepted observations, current inventory and up to
   100 most recent missions (including their persisted operations). `generateText`
   produces a validated proposal; SQL preserves concurrently arriving events and
   already assigned resources.
4. After commit, the backend submits mission changes. Bounded `ToolLoopAgent`
   executions use communication tools, persist a result and wake the coordinator.
5. Communication is a no-op acknowledgement. Completed means a communication
   request finished; resources remain assigned, and field success is unverified.

## Changes in this review

- Background callbacks and model requests are tied to a run and abort controller.
  Reset aborts local model calls and fences late filter/model/mission callbacks.
  A delayed state read cannot replace a freshly reset local run.
- Migration 017 serializes subagent database actions with reset, rejects actions
  from old runs and cancels/revokes unfinished old missions. It preserves contact
  operations and history; reset restores all thirty units. Locks cover short SQL
  operations only, not model calls. Apply 017 after 016 before relying on these
  guarantees across server processes.
- Reset returns `{ runId, state }`, retaining the original `runId` field. The UI
  applies the returned snapshot immediately, invalidates earlier polling replies,
  clears selections and reconnects telemetry instead of waiting for polling.
- Fixture IDs are deterministic per run/index. Repeated starts cannot duplicate
  reports; receipt timestamps may differ as allowed by existing enqueue semantics.
  Enqueue with a known run no longer reads the entire state before every report;
  the SQL RPC validates the run atomically. Repeated starts still own separate
  timed producers; this is deduplication, not a durable simulation scheduler.
- Claiming a mission whose retry budget expired can return a persisted failure
  rather than an executable mission. This now wakes the parent correctly.
- Later intake resumes queued/expired missions even if Jev rejected its report,
  and can resume planning accepted events without priorities.
- Replaying a committed proposal uses stable mission IDs. One stale or failed
  mission handoff no longer prevents later changes and requests a fresh plan.
  A multi-event mission receives the highest linked event priority.

## Remaining constraints before live workflows

1. **Durable execution/handoff.** `after()` and local wakeups do not survive host
   termination. Parent commit and mission submission are separate transactions.
   Audit retains the proposal, but there is no automatic durable outbox replay.
   Later intake recovers pending reports and claimable missions, not every lost
   wakeup/handoff. Use a persisted job/outbox before promising autonomous recovery.
2. **Asynchronous communication.** The legacy HappyRobot webhook does not update
   these mission operations. A `waiting` mission is not claimable by the current
   SQL claim branch. Before replacing the no-op, add operation IDs/idempotency,
   authenticated callback routing, result-driven wakeup, timeouts and cancellation.
   Aborting a model cannot undo a real call already sent to a provider.
3. **Revision side effects.** Updating an open mission clears its current operation
   list in migration 013. Old contacts remain in activity but are not given to the
   next activation as existing operations. Live integrations must distinguish
   a new requested action from a retry and retain provider operations across
   revisions; swapping the adapter alone is insufficient.
4. **Duplicate evaluation and historical context.** Filtering has local batching
   but no cross-host claim, so two hosts can spend Jev calls on the same report.
   The coordinator sees at most 100 missions. Semantic mission deduplication and
   grouping reports about the same incident are mostly prompt-driven; a new
   report does not necessarily justify new resources. Inputs are capped at 100
   reports and explicit resource release remains deliberately disabled.
5. **Observability.** Database/model failures have coarse logs. Add run/mission
   latency and retry metrics before diagnosing real provider failures. The current
   source-derived impact formula retains unknown inputs; it is not a calibrated
   emergency dispatch policy.

## Validation

- Twelve focused deterministic checks: reset during filtering/generation, late
  state reads and callbacks, queued-mission recovery, exhausted claims, stale
  commits, stable handoff identity, conflict continuation and aggregate priority.
- Migration 017 executed against private empty table/function copies in a unique
  Supabase schema inside a rolled-back transaction. Verified stale action/claim
  rejection, mission cancellation, operation preservation, reset inventory and
  exhausted-lease result shape. The live demo tables were not reset or mutated.
- SQL migration remains unapplied to the shared public schema. No new model-backed
  end-to-end run or real HappyRobot interaction was performed in this review.
- Secret scan, formatting, lint, TypeScript and Graft checks passed (lint reports
  pre-existing warnings in ignored `.data/` probes). The standard Turbopack build
  hit the environment's local-port restriction during CSS processing, including
  on retry. The webpack build compiles and provides the fallback build check;
  this does not establish that the default Turbopack build passed.

## Browser evaluation: September 19, 22:45–22:48 CEST

Started one new scenario with the dashboard's Reset & run events button in Chrome
on localhost:3000. Observed initial, intermediate and final UI states; corroborated
failures and assignment counts through read-only current-run audit queries.

- All 32 fixtures arrived: 20 accepted, 11 filtered, one filter error. The error
  was the irrelevant “Gana un móvil gratis” report (`FILTER_TIMEOUT`, retryable),
  shown as an unassessed active event rather than a filtering failure.
- Spanish summaries/plans were concise and incorporated confirmed fire, eastward
  wind, blocked eastern access, the southern route and the hikers' later arrival.
  Subagents consistently described acknowledgements without claiming field work.
- Allocation grew to eight ambulances, ten police and ten civil-guard units.
  The final `mission.result` cycle increased ambulances from six to eight after
  all fixtures had arrived. A no-op acknowledgement contains no new field evidence;
  extra allocation needs an explicit unmet-need justification, not mere replanning.
- Earlier reports remained critical alongside later updates resolving part of the
  same need: the four hikers' trapped report stayed critical even after their
  arrival report and the global plan acknowledged the assembly point.
- An intermediate overview described the breathing difficulty and wheelchair use
  as belonging to different adults (“uno ... y otro ...”). The reports do not
  establish whether these refer to different people. Preserve that ambiguity.
- One coordinator cycle recorded `MODEL_OR_VALIDATION_ERROR`; successful cycles
  resumed afterwards. The audit does not distinguish timeout, provider error or
  schema validation. During the delay, many incoming reports stayed unassessed
  while the visible plan described an older situation.

Assessment: useful summaries and a working reactive loop, but resource escalation,
report/incident reconciliation and visible failure states need improvement before
calling decision quality reliable. This single mock scenario is not an evaluation
of emergency-response safety. No prompts or allocation rules were changed during
this observation; the dashboard tab title was changed to Faro and verified live.
