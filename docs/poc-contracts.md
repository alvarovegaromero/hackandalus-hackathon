# POC module contracts v1

Defined on 2026-09-19 for [P0–P5](poc.md). This is the initial implementation
contract between packages. P2 filter request/result and P3 handoff schemas are
implemented in `src/lib/contracts/filter.ts`, with fixtures in
`tests/fixtures/filter-reports.ts`. Other runtime schemas and pipeline wiring
remain pending. See [Jev filter integration](jev-filter.md).
It supersedes the broader contracts draft for this POC only. Existing input and
SSE wire contracts are reused, not replaced.

HappyRobot's public URL, authentication and run endpoints are now documented in
[HappyRobot notes](happyDocumentation.md). Reuse that verified contract; open
provider details below refer to our selected workflow's arguments, outcome
mapping, idempotency guarantees and live validation, not rediscovery of the base API.

## Existing contracts and provenance

The input/SSE implementation inspected is commit
`e2579a9062e1dcc636249f6db970e8a71898f680`, locally available as
`origin/event-pipeline-backend-frontend`. The legacy input/SSE slice has since
landed in `main` under `src/`; the adapter to P2 remains pending.
Source references at that revision:

- `docs/event-telemetry.md`: input acknowledgement, replay and reset behavior.
- `lib/event-pipeline.ts`: `TelemetryRecord`, ingestion and retained history.
- `lib/validation.ts`: `incomingEventSchema`.
- `app/api/telemetry/route.ts`: streaming route and cursor validation.

P1/P0 preserve the ported wire behavior while connecting P2 and durable storage.
Graft identified the
current report boundary; scoped Git reads were needed because the input/SSE work
exists only on the other branch, outside this checkout's index.

### Input: preserve both boundaries through an adapter

The existing `POST /api/events` accepts one legacy event with optional UUID `id`
and the existing source/title/description/zone/category/severity/confidence/
confirmed fields. Keep its validator as the authority; do not copy its enums here.
New input returns `202` with `{eventId, duplicate: false,
status: "awaiting_filtering", storage: "memory"}`. An identical retry returns
`200` and `duplicate: true`; changed content under the same ID returns `409`.
This memory receipt does not claim durable scheduling or completed processing.

The confirmed [simple report contract](input-contract.md) remains the target
for `POST /api/signals` and its batch receipt. Do not change its body, require
classification from the reporter, or substitute the legacy acknowledgement.
Both channels converge on the existing `NormalizedReport` from
`src/lib/report.ts` before P2.

P1 owns the legacy adapter:

- Preserve the ingress UUID: `eventId = NormalizedReport.id = signalId` at this
  new pipeline boundary. Legacy projected command-center IDs are separate.
- Resolve `runId` from trusted context; never infer it from `zoneId`.
- Build `text` from nonempty title/description, joined with a newline. If both
  are absent, use a stable labeled rendering of the supplied category/zone.
- Preserve the full original privately as evidence. Preserve submitted severity,
  confidence and confirmation as claims, not authoritative triage outputs.
- Resolve source/channel through a trusted adapter mapping. Incompatible legacy
  source values need explicit mapping; do not cast them into the report enum.
- Resolve zone location only through a known mapping; otherwise leave location
  absent. Never invent coordinates or silently label reporter GPS as incident GPS.

The reusable legacy projection currently also proposes actions. P0 must prevent
that path from dispatching in parallel with the new agent for the same ingress.
Choose the new pipeline as the execution owner when enabling connected processing.

### SSE: unchanged envelope and transport

```ts
type TelemetryRecord = {
  id: string;
  eventId: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
};
```

Preserve `GET /api/telemetry`, default-message frames with `id:` and JSON `data:`,
the `Last-Event-ID` header (precedence over `?after=`), heartbeat comments, and
the named `reset` frame. Current cursors are epoch UUID plus monotonic counter;
treat them as opaque in consumers and preserve the accepted wire syntax.
Current replay is the latest 100 without a cursor, then pages of 100 after a
cursor. Expiration/restart resets the viewer. Streaming fetch supports bearer
headers; subscribing never starts processing. Existing `event.accepted` and
`filtering.pending` payloads remain unchanged.

