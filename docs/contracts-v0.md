# Integration contracts v0 · review draft

> Runtime update: Vercel Workflow and its unused execution scaffold have been
> removed. Workflow-based execution below is an earlier proposal, not an installed
> dependency or an agreed requirement. Background scheduling is TBD. HappyRobot
> workflows are separate and remain in scope.

The agreed [initial POC](poc.md) defines the first delivery scope and P0 contract
work. Use [POC module contracts v1](poc-contracts.md) for the initial package
interfaces and existing input/SSE reuse. This broader draft is reference
material, not a frozen POC API. Its five
response-policy outcomes are distinct from the POC relevance filter's three
classifications; full Twin/allocation contracts are deferred. For the POC,
persisted activity and SSE replay replace the Realtime refresh-hint proposal.

Use [HappyRobot notes](happyDocumentation.md) for the verified public API.
Provider details still open below are workflow-specific payloads, outcome mapping,
idempotency guarantees and live validation, not the base URL/auth/run endpoints.

**Proposed, not frozen or implemented.** Only the report semantics linked below
are already confirmed. This document defines boundaries to review before
parallel implementation; it is not a new API specification silently replacing
the served sketch routes. See [architecture review](architecture-review.md).

## Common rules

- `runId`: crisis exercise/session UUID; `incidentId`: one correlated problem
  inside that run; `signalId`: `NormalizedReport.id`. They are not interchangeable.
- `workflowRunId`: runtime execution identifier, never the crisis `runId`.
- `schemaVersion: 1`: proposed on new internal messages and response envelopes;
  do not add it to the strict confirmed public report body or change the existing
  `NormalizedReport` silently. Wrap existing reports when versioning is needed.
- UUIDs for application entities; ISO UTC timestamps; geographic coordinates
  use WGS84. Scenario-relative minutes stay separate from wall time.
- `revision`: increasing integer owned by its aggregate. `expectedRevision`
  rejects stale commands; timestamps are not concurrency tokens.
- Unknown is explicit (`null` in new snapshots/assessments, omitted where the
  confirmed input says optional). Zero, false and an empty list are not substitutes
  for unknown. Confidence is `[0,1]` when assessed, otherwise `null`.
- Every derived fact and decision references evidence IDs and records rationale,
  author/method and assessment time. Untrusted text is data, not instructions.
- Code validates runtime values using shared Zod schemas before domain effects.
  Strict command bodies; additive response changes require consumer compatibility.
- Public responses exclude contact addresses, provider secrets and simulator truth.

## C1 · Report intake → processing

**Confirmed:** [input-contract.md](input-contract.md), including text lengths,
location semantics, strict fields, trusted context, maximum 50 reports and
per-item `accepted`, `merged`, `rejected`, `errors` results. Reuse
[normalizedReportSchema](../src/lib/report.ts), including its existing `extracted`.

**Proposed transport details:**

- Public form sends one report with an `Idempotency-Key` generated before the
  first submission and retained for retries. The body remains `{text, location?}`.
- For a batch, one request key plus stable input index identifies each item;
  retries repeat the complete ordered batch. Different body under the same key
  yields `409 IDEMPOTENCY_CONFLICT`, before starting new work.
- Authenticated providers use their delivery/message ID scoped to run, source
  and provider account; scenario uses its stable signal identity. Without an
  identity, retain the report as a distinct delivery; do not infer a duplicate
  from text or geographic proximity.
- `merged` means transport duplicate, never that two incidents were fused.
  Its `occurrences` counts observed repeated submissions, not independent sources.
- `accepted` only after durable storage and confirmed scheduling. A repeat of a
  persisted but unscheduled item resumes scheduling; it is not `merged` success.
- Error codes initially: `PERSISTENCE_UNAVAILABLE`, `SCHEDULING_UNCONFIRMED`,
  `IDEMPOTENCY_CONFLICT`. Validation issues identify field paths. Authentication
  failures use `401`; unauthorized/ambiguous run context uses `403`.
- Response proposal: `{schemaVersion: 1, accepted: [{index, id}], merged:
[{index, id, occurrences}], rejected: [{index, issues}], errors:
[{index, id?, code, retryable}]}`. `id` on an error is only present after
  persistence established a stable identity. Keep internal workflow IDs private.

