# Documentation map

Start with [the project README](../README.md) for setup and
[PROJECT.md](../PROJECT.md) for shared rules. [TASKS.md](../TASKS.md) tracks
implementation status; [CHALLENGE.md](../CHALLENGE.md) defines the requirements.

## Current application

Next.js serves `app/`; `lib/` implements the command center and `tests/` covers
it. The dashboard polls the HTTP API. State lives in memory, with optional local
JSON persistence. Outbound communications default to mock mode.

| Document                                      | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| [Architecture decisions](architecture.md)     | Served runtime, module responsibilities and trade-offs.  |
| [Security](security.md)                       | Credentials, operator approval and demo recipients.      |
| [HappyRobot contract](happyDocumentation.md)  | Integration notes; live API contract remains unverified. |
| [Dashboard design](dashboard-design-guide.md) | Visual and interaction guidance.                         |

## Contracts and integration work

The reusable platform modules remain under `src/lib/` and `src/workflows/`.
Endpoint candidates in `src/app/api/` are **not served** while root `app/` exists.
Their contracts must be reconciled before moving them into the active API;
the two `/api/events` implementations accept different payloads.
The obsolete platform dashboard, layout and styles have been removed.

| Document                                      | Status                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [Report intake contract](input-contract.md)   | Confirmed target contract; envelope and scenario adapter implemented, public intake pending. |
| [Input architecture](input-architecture.md)   | Current ingestion behavior and migration boundaries.                                         |
| [Data model](data-model.md)                   | Canonical proposal, not the deployed schema; replaces the duplicate in `thoughts/`.          |
| [Database migration](../supabase/migrations/) | Implemented SQL files; application to a development database remains pending.                |

## Product and design context

- [Product source of truth](<../HackSpain 2026 · Project Source of Truth.md>):
  vision, Sierra Bermeja scenario and demo script.
- [Open decisions](../thoughts/open-questions.md): confirmed choices and blockers.
- [Feature inventory](../thoughts/features.md): historical implementation and
  porting reference; use current source and TASKS.md for present status.
- [Scenario engine design](superpowers/specs/2026-09-19-scenario-engine-design.md):
  design rationale for the reusable engine, not proof of a served integration.

The next architecture diagram should distinguish the served runtime, reusable
modules awaiting integration, and external services awaiting configuration.

## Development tooling

- [Contributing](../CONTRIBUTING.md): local checks and pull requests; no CI.
- [Graft](code-index.md): required code navigation and index maintenance.
- [Shared skills](agent-skills.md): vendored guidance and upstream provenance.
- [Context7](context7.md): optional library documentation tooling.
