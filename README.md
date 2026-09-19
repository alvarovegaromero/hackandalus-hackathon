# FARO

**Start POC work here:** [scope and P0–P5 work packages](docs/poc.md) →
[module contracts v1](docs/poc-contracts.md) → [current tasks](TASKS.md).
These are mandatory implementation references under [PROJECT.md](PROJECT.md).

> **SKETCH:** The dashboard is an exploratory prototype with demo scenario data
> and partially connected controls. It is not an approved product design or an
> operational emergency response system.

Agentic command center for a wildfire in Sierra Bermeja (Málaga):
our submission for the HappyRobot crisis management challenge in HackSpain 2026. A single Next.js project deployable on Vercel; the npm package is named
`butterfish`. The product vision, scenario, and demo script are in
[HackSpain 2026 · Project Source of Truth.md](<HackSpain 2026 · Project Source of Truth.md>)
and the design context (data model, feature inventory,
open decisions) in [thoughts/](thoughts/README.md).

**Status.** The application is unified under `src/`. Next.js serves
`src/app/`, with sketch UI components in `src/components/` and the active
command-center backend in `src/lib/`. It includes the HTTP API, scripted
scenarios, human-approved actions and the digital twin. State lives in server
memory with optional local JSON persistence.

Reusable Workflow, AI SDK, Supabase, batch ingestion and Sierra Bermeja
scenario modules also live under `src/`, but are not connected to the served
command-center flow. The obsolete scaffold UI and duplicate route files have
been removed. Integrating these modules remains tracked in [TASKS.md](TASKS.md).

The scenario (wildfire in Sierra Bermeja) and name are confirmed; the seed and
default command center script still name Sierra Morena and updating this is tracked.
AI model selection, credentials, and live connections remain open: see [TASKS.md](TASKS.md)
and [thoughts/open-questions.md](thoughts/open-questions.md).

Development conventions and permissions are in [PROJECT.md](PROJECT.md).
`AGENTS.md` and `CLAUDE.md` point there to avoid duplicate rules. To join
the team, follow [CONTRIBUTING.md](CONTRIBUTING.md). The repository
includes [shared skills](docs/agent-skills.md) for TypeSafe/Jev, AI SDK, Workflow, React/Next.js,
Postgres/Supabase, accessibility, and visual design. To index code after
`npm ci`, run `npm run index:build` and view the map with
`npm run index:map`; its use for code navigation is required
([Graft guide](docs/code-index.md)).

## HTTP events and SSE telemetry

Run `npm run mock:events` against `npm run dev` and watch each event at
the event log at <http://localhost:3000/> and in the backend log. `POST /api/events`
returns 202; `GET /api/telemetry` emits `event.accepted` and `filtering.pending`.
Storage is in memory, with a TODO for Supabase; filtering, triage and the LLM are
not connected to this flow. See [contract, authentication, replay and limits](docs/event-telemetry.md).

## Local Startup

Prerequisites: Node.js **26+** with its bundled npm;
`.nvmrc` pins `26`. `package.json` pins `npm@11.6.1` in `packageManager`
for Corepack users (`corepack enable`); it is optional. We use npm and
`package-lock.json`.

```powershell
npm ci
npm run dev
```

Open <http://localhost:3000>. No credentials are required: without configuration,
the system starts in `mock` mode and nothing is sent externally. State
attaches to `globalThis` to survive hot reloads and resets when the server
restarts; `POST /api/demo/reset` returns to initial state. For a second
instance without build directory conflicts:
`NEXT_DIST_DIR=.next-dev npm run dev -- -p 3001`.

| Command                             | Description                                                      |
| ----------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                       | Development server on port 3000.                                 |
| `npm run build` / `npm start`       | Production build and server.                                     |
| `npm run lint`                      | ESLint across the entire repository.                             |
| `npm run typecheck`                 | Next route types and `tsc --noEmit`.                             |
| `npm test`                          | Single-pass Vitest: `tests/`, `src/`, and `scripts/`.            |
| `npm run format` / `format:check`   | Prettier: format or check only.                                  |
| `npm run check`                     | Secrets, formatting, lint, types, tests, build, and Graft index. |
| `npm run env:setup`                 | Creates `.env.local` from `.env.example` if missing.             |
| `npm run index:build` / `index:map` | Builds and queries the Graft code index.                         |

