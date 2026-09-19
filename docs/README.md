# Documentation map

Subagent execution handoff (Person B): [contracts, tools and worker](subagent-execution.md).

Current contract: [global coordinator state v2](coordinator-state-contract.md), with a [complete FE fixture](coordinator-state.example.json). Implemented with a dedicated coordinator worker; the Supabase v2 migration is applied. Resource release is disabled.

Start with [the project README](../README.md) for setup and
[PROJECT.md](../PROJECT.md) for shared rules. [TASKS.md](../TASKS.md) tracks
implementation status; [CHALLENGE.md](../CHALLENGE.md) defines the requirements.

## Current application

The public landing lives at `/`, with same-tab access to `/dashboard`.
Separate root layouts isolate their styles. See [landing integration](landing-integration.md)
for routing, imported assets and maintenance.

**Dashboard status: SKETCH.** The visible prototype banner has been removed. The interface is exploratory, with partially connected
controls; it does not define the approved product or target architecture.

[Emergency drills](emergency-drills.md) documents the isolated
`/dashboard/drills` training workspace: schematic 3D earthquake/wildfire
exercises, a browser notebook and evidence-based lessons from prior drills.

Next.js serves `src/app/`; `src/lib/` implements the command center and `tests/` covers
it. The dashboard polls the HTTP API. State lives in memory, with optional local
JSON persistence. Outbound communications default to mock mode.

| Document                                      | Purpose                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| [Architecture decisions](architecture.md)     | Served runtime, module responsibilities and trade-offs.                      |
| [Security](security.md)                       | Credentials, operator approval and demo recipients.                          |
| [HappyRobot contract](happyDocumentation.md)  | Verified public API contract, FARO workflow payloads, callbacks and mocking. |
| [Dashboard design](dashboard-design-guide.md) | Visual and interaction guidance.                                             |
| [Demo runbook](demo-runbook.md)               | Live-demo startup sequence, tunnel caveats and pre-demo checklist.           |

## Contracts and integration work

[Finite resource state contract](resource-state-contract.md) defines the next
FE boundary, `GET /api/state` with 3-second polling, 10 initial ambulances
and available/total counters. The schema and response fixture exist; endpoint,
FE migration, finite allocation and removal of `/api/situation` remain pending.

[Manual backend integration exercise](poc-backend-smoke.md) chains real Jev,
triage and the LLM with mock tools. It explicitly distinguishes that run from
the still-pending HTTP-to-frontend POC integration.

[P3 triage integration](triage.md) defines the source-of-truth impact formula,
structured factors from operator/scenario observations, and the planner handoff
with Jev information and unlimited-resource POC assumptions.

[P4 agent planning](agent-planning.md) documents the LLM boundary for final
priority, finite resource proposals and versioned plans. Persistence, frontend
delivery and HappyRobot execution remain separate integration work.

[Jev filter integration](jev-filter.md) documents the implemented P2 module,
P1 request, validated P3 handoff, backend logging and provisional configuration.
Runtime wiring/persistence and frontend filtering notifications remain pending.

**Start implementation with the agreed [Initial POC](poc.md).** It defines the
active scope, P0–P5 work packages, handoffs and demo acceptance. Its persisted
activity/SSE path and bounded filter/triage/agent scope take precedence for the
first delivery. [POC module contracts v1](poc-contracts.md) defines the interfaces
and reuses the existing input/SSE work from `e2579a9`, now ported into `src/`.
P2/P3 executable contracts exist; connecting the processing modules, durable
storage and frontend delivery remains pending.

For the broader product, review [Architecture review](architecture-review.md): current
and proposed diagrams, confirmed decisions, unresolved choices, and parallel work
packages. [Contracts v0](contracts-v0.md) proposes the module boundaries and
acceptance fixtures. Both are drafts awaiting validation, not approved APIs.

The application now uses one `src/` tree. The active `/api/events` endpoint
accepts a single command-center event. Reusable batch ingestion, scenario and
AI SDK modules remain in `src/lib/`, but their old
scaffold routes have been retired. They still need integration with the
confirmed report contract.

The former root library was consolidated into `src/lib/`, which is required by
the API and sketch. Unused autonomy and triage implementations and their
isolated tests were removed after checking imports. Calibrated triage and
graduated autonomy remain future work; the active flow uses deterministic zone
scoring and human-approved actions. `src/lib/report.ts` remains the shared
input envelope used by the scenario adapter.

| Document                                      | Status                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Report intake contract](input-contract.md)   | Confirmed contract; `POST /api/signals` durably stores HappyRobot `normalized_report` Signals in Supabase before interpretation; public form intake pending. |
| [Input architecture](input-architecture.md)   | Current ingestion behavior and migration boundaries.                                                                                                         |
| [Data model](data-model.md)                   | Canonical proposal, not the deployed schema; replaces the duplicate in `thoughts/`.                                                                          |
| [Database migration](../supabase/migrations/) | Implemented SQL files; application to a development database remains pending.                                                                                |

## Product and design context

- [Product source of truth](<../HackSpain 2026 · Project Source of Truth.md>):
  vision, Sierra Bermeja scenario and demo script.
- [Open decisions](../thoughts/open-questions.md): confirmed choices and blockers.
- [Feature inventory](../thoughts/features.md): historical implementation and
  porting reference; use current source and TASKS.md for present status.

The architecture review distinguishes the served runtime, reusable modules
awaiting integration, and external services awaiting configuration.

## Development tooling

- [Contributing](../CONTRIBUTING.md): local checks and pull requests; no CI.
- [Graft](code-index.md): required code navigation and index maintenance.
- [Shared skills](agent-skills.md): vendored guidance and upstream provenance.
- [Context7](context7.md): optional library documentation tooling.

Frontend handoff: [input/output examples and integration](coordinator-frontend-integration.md).

Parent integration: [persisted plan mutation tool](parent-plan-tool.md).