Proposed processing entry point:

```ts
type ProcessReportCommand = {
  schemaVersion: 1;
  runId: string;
  signalId: string;
};
```

Load the original and evidence through an authorized repository. Transport the
identity, not a second mutable copy of the world. Scheduling intent states:
`pending → scheduled`; processing states: `pending → processing → completed`
or `failed`. Retry metadata is separate from the report's assessment. Durable
claims and domain-effect deduplication must tolerate repeated Workflow starts.

## C2 · Triage → evidence and Twin

Proposed assessment fields:

| Field                                             | Meaning                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `runId`, `signalId`, `assessmentId`, `assessedAt` | Scope, source report and immutable assessment identity                                                                               |
| `status`                                          | `assessed` or `unavailable`; unavailable must not silently discard a report                                                          |
| `relevance`, `truthfulness`, `confidence`         | Separate nullable probabilities; model confidence is not a verified fact                                                             |
| `outcome`                                         | `act`, `prepare_and_verify`, `verify_urgently`, `observe`, `discard`; null if unavailable                                            |
| `claims`                                          | Candidate facts with subject/property/value, location semantics and evidence references; concrete vocabulary to freeze with fixtures |
| `rationale`, `method`, `modelId`                  | Explanation, assessment implementation, model identifier when used                                                                   |
| `evidenceIds`                                     | Original report/readings and supporting observations; never ground truth                                                             |

Correlation returns an `incidentId` and evidence links, retaining each original
report. Retries do not increase independent-source confidence. The Twin owner
commits assessed updates and audit together, producing a new `twinRevision`.
Contradictory observations remain visible; the merge policy needs explicit
rules, not last-write-wins disguised as certainty.

## C3 · Twin → planner → committed plan

The planner reads a revisioned **perceived** snapshot:
`{runId, twinRevision, asOf, incidents, infrastructure, resources, constraints,
activePlan, unknowns}`. Each fact carries provenance and freshness. No simulator
truth or evaluation accuracy result enters this snapshot.

The draft plan includes `planId`, `runId`, `basedOnTwinRevision`, `priorities`,
`allocations`, `uncoveredDemands`, `assumptions`, `actions`, and `rationale`.

- Priority includes potential impact and its factors, time to harm, confidence
  separately, and explanation. Do not multiply impact by confidence. Missing
  exposure/ETA produces an explicit unknown and verification need.
- Allocation references resource and incident IDs, capacity, estimated arrival,
  reserve impact and remaining coverage. Unknown ETA stays unknown. Do not claim
  a resource was moved merely because it appears in a draft.
- Assumptions identify a typed predicate, subject, evidence and invalidation
  condition. An unknown or broken prerequisite cannot be treated as satisfied.
- Each action references its plan, incident/objective and assumptions. The control
  policy determines execution permission; model output cannot self-authorize.
- `commitPlan(draft, expectedTwinRevision)` either atomically commits the plan,
  reservations and audit, or returns `STALE_STATE` / `RESOURCE_CONFLICT` without
  partial reservations. The caller rebuilds from fresh state.
- Replanning creates a new plan version and records its predecessor plus changes.
  It explicitly retains or supersedes old actions; it does not dispatch them all again.

Impact thresholds, reserve values, coverage formula, correlation policy, claim
vocabulary and exact snapshot entity schemas remain review blockers. This draft
defines ownership and required semantics, not invented operational parameters.

## C4 · Plan/control → execution

Proposed action kinds: `verify`, `notify`, `allocate`, `mass_alert`, `evacuate`.
An allocation is a domain reservation plus coordination when required; it is
not automatically a HappyRobot API operation. Each kind needs a discriminated
payload and success criterion in the shared schemas.

```ts
type DispatchCommand = {
  schemaVersion: 1;
  runId: string;
  actionId: string;
  actionRevision: number;
  planId: string;
  attemptId: string;
  idempotencyKey: string;
  mode: "simulation" | "live";
};

type DispatchResult =
  | { status: "accepted"; providerExecutionId: string }
  | { status: "simulated"; simulationId: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; code: string; retryable: boolean }
  | { status: "unknown"; reconciliationRequired: true };
```

