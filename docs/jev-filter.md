# P2 · Jev relevance filter

## Quick diagram

```text
P1: normalized report (connection pending)
  |
  v
Validate contract and IDs
  |
  v
Jev: is this worth further incident assessment?
  |-- relevant   --> PriorityRequest --> P3 priority --> agent
  |-- irrelevant --> stop + backend log
  |-- uncertain  --> PriorityRequest (uncertain) --> P3 --> agent
  `-- unavailable --> no continuation + backend log

Frontend notification: TBD. P2 does not calculate priority.
```

Implemented as a server-only callable module. P1 supplies the existing
`NormalizedReport` inside `FilterRequest`; P2 returns a validated `FilterResult`.
`filterForTriage` also returns a `PriorityRequest` for relevant and uncertain
reports, preserving the original decision and probability for the agent path.
It does not invoke an agent or fabricate the priority required by `AgentRequest`.

The served intake does not yet call this module. P1's legacy event
adapter and P0's durable processing/persistence remain integration work. This
change does not port the other input branch or add a competing HTTP endpoint.

## P1 integration

Import `filterForTriage` from `src/lib/filtering/filter-report.ts` in a backend
processing step, after intake has stored the original report. Import shared
types and validators from `src/lib/contracts/filter.ts`.

```ts
const { result, priorityRequest } = await filterForTriage(
  {
    schemaVersion: 1,
    runId: report.runId,
    eventId: report.id,
    executionId, // P0 supplies a stable logical processing UUID.
    report,
    evidence: [{ id: report.id }],
  },
  sourceProfileId, // Trusted metadata UUID or null, never extracted from text.
);
// P0: persist result before handing priorityRequest to P3.
// priorityRequest === null means stop or review; inspect result for the reason.
```

Evidence must include the original report UUID; additional evidence UUIDs are
preserved. Request/report run and event IDs must match. Invalid input throws a
validation error before any provider request; it is not classified as noise.
P1 retains the original even when P2 returns irrelevant. Missing location is valid.

`filterDecisionId` is a deterministic UUIDv8 over run, event, execution and policy.
This provides retry identity, not a persistence or exactly-once guarantee. P0 must
reuse stored completed decisions on delivery retries and atomically commit results;
calling Jev again can return another probability. Explicit reassessment uses a new
execution ID. Processing retry/backoff is owned by P0; P2 makes one bounded request.

## Evaluation and routing

The HTTP integration follows the official [TypeSafe API](https://docs.typesafe.ai/api)
and [Noul primitive](https://docs.typesafe.ai/primitives/noul), consulted on
2026-09-19. Noul supplies a probability, not generated reasoning. No SDK dependency
is needed. The module uses native fetch with an abortable timeout covering headers
and response body, validates the answer, and maps failures to the shared contract.

The question asks whether a report contains possible emergency or response-related
information. Greetings, unrelated content and pure classifier manipulation are
noise. Brief reports, uncertainty, anonymous sources, road updates, corrections and
all-clear messages can be relevant. This is not a truthfulness or severity check.
Only report text and optional location are supplied as untrusted state; source
ranking, raw provider payloads and simulator ground truth are not sent.

| Result        | Backend behavior                                           | P3 handoff                |
| ------------- | ---------------------------------------------------------- | ------------------------- |
| `relevant`    | Structured log with `next: "triage"`                       | Validated PriorityRequest |
| `irrelevant`  | Structured discard log with `next: "stop"`                 | null                      |
| `uncertain`   | Structured log with `next: "triage"`; preserve uncertainty | Validated PriorityRequest |
| `unavailable` | Safe error code and `next: "review"`                       | null                      |

Logs include correlation IDs, policy version, decision and probability. They do
not include report text, recipient details, credentials or raw provider errors.
The audit summary describes the code's probability/threshold decision and records
the returned model identifier; it does not pretend to be model chain of thought.
The policy version includes prompt/routing versions, configured model and both thresholds.
The `jev-latest` alias can change; pin a supported model version when evaluating
repeatability and recalibrate thresholds on labeled project examples.

**TBD: frontend notification.** P2 currently logs only in the backend. After P0
persists the result, publish the already agreed `filtering.completed` or
`filtering.failed` payload through existing SSE. No new event envelope or frontend
implementation is introduced. Until connected, review is an output state/log,
not a claim that an operator review queue exists.

## Configuration

Use server-only `.env.local` variables, documented in `.env.example`:

- `TYPESAFE_API_KEY`: required for a real evaluation; obtain from TypeSafe.
- `JEV_MODEL`: defaults to the documented `jev-latest` model alias.
- `JEV_IRRELEVANT_MAX`: default `0.2`, inclusive discard boundary.
- `JEV_RELEVANT_MIN`: default `0.8`, inclusive relevant classification boundary.
  Uncertain reports below this threshold also continue; only irrelevant reports stop.
- `JEV_TIMEOUT_MS`: default `8000`, integer from 1 to 60000.

Both thresholds must be finite in `[0, 1]` with discard below continue. The gap
is uncertainty, which continues toward the LLM through P3 instead of waiting for
human review. These are provisional POC settings, not calibrated safety or
operational thresholds. Invalid/blank configured values and missing credentials
yield unavailable without a network call; they never silently accept or discard.
HTTP rate limits/server errors, timeouts and network failures are retryable;
authentication failures and malformed answers require correction/review.

Setting these variables alone does not enable any public route or browser-triggered
model call. An explicitly requested manual live exercise is recorded below.

## Verification and remaining work

### On-demand live exercise

Run `npm run jev:try` for 10 synthetic cases against the real P2 module and Jev.
Use `npm run jev:try -- --limit 5` for five cases, or `--dry-run` to inspect inputs
without sending requests. Use the project's Node 24.x runtime and installed development dependencies.
The script loads this checkout's `.env.local`; shell variables win.
It does not print credentials or change environment files.

The console shows expected routing, decision, probability, actual routing, output
contract validation and latency. Relevant and uncertain both mean continue.
Full FilterResult/PriorityRequest outputs are saved in ignored
`.data/jev-smoke-results.json` (overwritten on the next live run). Exit codes:
0 for matching routes, 1 for mismatches, 2 for unavailable service/configuration.
This command is manual only, outside tests, hooks and PR checks. It makes one
request per case; it never invokes P3, the agent, HappyRobot or the frontend.
The small sample is useful for smoke checking, not statistical calibration.

Manual run on 2026-09-19, Windows / Node 22.21.0, `jev-latest`, thresholds
0.2/0.8 and the local 5000 ms timeout: **10/10 expected routes, all output
contracts valid, no service errors**. Calls took 219–1030 ms each. An initial
sandboxed attempt could not reach the service; the authorized network run succeeded.

| Synthetic case           | Relevance probability | Decision / route    |
| ------------------------ | --------------------- | ------------------- |
| Greeting                 | 0.02                  | irrelevant / stop   |
| Clear wildfire           | 0.98                  | relevant / continue |
| Small talk               | 0.01                  | irrelevant / stop   |
| Road closure             | 0.97                  | relevant / continue |
| Ambiguous smoke          | 0.89                  | relevant / continue |
| Advertising              | 0.01                  | irrelevant / stop   |
| Medical emergency        | 0.98                  | relevant / continue |
| Classifier manipulation  | 0.03                  | irrelevant / stop   |
| Incomplete call for help | 0.98                  | relevant / continue |
| Correction / all-clear   | 0.95                  | relevant / continue |

These are observed outputs from one English-language sample, not guarantees for
later model runs or other languages. No answer landed in the uncertain interval
in this run; the ambiguous smoke example was considered relevant. No downstream
agent or action was executed. Broader labeled evaluation/calibration remains pending.

### Earlier checks

The checks below were completed before the decision to suspend automated tests
for the hackathon. They remain available manually; no new runs are required by
the current workflow.

`npm test -- --run tests/filter.test.ts` covers routing, threshold edges, P1 identity,
the P3 boundary, structured discard logs, safe provider errors, malformed answers,
missing configuration and header/body timeouts. Shared examples live in
`tests/fixtures/filter-reports.ts`. Injected provider probabilities test application
behavior; they do not measure Jev accuracy. The manual live sample above is separate;
broader labeled evaluation and threshold calibration are still pending, as are
P1/P0 wiring, durable result storage and SSE.
