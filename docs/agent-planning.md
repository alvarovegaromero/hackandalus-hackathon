# P4: LLM planning module

Current implementation: [global coordinator state v2](coordinator-state-contract.md) uses
one refreshed prompt, a dedicated worker, event/five-second triggers and individual
ambulance commitments. Apply the v2 migration and run npm run coordinator:work
alongside the app. Release is disabled; the v1 sections below are historical.

Resource implementation update: GET /api/state, POST /api/agent/plan and
POST /api/state/release now use persisted Supabase inventory (10 ambulances).
P4 persisted execution replaces the legacy P3 unlimited fixture with finite state;
only ambulance proposals are accepted. Plans and allocation audit commit together.
See [resource state contract](resource-state-contract.md). Earlier unlimited examples below describe
the historical standalone harness. FE/intake integration remains pending.

`src/lib/agents/plan-report.ts` implements `planReport` for the P3
`AgentRequest`. It uses the installed Vercel AI SDK's `ToolLoopAgent` and
`Output.object` with an explicit configured model provider. Model calls are real;
all tools are local mocks. Missing configuration never becomes a fake model answer.

Scope: large-scale catastrophe coordination for populations, zones and
infrastructure. Individual cases can inform that wider response; standalone
individual emergency dispatch is a future addon.

P3 supplies the source-of-truth impact calculation, structured observed factors,
Jev relevance and unknowns. The LLM chooses final priority and finite resource
quantities within the supplied finite ambulance inventory.
Confidence is unknown and is never inferred from Jev relevance.

## Input/output diagram

```text
INPUT FROM P3
  Original catastrophe report + Jev relevance/uncertainty
  Impact score and factors, or null and missingFactors
  Evidence + unlimited resource availability assumption
  Run/event/execution IDs + expected revision
  Authorized history + active plan ID + next plan version
                           |
                           v
VALIDATE INPUT AND PROVIDER CONFIGURATION
  Invalid context/history/configuration -> reject before model call
                           |
                           v
OPEN CODE MODEL THROUGH VERCEL AI SDK (STEP 1)
  Choose finite resource quantities and hypothetical communications
                           |
                           v
simulateResponse — LOCAL MOCK
  Return simulated assignments and HappyRobot placeholder outcomes
  No dispatch, recipients, outbound communication or real reservation
                           |
                           v
LLM FINAL STRUCTURED RESPONSE (STEP 2)
  Final priority: low / medium / high / critical
  Resource proposal + objective + ordered plan steps
  Brief rationale + assumptions + verification needs
                           |
                           v
VALIDATE OUTPUT
  Same context IDs and revision; resources match simulated assignment
  Missing impact factors require verification needs
  Failure -> safe error; no fallback plan or real action
                           |
                           v
OUTPUT
  Decision + versioned plan + tool/assistant audit messages
  toolExecutions: status simulated; realActionsExecuted: false
  P0 persistence / frontend delivery remain pending integration
```

```ts
import { planReport } from "@/lib/agents/plan-report";

const result = await planReport(agentRequest, {
  planVersion: 1,
  history: [], // Initial turn only; P0 loads ordered persisted history for later turns.
});
// result: { mode: "ai", model, provider, decision, plan, messages,
//           executionMode: "simulation", realActionsExecuted: false, toolExecutions }
// P0 now commits against agentRequest.expectedRunRevision before publishing.
```

The executable P4 contracts are in `src/lib/contracts/agent.ts`; the shared
decision and request schemas remain in `src/lib/contracts/triage.ts`.
The call has a 30-second timeout, no automatic provider retry and an optional
third argument `{ abortSignal }`. The loop is bounded to two model steps:
one forced `simulateResponse` call, then a final structured plan with tools disabled.

## Model configuration

`src/lib/agents/model.ts` selects exactly one provider. There is no fallback to
another endpoint or provider after an error.

| `AI_PROVIDER`       | Required settings                    | Adapter                |
| ------------------- | ------------------------------------ | ---------------------- |
| `gateway` (default) | `AI_MODEL`, `AI_GATEWAY_API_KEY`     | AI SDK Gateway         |
| `opencode-go`       | `OPENCODE_MODEL`, `OPENCODE_API_KEY` | OpenCode Go Responses  |
| `opencode-zen`      | `OPENCODE_MODEL`, `OPENCODE_API_KEY` | OpenCode Zen Responses |