The executor loads the approved immutable action revision, target contact
reference, channel and validated payload; raw recipient addresses are not in
the dispatch command. A repeated transport attempt retains `attemptId` and key.
A deliberate fallback creates a new attempt only after reconciling the prior
one; the provider's idempotency header/guarantee is still unverified.

Proposed action lifecycle: `proposed → awaiting_approval | ready → dispatching
→ awaiting_result → succeeded | failed | blocked | unknown`. Simulation ends
in `simulated`, never live success. Reject/cancel/supersede transitions are
recorded before dispatch; after dispatch cancellation is a request until the
provider confirms it. `unknown` is pending reconciliation, not terminal failure.
No approval path exists for a stale or superseded action revision.

Automatic `verify`/`notify`, reversible resource moves with notice, and human
approval for mass alerts/evacuation are product policy. Exact rules, reversible
operations and rollout are still to be tested. A physical action cannot be
undone by changing a database status.

## C5 · Provider outcome → execution and evidence

Proposed normalized outcome: `{schemaVersion, runId, actionId, attemptId,
providerExecutionId, deliveryId, receivedAt, occurredAt?, status, evidenceIds,
observations}`. Candidate statuses: `delivered`, `confirmed`, `declined`,
`failed`, `unknown`. Provider payload examples must determine the mapping.

- Authenticate before processing; resolve run/action from the stored dispatch,
  not an untrusted callback's chosen IDs. Retain raw payload privately.
- Persist and deduplicate delivery before acknowledging it; reconcile early
  callbacks that arrive before the dispatch response is recorded.
- Transport completion, a person answering, a person accepting a task, and
  task completion are different facts. Success depends on the action objective.
- Out-of-order callbacks cannot regress a confirmed result to ringing. Late
  results remain auditable even if their plan is superseded.
- Verification observations re-enter the evidence boundary, with provenance;
  they do not overwrite the Twin as unquestioned truth.
- Webhook delivery is one option. Polling/reconciliation, timeout values,
  signature validation and provider sequence guarantees await confirmation.

## C6 · Backend → dashboard / operator commands

Proposed read model: `{schemaVersion, runId, revision, asOf, executionMode,
intake, incidents, infrastructure, resources, priorities, uncoveredDemands,
activePlan, actions, approvals, unknowns, recentChanges, controlState}`.
This is a consumer view, not unrestricted database row streaming. Operational
views exclude ground truth; evaluation has a separate authorized view.

Proposed operator command: `{commandId, runId, expectedRevision, type,
targetId, reason?}`. `type` starts with `approve`, `reject`, `cancel`, `pause`,
`resume`. Actor identity comes from authentication. For action commands,
`expectedRevision` is the action revision; pause/resume use control revision.
`commandId` deduplicates retries; changed payload for the same ID is a conflict.

Result: `{commandId, status: "applied" | "duplicate", revision}`; conflict
returns `409 STALE_STATE` and prompts a snapshot refresh. No blind approve retry.
Reads never advance the scenario clock in the target design. Realtime delivery
is an update hint; a reconnect fetches the authoritative snapshot.

## Contract freeze and shared fixtures

One owner converts approved boundaries into Zod exports and versioned fixtures.
Frontend, domain and provider adapters must consume the same examples:

1. Text-only report; GPS from reporter; incident pin; textual place; invalid pair.
2. Same delivery twice; different witnesses with identical text; changed body
   under the same key; mixed batch with a scheduling failure.
3. Persistence succeeds, start acknowledgement is lost, recovery starts twice:
   one effective assessment/update and no duplicate dispatch.
4. High impact with low confidence: verification/preparation, no reduced impact.
5. Road closure while a call waits: new plan, stale approval rejected, resources
   reserved once; no ground truth in model input or operational snapshot.
6. Provider accepts a call but response times out; duplicate/early/late callbacks;
   explicit simulated result; outcome not yet confirmed by the recipient.
7. Unauthorized run, paused execution, changed action after approval, and
   dashboard reconnect after missed updates.

These are acceptance cases, not a claim that the proposed integration currently
passes them. Freeze exact nested entity schemas and JSON fixtures before calling
the interfaces ready for parallel integration. Implementation tests should assert
these outcomes, not mirror orchestration internals.