`package.json` pins two indirect dependencies of Workflow via `overrides`
(`nanoid` and `undici`) to patched versions. Check if these remain necessary
when updating Workflow.

## Formatting and Local Hooks

`npm ci` installs Husky hooks via `prepare`. Git and Node/npm must be on PATH;
on Windows, Git for Windows provides the shell.

- **Pre-commit:** blocks commits on protected branches and private files like
  `.env.local` or private keys. `lint-staged` checks secrets, applies Prettier,
  and runs ESLint (warnings treated as errors) on staged files. Then it runs
  TypeScript, tests, and `npm run index:verify`.
- **Pre-push:** blocks updates to `main`, `master`, and `develop`, and runs
  `npm run check`, including the full build.
- **Before creating a PR:** use `npm run pr:create -- --title "..." --body-file <file>`.
  Its local `pr:check` prehook runs `npm run check` and blocks creation on
  failure. Requires authenticated GitHub CLI (`gh`), a clean working tree, and
  an already published feature branch; the command targets `main` and does not push.
- **No CI:** GitHub Actions is removed and will not be used because the team has
  no Actions minutes. Validation is local. All contributors and agents must use
  the PR command; GitHub's UI and direct `gh pr create` bypass the local hook.
  Include check results and the tested OS in the PR.

We share UTF-8, LF endings, two spaces, double quotes, semicolons, and trailing
commas via `.prettierrc.json`, `.editorconfig`, and `.gitattributes`.
Naming: camelCase for variables and functions, PascalCase for components and
types, kebab-case for application files, and UPPER_SNAKE_CASE for environment
variables. Commit messages are written in English.

Secretlint detects known credential formats and masks values in output.
`.env.example` templates are also scanned: only empty values or harmless placeholders
are permitted. No scanner detects every secret.

## Architecture

### Command Center (Served Application)

```
      signals                    decision                    execution
  ┌───────────────┐        ┌───────────────────┐        ┌────────────────┐
  │ POST /events  │        │ priority.ts       │        │ happyrobot.ts  │
  │ webhook       │ ─────► │ resources.ts      │ ─────► │  (single exit  │
  │ demo/inject   │        │ contacts.ts       │        │     point)     │
  │ scenario.ts   │        │ escalation.ts     │        └───────┬────────┘
  └───────────────┘        └─────────┬─────────┘                │
                                     │                          │ callback
                              ┌──────▼──────┐                   │
                              │  store.ts   │ ◄─────────────────┘
                              │ state +     │
                              │ orchestrate │
                              └──────┬──────┘
                                     │
                        ┌────────────▼────────────┐
                        │ GET /api/situation      │
                        │ dashboard (polls 4s)    │
                        │ human approves/cancels  │
                        └─────────────────────────┘
```

`src/lib/store.ts` maintains state and orchestrates, but does not make domain decisions: each
decision lives in a specialized module declaring its owner in the first line
(`// OWNER: …`). Priority is calculated by an explainable formula, not a language
model.