The OpenCode adapter currently supports `gpt-5.6-luna` only, through
`@ai-sdk/openai`'s `createOpenAI(...).responses(...)`. Its fixed base URLs are
`https://opencode.ai/zen/go/v1` and `https://opencode.ai/zen/v1`, respectively.
These are the model-specific routes in the official [Go endpoints](https://opencode.ai/docs/go/#endpoints)
and [Zen endpoints](https://opencode.ai/docs/zen/#endpoints), checked 2026-09-19.
Other models require checking their documented protocol before extending this adapter.

Go is designed for coding-agent traffic; its documentation does not establish
that catastrophe planning is an approved use. Confirm suitability with the provider.
The client identifies honestly as `faro-poc/0.1` and sends the run UUID as stable
`x-opencode-session`. It does not impersonate another client or bypass rejection.
See [Go client requirements](https://opencode.ai/docs/go/#where-can-i-use-it).

## Mock tools only

`src/lib/agents/mock-tools.ts` exposes one `simulateResponse` tool with strict
arguments: up to 20 finite resource proposals and up to 10 hypothetical voice,
chat or email messages to generic operator/responders/affected-people audiences.
It has no recipient addresses, provider credentials, network calls or live adapter
imports. The tool validates finite availability; planAndAllocate persists the reservation after final plan validation.

Each invocation owns a fresh simulation ledger. The tool returns a validated
`SimulatedToolExecution` with context, a server-owned tool-call UUID,
`status: "simulated"`, `mode: "simulation"`, `realActionsExecuted: false`,
arguments and mock results. Communications are labeled `happyrobot_mock`.
The final resource proposals must exactly match those passed to the simulation.
Missing or repeated tool calls and inconsistent final allocations reject the turn.
Tools can simulate empty resource/communication lists where no action is justified.

Returned tool messages and the final assistant message form the auditable turn.
Simulation records are not successful HappyRobot outcomes or live dispatch evidence.
No runtime option can switch these tools into live mode. Failed turns discard
their local mock ledger; external recovery is unnecessary because there are no effects.

## Input, output and replanning

P0 supplies `planVersion` and ordered history summaries, with their run ID,
revision and evidence references. History must belong to the same run and cannot
be newer than `expectedRunRevision`. Send authorized observations and outcomes,
never simulator ground truth, secrets or private contact details. The current
history boundary accepts up to 100 summaries of 4,000 characters each; P0 must
choose relevant history within that budget rather than silently losing outcomes.

The model returns a structured decision, objective and one to ten ordered steps.
Its decision must preserve all request IDs, the P3 decision ID and run revision.
Incomplete impact requires a nonempty `verificationNeeded` list. Model prose
still needs operator review; schema validation does not prove correct judgment.

The server assigns immutable plan, message and step UUIDs. The plan keeps the
supplied version, `supersedesPlanId`, `basedOnRunRevision`, input evidence and a
brief rationale. All step `actionId` values are null; mock tool executions are
separate audit records, not persisted live actions. The returned assistant
message contains only the validated structured decision and proposed plan
content. Provider reasoning, raw request/response bodies and credentials are
never included. Persisted audit summaries explain decisions; they are not a
transcript of private model reasoning. P0/P5 must still apply their authorized
read projection to model-generated content before displaying it.

Later calls receive past report/decision/action-outcome summaries and the active
plan ID so the model can revise pending proposals without treating completed
actions as new work. The caller owns contiguous plan numbering and must compare
the expected run revision atomically when persisting. A stale snapshot requires
reloading and replanning. Repeating a model call can produce a different plan;
P0 must reuse already committed results for delivery retries.

## Failures and delivery limits

Malformed input/history throws validation errors before calling the provider.
`AgentPlanningError` exposes safe codes: `AGENT_NOT_CONFIGURED`,
`AGENT_UNAVAILABLE` (including timeout/cancellation), and `AGENT_INVALID_RESULT`.
Raw provider errors are discarded. A failure returns no fallback plan and
performs no external action.

Implemented: callable agent with mock tools, validated priority/resource proposals,
versioned plan and assistant/tool audit messages. Pending: served P1/P2/P3 dispatch,
durable conversation/plan storage, atomic revision commits, SSE notifications,
resource catalog and the selected HappyRobot tool with approval/dispatch/outcome
handling. The legacy `coordinate(CrisisEvent)` Workflow remains separate and
must not execute alongside this planner for the same input.

Live model validation is recorded below. No automated tests, pre-commit or real
communications were run. Local formatting, lint and type validation passed on
Windows. This module alone does not complete P4's live execution acceptance.

## On-demand exercise

`scripts/try-llm.mjs` exercises the real `prepareAgentRequest` and `planReport`
implementations with eight synthetic cases: campsite wildfire, school, nursing
home, uncertain smoke, wildfire reaching a settlement, evacuated campsite, missing
time to harm and a road-closure replan. P2 results are explicitly synthetic;
the exercise does not call Jev or any live execution tool.

```sh
npm run llm:try -- --dry-run
npm run llm:try -- --limit 5
npm run llm:try
```

For real Jev filtering before triage and planning, add `--with-jev`. This adds a
greeting stop case and saves `.data/pipeline-smoke-results.json`. See the
[backend integration exercise and application E2E gaps](poc-backend-smoke.md).

Use the documented Node.js 24 runtime. The command loads the provider settings
listed above from `.env.local`; shell variables take precedence. Dry run
requires no credentials, constructs all P3 inputs and validates the P4 input
contract without calling a model, running tools or writing results. Live mode makes
up to two potentially billable model calls per case (30-second total limit).
Only the tools remain simulated. Missing credentials
stop before any calls.

Live output shows priority, proposed resources, objective and verification needs.
It checks output schemas, context IDs, run/plan revisions, null action IDs,
correlated tool messages, simulated results, matching resource proposals and
required verification for incomplete impact. It deliberately does not assert
exact priorities or resource quantities: these are nondeterministic judgments
for human review. `PASS` means the structural checks passed, not that the model
made an operationally correct decision.

Full validated structured outputs and synthetic inputs are written to ignored
`.data/llm-smoke-results.json`. Credentials are redacted; raw provider responses,
errors and hidden reasoning are never printed or saved. The file is replaced
by each live run. Exit codes are 0 for all contracts passing, 1 for mismatches,
and 2 for configuration/service/exercise errors. No output file is created in
dry run. This manual script is absent from tests, hooks and `npm run check`.

## Observed live scenarios

On 2026-09-19, Windows with Node 24, `npm run llm:try` completed **8/8 valid
output contracts, zero errors**, using `opencode-go` / `gpt-5.6-luna` through
Vercel AI SDK. Each case executed one local mock tool; every result had
`realActionsExecuted: false`. Elapsed time per case was 9.4–11.3 seconds.
Jev outputs were synthetic; these were real LLM calls, not end-to-end P1/P2 runs.

| Scenario                                        | P3 impact | Observed priority | Plan steps | Verification items |
| ----------------------------------------------- | --------- | ----------------- | ---------- | ------------------ |
| Campsite wildfire: 80 people, G4, 10 min        | 4.5804    | critical          | 7          | 5                  |
| School: 120 people, G4, 15 min                  | 6.2484    | critical          | 7          | 5                  |
| Nursing home: 40 people, G5, 5 min              | 12.0959   | critical          | 6          | 4                  |
| Uncertain smoke; severity/exposure/time unknown | null      | high              | 5          | 6                  |
| Fire reaches settlement: 120 people, G5, now    | 10.4139   | critical          | 6          | 5                  |
| Evacuated campsite: known zero people           | 0         | low               | 4          | 4                  |
| 30 exposed people; time unknown                 | null      | high              | 8          | 6                  |
| A-397 closure; revise prior plan for 20 people  | 2.2667    | high              | 6          | 5                  |

Example actual campsite resource proposal: four wildland fire engines, four
evacuation buses, two ambulances, one incident command unit and one temporary
shelter site. All were simulated; these are model proposals, not fixed ratios.
The evacuated-campsite result proposed monitoring rather than repeating evacuation.
The road-closure result proposed checking an alternate route and avoiding both
the blocked A-397 and repeated warnings. Unknown-factor cases requested verification.

Priorities and resource quantities can change on another run. This small exercise
establishes callable provider/tool/contract behavior, not calibrated catastrophe
response quality. Resource names and units are still free text: the sample mixes
vehicle/team counts and shelter capacity, so do not sum quantities across types.
A canonical resource catalog and capacity validation remain future integration work.