Extend the record type union with the domain events below; do not create another
SSE endpoint or top-level envelope. Put new contract version and correlation
fields inside new payloads. Consumers must tolerate unknown record types.

The current store retains 1,000 ingress events and 1,000 records in one process;
it is not durable or shared across instances. P0 owns persistence/replay recovery
behind the same transport. Until that exists, retain `storage: "memory"` and
report restart/history loss honestly. On reset, the durable frontend must also
reload its authoritative read model; the exact snapshot route is an integration
detail, not a replacement SSE protocol.

## Shared internal context

In the definitions below, application IDs are UUIDs and timestamps are ISO UTC.
`eventId` is the canonical ingress/report ID. `runId` is the scenario/crisis
session; `executionId` identifies one logical processing execution for a report.
Transport retries preserve execution identity; an explicit reassessment creates
a new execution. Provider attempt IDs and scheduler runtime IDs are separate.

```ts
type Context = {
  schemaVersion: 1;
  runId: string;
  eventId: string;
  executionId: string;
};
type EvidenceRef = { id: string }; // Resolvable original report or observation.
type Failure = {
  code: string; // Stable module-specific code, never raw provider text.
  retryable: boolean;
  message: string; // Safe operator-facing description.
};
type DecisionAudit = {
  evidence: EvidenceRef[];
  summary: string;
  decidedAt: string;
};
```

All boundary values are runtime-validated. Unknown values stay null; they are
not zero/false. Persist decisions before publishing their activity. Audit summaries
are explicit explanations, not private chain of thought. Scope every lookup to
the authorized run; never send simulator ground truth or secrets to the model/UI.

## P1 → P2: filter request and result

```ts
type FilterRequest = Context & {
  report: NormalizedReport; // Import the existing type; do not redefine it.
  evidence: EvidenceRef[];
};
type FilterResult = Context &
  DecisionAudit & {
    filterDecisionId: string;
    policyVersion: string;
  } & (
    | {
        status: "completed";
        decision: "relevant" | "irrelevant" | "uncertain";
        relevanceProbability: number | null;
        failure: null;
      }
    | { status: "unavailable"; decision: null; relevanceProbability: null; failure: Failure }
  );
```

Require `report.id === eventId` and matching `runId`. Probability, if available,
is finite in `[0, 1]`; it is relevance, not truthfulness. P2 owns Jev invocation
and policy version. P0 routes both relevant and uncertain results to P3 and onward
to the agent, preserving decision and probability. Irrelevant results stop but
remain retained. Unavailable results stop the attempt with a backend error log;
retry or correction follows the failure metadata. The filter never authorizes
tool dispatch itself; downstream priority and action controls still apply.
Initial failure codes: `FILTER_TIMEOUT`, `FILTER_UNAVAILABLE`, `FILTER_INVALID_RESULT`.
The P2 implementation uses configurable Jev model/thresholds with provisional
POC defaults; see [configuration and limitations](jev-filter.md). Evidence IDs
are UUIDs, and the evidence list must include the original report ID. P1 must
supply that reference even when additional provider evidence is available.

Initial P2 delivery logs every outcome in the backend. Frontend notification
is explicitly TBD: P0 must persist results before publishing the existing
filtering telemetry events. No SSE or operator review queue is implemented by P2.

## P2 → P3 → P4: assessed factors and calculated priority

P3 owns factor assessment and the pure scoring function as separate operations.
P2 does not invent severity or urgency to satisfy P3. P3 records evidence and
method for extracted factors; trusted provenance supplies source reliability.

```ts
type PriorityRequest = Context & {
  report: NormalizedReport;
  filter: FilterResult; // Must be completed, relevant or uncertain, with matching context.
  sourceProfileId: string | null; // Trusted server metadata, not report text.
};
type PriorityFactor = {
  value: number | null; // Finite [0, 1], or unknown.
  evidence: EvidenceRef[];
  method: string; // Versioned assessor or trusted source policy.
};
type PriorityFactors = {
  severity: PriorityFactor;
  urgency: PriorityFactor;
  sourceReliability: PriorityFactor;
};
type PriorityResult = Context &
  DecisionAudit & {
    priorityDecisionId: string;
    filterDecisionId: string;
    formulaVersion: string;
    weightsVersion: string;
    factors: PriorityFactors;
  } & (
    | {
        status: "scored";
        score: number;
        contributions: { severity: number; urgency: number; sourceReliability: number };
        failure: null;
      }
    | { status: "needs_review"; score: null; contributions: null; failure: null }
    | { status: "unavailable"; score: null; contributions: null; failure: Failure }
  );
```