| File                                                                  | Responsibility                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/lib/types.ts`                                                    | Shared types; the contract between modules.                                    |
| `src/lib/store.ts`                                                    | Crisis state and lifecycle orchestration.                                      |
| `src/lib/validation.ts`                                               | Body validation with Zod and uniform error formatting.                         |
| `src/lib/priority.ts`                                                 | Zone scoring and plan construction.                                            |
| `src/lib/resources.ts`                                                | Resource selection, assignment, and release.                                   |
| `src/lib/contacts.ts`, `src/lib/escalation.ts`                        | Contact notification, channel selection, and escalation chains.                |
| `src/lib/assumptions.ts`                                              | Plan assumptions and world-state updates.                                      |
| `src/lib/digitalTwin.ts`                                              | Digital twin: perceived world from signals vs simulated ground truth accuracy. |
| `src/lib/happyrobot.ts`                                               | HappyRobot adapter; the single outbound communication point.                   |
| `src/lib/scenario.ts`, `src/lib/seed.ts`                              | Scenario scripts driving crisis progression and initial state.                 |
| `src/lib/history.ts`, `src/lib/learning.ts`, `src/lib/persistence.ts` | History and plan diffs, learned statistics, optional JSON storage.             |
| `src/app/page.tsx`, `src/components/`                                 | Operator dashboard.                                                            |
| `src/app/api/`                                                        | HTTP API surface.                                                              |

The rationale behind these decisions is detailed in [docs/architecture.md](docs/architecture.md).

### Platform Base (`src/`)

| Route                                     | Responsibility                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/domain.ts`                       | Zod-validated events and plans                                         |
| `src/lib/ingest.ts`, `ingest-server.ts`   | Batch event ingestion with deduplication and optional Supabase storage |
| `src/lib/scenario`, `src/lib/signals`     | Sierra Bermeja scenario engine and signal schemas                      |
| `src/lib/agents/coordinator.ts`           | Structured planning with Vercel AI SDK                                 |
| `src/workflows/crisis.ts`                 | Persistent crisis planning workflow                                    |
| `src/lib/supabase`, `supabase/migrations` | Clients, Realtime subscription, and default-deny RLS schema            |

The `@/` alias resolves to `src/` in both
TypeScript and Vitest. Ingestion design is in
[docs/input-architecture.md](docs/input-architecture.md) and the proposed data
model in [docs/data-model.md](docs/data-model.md). The obsolete platform
dashboard has been removed; its scenario engine, ingestion modules and Workflow
remain available for integration. See the [documentation index](docs/README.md)
for the distinction between current behavior and proposals.

## The Demo

1. Start with `npm run dev` and open the dashboard.
2. Start the crisis scenario with `POST /api/scenario/start`. The script emits
   events autonomously: the wildfire advances, wind shifts, a road is
   blocked, a resource becomes unavailable. You can accelerate (`{"speed": 4}`) or pause
   (`POST /api/scenario/stop`) without losing state.
3. Watch dynamic replanning: every signal increments the plan version, and the dashboard highlights
   what changed compared to the previous plan and why.
4. Trigger chaos manually via demo buttons (new incident, blocked road, resource down, integration failure).
5. Intervene: approve an action in the queue (only then does it execute), cancel another, retry a failed action, or confirm/discard an ambiguous signal.
6. Close the loop by simulating a callback via `POST /api/webhooks/happyrobot`:
   the action status updates and the information reported by the contact enters as a
   new signal triggering replanning.
7. Reset with `POST /api/demo/reset` before the next demonstration run.

The default script is `wildfire-andalucia` and its seed names Sierra Morena;
updating this to Sierra Bermeja is tracked in [TASKS.md](TASKS.md).

## API Surface

JSON responses without caching. Errors always follow the format
`{ "error", "code", "detalles": [{ "campo", "mensaje" }] }` with stable
codes (`cuerpo_invalido`, `referencia_desconocida`, `no_encontrado`,
`conflicto`, `no_autorizado`, `metodo_no_permitido`, `error_interno`).
Unsupported methods return `405` with the `Allow` header.

| Endpoint                          | Body                                                                                             | Description                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `GET /api/situation`              | —                                                                                                | Complete state: signals, zones, resources, plan, history                   |
| `POST /api/events`                | `{ id?, source?, title?, description?, zoneId?, category?, severity?, confidence?, confirmed? }` | 202: accepts in memory, publishes telemetry and updates the command center |
| `GET /api/telemetry`              | —                                                                                                | Read-only SSE; recent history and cursor reconnection                      |
| `POST /api/events/:id/mark`       | `{ confirmed }`                                                                                  | Confirms or discards a signal                                              |
| `POST /api/actions`               | `{ channel, target, objective, reason, zoneId, resourceId?, contactId? }`                        | Creates a pending action awaiting approval                                 |
| `POST /api/actions/:id/approve`   | —                                                                                                | Human approval; only then does execution occur                             |
| `POST /api/actions/:id/status`    | `{ operation?: "cancel" \| "retry", status?, externalActionId?, error? }`                        | Cancels, retries, or updates action status                                 |
| `POST /api/webhooks/happyrobot`   | callback                                                                                         | Requires `x-happyrobot-secret`; `503` if unconfigured, `401` on mismatch   |
| `POST /api/scenario/start`        | `{ scriptId?, speed?, restart? }`                                                                | Starts or resumes scenario script (`speed` between 0.25 and 10)            |
| `POST /api/scenario/stop`         | —                                                                                                | Pauses scenario preserving elapsed time                                    |
| `POST` / `GET /api/scenario/tick` | —                                                                                                | Manual scenario advancement / read-only status poll                        |
| `POST /api/demo/inject`           | `{ kind?: "incident" \| "resource-down" \| "route-blocked" \| "integration-failure" }`           | Injects a simulated fault                                                  |
| `POST /api/demo/reset`            | —                                                                                                | Resets to initial baseline state                                           |

