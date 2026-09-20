# Documentation

Start with the [project README](../README.md) for the prototype and local setup.
[PROJECT.md](../PROJECT.md) contains contributor rules;
[TASKS.md](../TASKS.md) tracks current scope and remaining work.

## Application and demo

| Guide                                         | Contents                                               |
| --------------------------------------------- | ------------------------------------------------------ |
| [Architecture](architecture.md)               | Current runtime and module boundaries                  |
| [Deployment](vercel-deployment.md)            | Vercel releases, demo access and recorded verification |
| [Resource Dispatch](resource-dispatch.md)     | HappyRobot setup, callbacks and outcome semantics      |
| [HappyRobot reference](happyDocumentation.md) | Provider API and workflow payloads                     |
| [Security](security.md)                       | Credentials and approved demo recipients               |
| [Landing](landing-integration.md)             | Routing, assets and isolated styles                    |
| [Dashboard design](dashboard-design-guide.md) | Visual and interaction conventions                     |
| [Wildfire drills](emergency-drills.md)        | Training workspace, notebook and reviewed lessons      |
| [Drill learning](drills-agent-learning.md)    | Offline evaluation, exports and limitations            |

## Runtime contracts

| Reference                                                   | Contents                                         |
| ----------------------------------------------------------- | ------------------------------------------------ |
| [Coordinator state v2](coordinator-state-contract.md)       | Persistent plan, priorities and finite inventory |
| [Frontend integration](coordinator-frontend-integration.md) | Dashboard state, mission reads and telemetry     |
| [Event telemetry](event-telemetry.md)                       | Event intake, SSE replay and reset               |
| [Input architecture](input-architecture.md)                 | HappyRobot normalization and compatibility path  |
| [Subagent execution](subagent-execution.md)                 | Mission execution and results                    |
| [Jev filter](jev-filter.md)                                 | Relevance schemas and configuration              |
| [Triage](triage.md)                                         | Deterministic impact formula                     |
| [Agent planning](agent-planning.md)                         | Standalone planning module and manual exercises  |

These module guides include earlier implementation stages. The active runtime is
described in [architecture](architecture.md); current dispatch behavior is defined
by [Resource Dispatch](resource-dispatch.md). Earlier standalone-worker and
mock-only handoff notes do not describe the deployed integration.

## Development and background

- [Contributing](../CONTRIBUTING.md), [Graft](code-index.md),
  [shared skills](agent-skills.md) and [Context7](context7.md).
- [Initial POC scope](poc.md) and [package contracts](poc-contracts.md):
  initial delivery references; consult the current runtime contracts for extensions.
- [Report input proposal](input-contract.md) and [data model proposal](data-model.md):
  design references, not a description of all deployed routes or tables.
- [Product vision](<../HackSpain 2026 · Project Source of Truth.md>) and
  [confirmed decisions](../thoughts/open-questions.md).

Database evolution is recorded in [migrations](../supabase/migrations/).
Older architecture drafts and the pre-integration feature inventory have been
removed; their history remains in Git.
