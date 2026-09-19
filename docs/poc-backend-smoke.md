# Manual P2 -> P3 -> P4 integration exercise

The P2, P3 and P4 modules are merged, but the served HTTP intake does not yet
call this chain. The dashboard uses the legacy command-center projection.
Do not describe the whole POC as complete or this script as a browser E2E test.

```text
Synthetic NormalizedReport + structured scenario observations
  -> real Jev relevance filter
     -> irrelevant: stop; no triage or planner call
     -> unavailable: stop; report an error
     -> relevant / uncertain: deterministic P3 impact
        -> configured real LLM via Vercel AI SDK
        -> local resource/HappyRobot mock tool
        -> validated priority, plan and audit output
```

Run on demand with Node 24; no automated tests or hooks are added:

```sh
npm run llm:try -- --with-jev --dry-run
npm run llm:try -- --with-jev --limit 2
npm run llm:try -- --with-jev
```

`--with-jev` prepends a greeting to the existing eight P4 scenarios and calls
the actual `filterForTriage -> prepareAgentRequest -> planReport` implementations.
Its default is nine cases. `--limit 2` covers the greeting and campsite fire.
Without the flag, the original eight-case script still uses synthetic P2 results.
Dry run never calls a provider and uses synthetic filtering outcomes.

The command reads `TYPESAFE_API_KEY`, optional `JEV_*` settings and the configured
planner provider from `.env.local`, with shell values taking precedence. It does
not log credentials. Jev uncertainty may differ between runs: the ambiguous-smoke
example is not forced to have an `uncertain` classification when Jev is real.

Results go to ignored `.data/pipeline-smoke-results.json`, separately from the
original `.data/llm-smoke-results.json`. Filtered reports retain their original
report/filter output and no plan. Continuing reports retain the full P3 request,
P4 plan and mock tool outcomes. Every live action remains disabled.

Validation checks expected stop/continue routes, output schemas and context IDs,
revision and resource consistency, required verification of unknown factors,
and simulated tool results. It does not establish calibrated priority/resource
quality, durable retry recovery or correct browser rendering.

## Still required for application E2E

- Connect the actual intake producer to `NormalizedReport` and evidence-backed
  structured factors. Both `/api/events` and HappyRobot `/api/signals` currently
  use the legacy projection, not this model chain.
- Make asynchronous processing recoverable and avoid duplicate legacy/new
  execution for the same input.
- Persist filter/impact decisions, plans and messages with revision checks.
- Publish their safe activity through the existing SSE boundary and render it
  in the frontend; verify refresh/reconnect and operator control.

HappyRobot communications intentionally remain mocked for this POC step.

## Observed run

2026-09-19, Windows / Node 24, Jev and OpenCode Go/Luna live:
**9/9 expected routes and valid downstream contracts, zero errors**.
The greeting stopped in 1.2 seconds; continuing cases took 10.4–12.4 seconds.
The run used synthetic reports and structured observations, not HTTP ingestion.

| Scenario                    | Actual Jev outcome | Observed P4 priority |
| --------------------------- | ------------------ | -------------------- |
| Greeting                    | irrelevant, 0.02   | No P3/P4 call        |
| Campsite wildfire           | relevant, 0.98     | critical             |
| School evacuation           | relevant, 0.98     | high                 |
| Nursing home                | relevant, 0.98     | critical             |
| Uncertain smoke             | relevant, 0.93     | medium               |
| Wildfire reaches settlement | relevant, 0.98     | critical             |
| Evacuated campsite          | relevant, 0.95     | low                  |
| Missing time to harm        | relevant, 0.98     | high                 |
| Road closure replan         | relevant, 0.96     | high                 |

All eight continuing cases returned one simulated tool execution and
`realActionsExecuted: false`. No live `uncertain` classification occurred in
this sample; uncertain routing was previously exercised with synthetic outcomes.
The school and smoke priorities differ from the earlier P4-only sample, as
expected for uncalibrated model judgments. The formula remains deterministic.