Channels: `call`, `sms`, `email`, `ticket`, `webhook`, `whatsapp`, `slack`.
Action statuses: `pending`, `approved`, `running`, `succeeded`, `failed`,
`blocked`, `cancelled`, `stalled`. Routes under `/api/demo/*` are protected with
`DEMO_API_TOKEN` (via `x-demo-token` header, `Authorization: Bearer …`, or
`?token=`); without token they are open in development and disabled in production.

## Environment Variables

All variables live in `.env.local` (ignored by Git); `npm run env:setup` creates it
from `.env.example`, which contains the fully documented list. Never commit credentials to the
repository; see [CONTRIBUTING.md](CONTRIBUTING.md) for sharing guidance.

| Variable                                                                                                                               | Purpose                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTION_EXECUTION_MODE`                                                                                                                | `mock` (default): nothing leaves the local process. `happyrobot`: live execution.                                                          |
| `HAPPYROBOT_API_KEY`, `HAPPYROBOT_BASE_URL`, `HAPPYROBOT_AGENT_ID`, `HAPPYROBOT_WORKFLOW_ID`                                           | Credentials for live execution.                                                                                                            |
| `HAPPYROBOT_ACTION_PATH`, `_AUTH_HEADER`, `_AUTH_SCHEME`, `_IDEMPOTENCY_HEADER`, `_PAYLOAD_SHAPE`, `_RESPONSE_ID_PATH`, `_CHANNEL_MAP` | Configurable contract, unverified against live API ([docs/happyDocumentation.md](docs/happyDocumentation.md)).                             |
| `HAPPYROBOT_TIMEOUT_MS`, `HAPPYROBOT_MAX_ATTEMPTS`, `HAPPYROBOT_RETRY_BASE_MS`                                                         | Per-attempt timeout, retry attempts (5xx, network, and timeout only), and backoff.                                                         |
| `HAPPYROBOT_WEBHOOK_SECRET`                                                                                                            | Shared secret for callback webhook.                                                                                                        |
| `DEMO_API_TOKEN`                                                                                                                       | Protects `/api/demo/*`.                                                                                                                    |
| `CRISIS_PERSISTENCE`                                                                                                                   | `on` persists state as JSON under `.data/`. Disabled by default.                                                                           |
| `CRISIS_API_TOKEN`, `AI_GATEWAY_API_KEY`, `AI_MODEL`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, `SCENARIO_AGENT_ENABLED`        | Platform base (`src/`): workflows API, AI Gateway, Supabase, and scenario→agent bridge. Only active in tests until trees are unified.      |
| `SUPABASE_DIRECT_DB_URL`, `SUPABASE_POOLER_DB_URL`                                                                                     | Server-side Supabase CLI connection URIs for migrations. Encode special characters in passwords; never expose or use them in browser code. |

Without model or key, the coordinator under `src/` uses a deterministic decision
marked as `simulation`; with both set, it uses AI SDK. If one is missing, it fails
explicitly.

## Live Execution with HappyRobot

By default, nothing leaves the system. For an action to reach a recipient,
all of the following conditions must be met simultaneously:

1. `ACTION_EXECUTION_MODE=happyrobot`.
2. `HAPPYROBOT_API_KEY`, `HAPPYROBOT_BASE_URL`, and `HAPPYROBOT_AGENT_ID`
   are present; if any is missing, the adapter fails listing the missing keys.
3. The recipient is marked safe for demo (`demoSafe`) and has a phone or email.
   In the initial seed, no contact is marked demoSafe.
4. A human operator explicitly approved that specific action from the dashboard.

Safeguards: if the recipient is not approved, the action executes in mock
mode and explains why; simulated external IDs carry the prefix `mock-…`
and integration status tracks live vs mock actions separately; every dispatch
includes an idempotency key `<action>:<attempt>` and the webhook remembers processed
deliveries for 15 minutes; 4xx errors are not retried; if HappyRobot does not respond,
the action transitions to `failed` and replanning accounts for that failure.
Before executing live actions, read [docs/security.md](docs/security.md) and obtain
explicit approval for the specific recipients and actions.

## Supabase and Vercel

The migration in `supabase/migrations` is prepared for manual application
via the SQL Editor of a development project; it is not applied automatically.
Tables have RLS enabled and deny browser access by default. Before connecting
the dashboard, operator authentication and per-incident policies are needed.
The full model is documented in [docs/data-model.md](docs/data-model.md).

To deploy, import the repository into Vercel as a Next.js project with
Node.js 24.x and `npm ci` / `npm run build`; `withWorkflow` is configured in
`next.config.ts`. Add required environment variables in Vercel and deploy when
authorized by the team.

The build cleans stale Workflow-generated routes from `app/.well-known/` before
Next.js runs. The command center lives in `src/app/`; Next.js otherwise gives a
stale root `app/` directory precedence and serves no dashboard route. Vercel
also excludes that generated directory from manual CLI uploads.

## Tests

`npm test` runs 16 test suites: `tests/` covers the command center (priority,
resources, assumptions, persistence, digital twin, routes,
and simulated adapter callbacks), `src/` covers ingestion and the scenario engine,
and `scripts/hooks.test.ts` covers hook guards. Command center tests share the
process and call `resetSituation()` in `beforeEach`.

## Documentation

For the initial implementation, follow [POC scope](docs/poc.md) and
[module contracts v1](docs/poc-contracts.md). The broader
[architecture review](docs/architecture-review.md) and [contracts v0](docs/contracts-v0.md)
remain proposals for later product work and do not add POC prerequisites.

| Document                                                                               | Contents                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [CHALLENGE.md](CHALLENGE.md)                                                           | Challenge brief and scoring criteria.                         |
| [PROJECT.md](PROJECT.md)                                                               | Conventions, permissions, and repository map.                 |
| [TASKS.md](TASKS.md)                                                                   | Completed and deferred work, including tree unification.      |
| [docs/architecture.md](docs/architecture.md)                                           | Command center design decisions and trade-offs.               |
| [docs/security.md](docs/security.md)                                                   | Credentials, webhook secret, and demo recipients.             |
| [docs/happyDocumentation.md](docs/happyDocumentation.md)                               | HappyRobot notes and unverified API contract details.         |
| [docs/data-model.md](docs/data-model.md), [thoughts/](thoughts/README.md)              | Supabase data model, feature inventory, and design decisions. |
| [docs/input-architecture.md](docs/input-architecture.md)                               | Batch event ingestion architecture.                           |
| [docs/dashboard-design-guide.md](docs/dashboard-design-guide.md)                       | Dashboard visual and design guide.                            |
| [docs/code-index.md](docs/code-index.md), [docs/agent-skills.md](docs/agent-skills.md) | Graft code index and shared agent skills.                     |

## Planned report intake

The [confirmed input contract](docs/input-contract.md) accepts text and optional
GPS or textual location, distinguishes reporter from incident location, and
normalizes all channels before triage. The server supplies crisis identity and
provenance. Receipt waits for persistence and durable scheduling; interpretation
runs asynchronously. This contract is not implemented yet; the current API and
backend integration limitations above still apply. Luis's scenario engine and batch
orchestration are retained through adapter migration.

## License

MIT. See [LICENSE](LICENSE).