Scores are finite in `[0, 100]`, higher first. Do not interpret score bands as
approved operational thresholds. P3 must publish the formula, configuration and
fixtures together, including severe anonymous reports and missing factors.
`contributions` are the signed score components and sum to `score`; choose a
compatible additive formula or explicitly revise this contract before using
another decomposition. No calibrated weights are invented by this document.
An unknown required factor produces `needs_review`, not an assumed zero.
An unknown optional factor follows an explicit versioned formula rule.
P4 receives only `scored` results; other results remain reviewable.
Initial failure codes: `PRIORITY_ASSESSMENT_FAILED`, `PRIORITY_CONFIG_INVALID`.

## P3 → P4: agent request, messages and plans

```ts
type AgentRequest = Context & {
  report: NormalizedReport;
  priority: PriorityResult; // Require scored and matching context.
  expectedRunRevision: number;
  activePlanId: string | null;
};
type AgentMessage = Context & {
  messageId: string;
  role: "user" | "assistant" | "tool";
  content: string; // Persisted, safe display content; never hidden reasoning.
  createdAt: string;
  toolCallId: string | null;
};
type Plan = Context &
  DecisionAudit & {
    planId: string; // New immutable ID for each version.
    version: number; // Increasing within run.
    supersedesPlanId: string | null;
    basedOnRunRevision: number;
    priorityDecisionId: string;
    objective: string;
    steps: { stepId: string; description: string; actionId: string | null }[];
  };
```

P0 supplies persisted report/decision/message/plan history for the run, ordered
by revision. The agent must be able to retrieve earlier evidence when processing
a later report. This is not a full Twin contract. Persist the plan before action
dispatch. P0 commits it only if `expectedRunRevision` is still current; a conflict
requires reloading context and replanning. New plans supersede pending actions
explicitly and retain completed actions/outcomes in history.

## P4: tool execution boundary

```ts
type Action = Context & {
  actionId: string;
  actionRevision: number;
  planId: string;
  stepId: string;
  toolName: string;
  toolContractVersion: string;
  arguments: Record<string, unknown>;
  mode: "simulation" | "live";
  status:
    | "proposed"
    | "awaiting_approval"
    | "ready"
    | "dispatching"
    | "awaiting_result"
    | "succeeded"
    | "failed"
    | "unknown"
    | "blocked"
    | "simulated"
    | "cancelled"
    | "superseded";
};
type ToolResult = Context & {
  actionId: string;
  actionRevision: number;
  attemptId: string;
  toolCallId: string;
  providerExecutionId: string | null;
  observedAt: string;
} & (
    | { status: "accepted" | "succeeded" | "simulated"; evidence: EvidenceRef[]; failure: null }
    | { status: "failed" | "blocked" | "unknown"; evidence: EvidenceRef[]; failure: Failure }
  );
```

The argument bag is a provider boundary placeholder, not permission for arbitrary
tools. P4 must register exactly one tool with a strict argument/result schema,
success evidence and recipient policy before connecting execution. Its real
HappyRobot operation is still TBD. Persist raw provider data privately and expose
only a safe projection. Validate both arguments and result against the registered
version; never execute a model-supplied URL or tool name outside that registry.

Retries of the same dispatch preserve `attemptId` and idempotency key. A timeout
after sending is `unknown` until reconciled, not an automatic second call.
Provider acceptance means awaiting result, not success. Simulation ends in
`simulated`. Outcome delivery is authenticated and deduplicated by provider
delivery ID. Check current plan/action revision and persisted approval/pause
immediately before dispatch; stale approval cannot authorize changed arguments.

## P2/P3/P4 → P5: additive telemetry payloads

The telemetry owner assigns record `id`/`at`; producers supply event ID, type and
validated payload. Domain decision IDs remain stable on delivery retries; every
replay preserves the original telemetry ID. Each new payload below includes
`Context`; nested entities must have matching context. Existing input events
are exempt from that new payload requirement for compatibility.

| Type                  | Payload in addition to Context                                  | Producer     |
| --------------------- | --------------------------------------------------------------- | ------------ |
| `filtering.completed` | `{ result: FilterResult }` with completed status                | P2           |
| `filtering.failed`    | `{ result: FilterResult }` with unavailable status              | P2           |
| `triage.completed`    | `{ result: PriorityResult }` with scored or needs_review status | P3           |
| `triage.failed`       | `{ result: PriorityResult }` with unavailable status            | P3           |
| `agent.started`       | `{ priorityDecisionId: string }`                                | P4           |
| `agent.message`       | `{ message: AgentMessage }`                                     | P4           |
| `plan.created`        | `{ plan: Plan }`                                                | P4           |
| `action.updated`      | `{ action: Action }` using safe display arguments               | P4           |
| `tool.result`         | `{ result: ToolResult }`                                        | P4           |
| `agent.completed`     | `{ planId: string, summary: string }`                           | P4           |
| `agent.failed`        | `{ failure: Failure }`                                          | P4           |
| `control.updated`     | `{ commandId: string, revision: number, state: "paused"         | "running" }` | P0  |

`agent.completed` means the coordinator turn ended; it does not assert every
external action succeeded. Late tool results can follow it. Domain events stay
linked to their originating report even when another report supersedes its plan.
P5 deduplicates by telemetry ID, tolerates repeats/reconnects, and shows independent
filter/priority/agent/action states rather than treating receipt as completion.

## P5 → P0/P4: intervention

```ts
type OperatorCommand = {
  commandId: string;
  runId: string;
  eventId: string;
  executionId: string;
  expectedRevision: number;
} & ({ type: "approve" | "reject"; actionId: string } | { type: "pause" | "resume" });
type CommandResult = {
  commandId: string;
  status: "applied" | "duplicate";
  revision: number;
};
```

Actor identity comes from authentication. For approve/reject, expected revision
is the action revision; for pause/resume it is the run's control revision.
P0 resolves and validates correlation IDs against persisted state. Deduplicate
commands by ID, reject changed payload reuse, and return `409 STALE_STATE` for
revision conflicts. Persist effect and audit together. Approval/rejection emits
`action.updated`; pause/resume emits `control.updated`. Pause blocks new dispatch,
not an already sent call. No automatic retry of a stale approval.

## Initial fixture handoffs and remaining integration

P0 publishes executable schemas and fixtures matching these definitions; consumers
must import them rather than copy the TypeScript examples into separate packages.
The following are acceptance cases, not claims of passing tests:

| Fixture                          | Expected boundary behavior                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Same input ID twice              | Same ingress/execution identity; no second effective dispatch                                    |
| Greeting                         | Irrelevant; retained; no triage or agent execution                                               |
| Clear incident                   | Relevant → scored priority → persisted plan → action/result                                      |
| Ambiguous input                  | Uncertain; forward to P3/agent with uncertainty preserved                                        |
| Jev failure                      | Unavailable; stop attempt and log error; no automatic dispatch                                   |
| Severe anonymous report          | High impact retained under the published priority policy                                         |
| Forged police claim in text      | No trusted source profile elevation                                                              |
| Missing required priority factor | needs_review; no fabricated score                                                                |
| Road closure during execution    | New revision/plan; stale pending action blocked                                                  |
| Provider timeout after send      | Unknown; reconcile before retrying external effect                                               |
| SSE replay/reset                 | Original IDs deduplicated; reset clears stale feed and reloads durable read state when available |
| Pause or stale approval          | No newly authorized dispatch from obsolete state                                                 |

Open before executable freeze: source-profile mapping; factor extraction method,
formula and weights; the one tool's concrete schema/provider contract; durable
repository and scheduling recovery; authorized read-model route and consistent
snapshot/cursor bootstrap. These do not require a new input or SSE contract.
No database schema, endpoint implementation, live call or migration is introduced
by this document.
