# Project Tasks

- [x] Five live-model subagent tool scenarios passed using the production agent/tools with isolated persistence; script: npm run subagents:try. No real contacts or Supabase writes.

## Person B: subagent execution

- [x] Implement reserved-mission handoff, durable worker/leases, scoped mock communication tools, results/activity and read-only APIs. See docs/subagent-execution.md.
- [x] Eight manual rollback scenarios passed on local PostgreSQL 18; no inventory mutation.
- [ ] Person A: integrate spawn tool, durable handoff and parent result consumption. Shared migration deployment, live model execution and FE cards remain pending.

## Integrated landing

- [x] Import the approved Far0 landing at `/`, with original branding and media.
- [x] Move the operator panel to `/dashboard`, isolate root layouts/styles and
      connect same-tab navigation in both directions. Redirect `/landing` to `/`.
- [x] Keep API/SSE routes unchanged and document provenance and maintenance in
      [landing integration](docs/landing-integration.md).

## Global coordinator contract v2

- [x] Define one refreshed prompt, event/5-second triggers, global priorities/plan and per-ambulance state in docs/coordinator-state-contract.md.
- [x] Implement per-vehicle persistence, global coordinator execution and serialized scheduling; migrate state endpoint. Frontend integration is assigned to its engineer; release disabled.
- [x] Add on-demand v2 scenarios: three live model cases and eight transactional SQL checks passed locally. Completion/resource-release inputs and real tools remain deferred.
- [x] Apply v2 migration to Supabase; eight live SQL checks passed with rollback. HTTP state v2/auth/retired routes and worker IDLE verified.

## Runtime cleanup

- [x] Remove Vercel Workflow, the Next.js plugin, unused execution scaffold and
      dependency overrides. Keep the legacy generated-route cleanup for existing
      checkouts. AI SDK and HappyRobot remain; the global coordinator uses a dedicated worker.

## 24-hour hackathon workflow

- [x] Disable pre-commit and remove tests from automatic check/push/PR validation.
      Existing tests remain available manually. Do not add or run more by default.
      Historical hook/test milestones below describe the earlier setup.

## Finite resource backend (v1 history; release now disabled)

- [x] Supabase inventory, state endpoint, atomic plan/allocation commit, explicit idempotent release and manual scarcity/SQL scripts implemented.
- [x] Apply resource migration to Supabase through SQL Editor; verify server REST access returns 200 with 10 available ambulances, zero allocations and revision 0.
- [x] Rerun three live P4 scarcity cases and eight transactional SQL cases in Supabase; all passed. Rollback preserved 10/10 availability and revision 0. Model and database exercised separately, not HTTP E2E.
- [x] Superseded by v2: intake queues durable coordinator input; state v2 is ready for frontend integration.

## Initial POC · active delivery scope

Scope agreed on 2026-09-19: [POC plan and package acceptance](docs/poc.md).
This section is the immediate implementation queue. The phases below retain
historical status and broader backlog; they are not extra POC prerequisites.
All package owners are unassigned; no implementation completion is implied.

- [x] Agree POC scope and document P0–P5 ownership boundaries and dependencies.
- [x] **P0/P5 — Finite resource contract:** [GET /api/state](docs/resource-state-contract.md),
      3-second polling, typed counters/allocations, 10 backend-owned ambulances
      and complete response fixture. Supersedes unlimited availability as target scope.
- [ ] **P5 — Connect resource state:** FE counters and polling; migrate map data
      and remove `/api/situation`. Backend inventory/read endpoint implemented.
- [x] **P3/P4 — Finite allocation:** persisted execution supplies finite inventory;
      typed ambulances, atomic allocation/idempotent explicit release implemented.
      Three live LLM scarcity scenarios and eight local SQL cases passed; two
      concurrent local reservations cannot oversubscribe. No live dispatch.
- [x] Define [POC package interfaces](docs/poc-contracts.md), identify existing
      input/SSE contracts at `e2579a9`, and specify adapter/extension boundaries.
- [ ] **P0 — Contracts/integration:** assign owners; freeze shared schemas and
      fixtures from the POC contract; implement persistence, recovery and authorized
      snapshot; reuse the input branch's SSE envelope, cursors and reset behavior.
- [ ] **P0/P1 — Existing input port:** integrate input/SSE from `e2579a9` into
      `src/`, preserve wire compatibility, adapt to `NormalizedReport` and prevent
      legacy projection from executing alongside the new agent for the same input.
- [ ] **P1 — Input/scenarios:** expose confirmed report intake, deduplicate
      deliveries, persist and schedule processing; publish demo scenario fixtures.
- [x] **P2 — Jev filter module:** shared request/result/P3 handoff validators,
      Jev HTTP evaluation, relevant/irrelevant/uncertain/unavailable results,
      backend outcome logs and contract/failure fixtures. See [integration](docs/jev-filter.md).
- [ ] **P0/P1/P2 — Connect filtering:** invoke P2 from persisted report processing,
      persist decisions and route relevant and uncertain reports to P3/agent;
      retain irrelevant reports and log unavailable results without forwarding them.
- [x] **P2 — Manual live smoke run:** `npm run jev:try`, 10 synthetic cases,
      10 expected routes and valid output contracts on Windows (2026-09-19).
      This is on demand only; no hooks or automatic test integration.
- [ ] **P2 — Calibration:** broader labeled evaluation and threshold calibration;
      the small live sample does not establish accuracy or operational readiness.
- [ ] **P0/P5 — TBD filtering notifications:** after persistence, publish existing
      filtering telemetry to the frontend; P2 currently logs in the backend only.
- [x] **P3 — Triage module:** source-of-truth impact formula with initial
      vulnerability/time parameters, structured-factor contracts, missing-data
      handling and validated LLM handoff carrying Jev results and unlimited resources.
      See [P3 integration](docs/triage.md).
- [ ] **P0/P1/P3/P4 — Connect triage:** supply evidence-backed structured factors,
      persist impact and invoke the LLM for final priority/resource proposals.
- [x] **P3 — Manual formula/handoff scenarios:** `npm run triage:try`, 10/10
      passed on Windows; numeric examples, stable IDs, unknown factors, Jev
      uncertainty and invalid input/context. No provider calls or automated tests.
- [x] **P4 — LLM planning module:** consume the validated P3 handoff and authorized
      history; return final priority, finite resource proposals, a versioned plan
      and an assistant audit message. See [P4 planning](docs/agent-planning.md).
      OpenCode Go/Luna live validation passed eight synthetic cases on Windows.
- [x] **P4 — OpenCode and mock execution:** explicit provider selection through
      Vercel AI SDK; bounded tool loop with simulated resource assignment and
      HappyRobot placeholder communications. No real dispatch or messages.
- [x] **P3/P4 — Manual exercise script:** `npm run llm:try` with eight synthetic
      scenarios, optional limit and dry run. Eight live LLM output contracts passed,
      zero service errors; all execution remained simulated. No hooks or automatic tests.
- [ ] **P4 — Agent/execution:** one agent and one HappyRobot operation;
      persist messages, plans and outcomes; respect intervention and replan.
- [x] **P2/P3/P4 — Manual backend integration:** `npm run llm:try -- --with-jev`,
      9/9 expected routes and output contracts with live Jev/OpenCode and mock
      actions on Windows. [Scope and gaps](docs/poc-backend-smoke.md): HTTP intake,
      durable processing and frontend integration are not covered by this run.
- [ ] **P5 — Frontend:** reports, decision/activity history, agent messages,
      current objective/action/result and approval or pause; recover on reconnect.
- [ ] Demonstrate the complete acceptance sequence in docs/poc.md, including
      an approved real interaction; record local verification and tested OS.

Full plan UI, subagents, current asset incident effects on priority, advanced
resource optimization and full Twin integration are deferred beyond this POC.
SSE is the selected POC delivery path; earlier Realtime tasks below are deferred
alternatives, not a requirement to implement both transports.

## Phase 1 · Base Scaffolding Completed

- [x] TypeScript repository with Next.js App Router and React.
- [x] npm, lockfile, and commands for dev, build, lint, typecheck, and tests.
- [x] Shared event and plan schemas with Zod.
- [x] Coordinator prepared with Vercel AI SDK and configurable model.
- [x] Initial durable execution scaffold (subsequently removed; scheduler TBD).
- [x] Zero-credential command center with event intake and action review;
      obsolete standalone scaffolding dashboard retired.
- [x] Supabase server and browser clients; Realtime subscription helper.
- [x] Initial migration for incidents, events, resources, plans, actions, and outcomes.
- [x] Deny-by-default RLS enabled in schema, no public data access.
- [x] HappyRobot integration boundary explicitly returning `blocked`.
- [x] `.env.example`, README, and agent instructions updated.
- [x] Initial scaffold validated locally; current checks cover command-center,
      platform and hook suites via `npm run check`.
- [x] Historical simulation validation of the now-removed execution scaffold.
- [x] Reviewed dependencies: clean vulnerability audit after adjustments.

The served dashboard uses the in-memory command-center backend, without an integrated background agent scheduler. Local JSON persistence is optional.
The migration is written but unapplied; Supabase clients and the Realtime helper
are prepared but not connected to the dashboard. Live model calls and real external
communications have not been tested.

## Local Code Quality Setup

- [x] Remove GitHub Actions CI: no Actions minutes are available and CI is not planned.
- [x] Require local validation before PR creation via `npm run pr:create` and its
      local `pr:check` prehook (`npm run check`); document the workflow for contributors and agents.
- [x] Shared Prettier, EditorConfig, and LF endings in Git across macOS, Windows, and Linux.
- [x] Husky installed automatically during development dependencies installation.
- [x] Pre-commit hook running Secretlint, Prettier, and ESLint on staged files, plus TypeScript and tests.
- [x] Pre-push hook with full verification including build.
- [x] Blocking private files and detecting known key/token formats.
- [x] PROJECT.md as single source of truth, referenced by AGENTS.md and CLAUDE.md.
- [x] Local blocking of direct commits and pushes to protected branches.
- [x] Documented naming, formatting, and verification commands.
- [x] Unified branches and PR targeting main; agents authorized to merge on explicit user instruction.
- [x] CONTRIBUTING.md guide, PR template, and shared editor settings.
- [x] References to PROJECT.md from Codex/AGENTS, Claude, Cursor, and other coding agents.

## UI Modernization and User Experience

- [x] Tailwind CSS v4 setup with `@tailwindcss/postcss` and `@theme` tokens.
- [x] shadcn/ui-inspired primitives (`Button`, `Badge`) and `cn` utilities (`clsx` + `tailwind-merge`) in `src/components/ui/` and `src/lib/utils.ts`.
- [x] Clean design blueprint application: system typography (SF Pro on Apple) with `-0.15px` letter spacing, neutral grey hierarchy (`#292929`, `#5D5D5D`, `#9E9E9E`), 16px radius cards, and pill-style buttons.
- [x] Interactive tactical map with React Leaflet and OpenStreetMap layer (no API keys required) centered on Sierra Bermeja, with fire perimeter scaling with wind speed, A-397 and MA-8301 road overlays reflecting simulation closures, accessible markers, tactical/regional view toggle, and automatic fallback to schematic if tiles fail.

## Shared Development Skills

- [x] Add the official TypeSafe/Jev, AI SDK, and Workflow skills with pinned
      revisions, file hashes, and shared usage guidance.
- [x] Document optional Context7, Playwright, and Supabase MCP recommendations.
- [x] Pin Graft as development dependency and document local index and queries.
- [x] Require Graft in agent instructions and PR checklist; generate and verify index in commit and push hooks.
- [x] Include skills for React/Next.js, Postgres/Supabase, UI review, and visual design.
- [x] Record upstream revisions, references, licenses, and usage guide for the team.
- [x] Link skills from PROJECT.md for agents without auto-discovery.

## Phase 2 · Decisions and Configuration, for Later

- [x] Select crisis scenario and changes injected during demo:
      Sierra Bermeja wildfire with three chaos events (wind shift, A-397 closure, SMS outage). Details in source document and `thoughts/open-questions.md`.
- [ ] Define available resources, priority rules, and allocation policies.
- [ ] Select AI provider/model and configure AI Gateway credentials.
- [ ] Set up Supabase project and apply migration in development.
- [ ] Finalize HappyRobot operations, authentication, and callbacks.
- [x] First inbound HappyRobot slice: authenticated `/api/signals`, durable raw
      `normalized_report`, transport idempotency, FARO-owned Event interpretation,
      and reuse of the active planning/Digital Twin/dashboard flow.
- [x] Reconcile the deployed development `public.signals` table (created earlier
      from the `docs/data-model.md` proposal, missing the durable receipt columns)
      with `src/lib/signals/repository.ts` via
      `supabase/migrations/202609190002_reconcile_signals_schema.sql`, preserving
      existing rows. Verified against the real development database:
      `POST /api/signals` persists and processes a report, the resulting Event
      reaches the Digital Twin/plan/actions/audit trail in `/api/situation`, its
      `event.accepted` record appears on `/api/telemetry`, and a duplicate
      delivery of the same report is idempotent end to end (single DB row,
      single Event, single action, single audit entry).
- [ ] Agree on demo recipients and test resources for external validations.

Open decisions do not block the foundational scaffolding and must not be resolved with invented values.
The full list, sorted by blocking phase, is in [thoughts/open-questions.md](thoughts/open-questions.md);
construction phases (contracts, minimal end-to-end, full decisioning, robust execution, learning, rehearsal)
are in the source document.

## Phase 3 · First Connected Vertical

- [x] Batch ingestion with event deduplication (Milestone A in `docs/input-architecture.md`), optional persistence in Supabase.
- [ ] Connect the scenario report adapter to the future agent processor.
- [ ] Persist plans, actions, and outcomes in Supabase.
- [x] Prevent duplicate external actions during retries: `src/lib/happyrobot.ts` adapter sends idempotency key per dispatch/attempt and webhook caches processed deliveries.
- [ ] Integrate history and live resource availability into decisioning.
- [ ] Add operator authentication and per-incident RLS policies.
- [x] Connect command-center dashboard to its HTTP backend.
- [ ] Connect dashboard to Supabase Realtime subscriptions.
- [ ] Persist pause, cancellation, and human overrides, honoring them during execution.
- [ ] Add AI SDK tools and subagents based on agreed operations.
- [x] HappyRobot adapter with timeout, retries, and shared-secret authenticated webhook (`src/lib/happyrobot.ts`, `src/app/api/webhooks/happyrobot`), aligned with the public SDK contract (`POST /workflows/{id}/runs`, `run_id`) and the FARO workflow trigger params. See `docs/happyDocumentation.md`.
- [x] Webhook accepts the `dispatch_result` and `public_alert_result` payloads produced by the FARO workflows; the Inbound Reporter `normalized_report` enters through the durable `POST /api/signals` slice.
- [ ] Replace the `BLOCKED` terminal nodes of the five FARO workflows with Webhook nodes posting to a public FARO URL (`/api/signals`, `/api/webhooks/happyrobot`) with the shared secret; publish to `development` first.
- [ ] Enable `enhanced_security` (API key) on the Dispatch and Public Alert webhook triggers.
- [ ] Poll `GET /runs/{run_id}` as a fallback when no callback arrives; today a live action stays `running` until the webhook fires.
- [ ] Decide the SMS provider for Public Alert and Inbound SMS (Telnyx number is not toll-free; no Twilio credentials).
- [ ] Run one live dispatch against an approved demo recipient and record the result.
- [ ] Select and implement background execution, waits, retries and recovery.
- [x] Demonstrate replanning when situation changes mid-execution:
      self-advancing scripts, chaos fault injection, and plan version diffs in command center.
- [x] Digital twin, initial release: `src/lib/digitalTwin.ts` reconstructs perceived world from signals and measures accuracy against simulated ground truth; displayed in `src/components/DigitalTwinPanel.tsx`.
- [ ] Digital twin, second release: simulate variants (wind, road cuts, resource loss) on state clones, compare alternative outcomes, and present recommendations before acting.
- [ ] Test resource constraints, failures, and human oversight.
- [x] Publish the UI manually to Vercel: https://faro-lovat-iota.vercel.app/dashboard (2026-09-19). Landing, dashboard and map HTTP checks passed; `/api/state` remains 503.
- [ ] Configure remote application credentials, database access and agent execution before claiming a working hosted agent demo.
- [x] Prepare manual Vercel build settings, disable Git auto-deployments and document environment prerequisites and agent hosting limits in `docs/vercel-deployment.md`.
- [ ] Add durable remote scheduling for coordinator recovery and subagent execution; web deployment alone does not run the subagent worker.
- [ ] Connect dashboard session authentication to `/api/state` before the remote demo; the current browser request lacks the token required in production.

## Vertical HTTP → backend → SSE

- [x] `npm run mock:events` script that sends events to `POST /api/events`.
- [x] In-memory acceptance, idempotency UUID and correlated telemetry.
- [x] `GET /api/telemetry` and the event log on `/dashboard`, with replay, reconnection and limits.
- [ ] TODO: save in Supabase; no adapter or migration in this vertical.
- [ ] Consume the pending handoff in filtering → triage → LLM, independent of the viewer.
- [ ] Port the old producers (scenario, demo and callbacks) to the common intake.

Contract and limits: [docs/event-telemetry.md](docs/event-telemetry.md).

## Phase 4 · Consolidation Post Command Center Merge

- [x] Unify the application under `src/app/`, `src/components/` and `src/lib/`.
      Retire the old scaffold UI, duplicate endpoint files and unwired UI components.
- [ ] Rename seed and default script to Sierra Bermeja (`src/lib/seed.ts`, `src/lib/scenario.ts` use "Sierra Morena" and `wildfire-andalucia`).
- [ ] Explain zone and resource changes between plans: helper `capturePlanContext` in `src/lib/store.ts` was not invoked and removed in cleanup; `diffPlans` currently compares current state with itself. Must capture snapshot before each replanning mutation.
- [ ] Scope `.data/` directory in `src/lib/persistence.ts` to prevent Turbopack from tracing the full project (warning in `npm run build`).
- [ ] Connect command center to Supabase following `docs/data-model.md`.

## Repository organization

- [x] Document the dashboard prototype status in developer guidance.
- [x] Remove the visible prototype banner and SKETCH page title at the team's request.
- [x] Remove unused `src/lib/autonomy.ts`, `src/lib/triage.ts` and their isolated tests;
      preserve the library modules used by the API, UI and report adapter.
- [ ] Implement and connect calibrated triage and graduated autonomy in the
      agreed backend; the removed prototype modules were never wired in.

- [x] Remove the unserved scaffolding dashboard, layout and duplicate styles.
- [x] Consolidate the data model proposal in `docs/data-model.md`, retaining
      the latest confirmed report intake decision.
- [x] Add a documentation index and correct persistence/learning status.
- [x] Set the served application metadata title to FARO.
- [x] Draft current and proposed architecture diagrams, distinguish confirmed
      decisions from proposals, and outline parallel ownership in
      [architecture review](docs/architecture-review.md).
- [ ] Validate architecture decisions A1–A7 and freeze shared Zod schemas and
      fixtures from [contracts v0](docs/contracts-v0.md) before parallel integration.
- [ ] Complete the English translation of runtime strings and corresponding
      test expectations; previous translation work left Spanish content behind.

## Ideas

- [ ] Extend digital twin as sandbox testing environment to compare alternatives prior to live action execution (see Phase 3 & 4).

## Report intake contract — confirmed, implementation pending

- [x] Fix the simple payload and normalization boundary in
      [docs/input-contract.md](docs/input-contract.md): text, optional location,
      trusted metadata, synchronous receipt and asynchronous interpretation.
- [x] Identify compatibility work for Luis's scenario bridge and batch ingestion.
- [x] Envelope schema (`src/lib/report.ts`) and scenario adapter (`signalToReport`),
      preserving scenario evidence and retry IDs.
- [ ] Public report validator and remaining channel adapters.
- [ ] Reconcile persistence and scheduling recovery, connect the processing consumer,
      and expose report intake in `src/app/`.
- [ ] Add a reporting form with optional GPS, incident pin or textual location.

## References

- [README.md](README.md): installation, commands, and current limitations.
- [PROJECT.md](PROJECT.md): development conventions, commands, and checks.
- [HackSpain 2026 · Project Source of Truth.md](<HackSpain 2026 · Project Source of Truth.md>):
  product vision, scenario, demo script, and phases.
- [thoughts/](thoughts/README.md): data model, feature inventory to port, and open decisions.
- [CHALLENGE.md](CHALLENGE.md): original challenge brief.
- [docs/architecture.md](docs/architecture.md) & [docs/security.md](docs/security.md):
  command center design decisions and security rules.
- [docs/input-architecture.md](docs/input-architecture.md): current ingestion,
  backend integration limitations, and migration milestones.
- [docs/input-contract.md](docs/input-contract.md): confirmed report payload and
  normalization contract; envelope and scenario adapter implemented.

## Coordinator dashboard integration

- [x] Poll persistent coordinator state; show overview, plan, ambulances and priorities.
- [x] Bridge durable Jev decisions into SSE with full current-run replay.
- [x] Route demo reports to the coordinator and add an atomic development reset RPC.
- [x] Apply migration 006; verify reset invariants in a rolled-back transaction.
- [ ] Verify the full live worker/UI flow.

- [x] Move POC processing into Next.js after intake, with independent filtering and
      two-second coordinator batching; preserve concurrent arrivals via migration 008.

- [x] Parent plan mutation tool prepared with revision checks, audit and preserved inventory. Six local SQL rollback cases passed. Shared deployment and Person A wiring remain pending; see docs/parent-plan-tool.md.

- [x] Add parent context tools for global state, mission results and activity; all scoped to the bound crisis. Existing model remains unchanged; Person A tool-loop integration remains pending.

## Spanish coordination, patrols and landing alignment

- [x] Request Spanish human-readable output from coordinator and subagents.
- [x] Add ten Policía and ten Guardia Civil patrols, validated allocations and reset.
- [x] Handoff coordinator missions to subagents and show current-run results in UI.
- [x] Match dashboard colors, typography and brand to the Far0 landing.
- [ ] Connect real HappyRobot workflow tools; explicitly deferred, no mock contacts added.

- [x] Enable acknowledged no-op communication tools for new dashboard missions; isolate execution in the communication adapter. Real HappyRobot integration remains pending.

- [x] Translate human demo reports into Spanish, preserving sensor payloads.
- [x] Add multi-event mission create/update/cancel, on-demand activations and parent replanning on mission results (migration 013).
- [ ] Real HappyRobot callbacks and durable restart recovery remain deferred.

- [x] Concise Spanish overview/plan and proactive evidence-based mission instructions.
- [x] Compact expandable mission rows; closed missions collapsed by default.
- [x] Follow newly received geolocated reports on the map with closer framing.
- [x] Keep resources assigned after communication missions complete (migration 015 supersedes automatic release in 014).

- [x] Continue mission handoff after stale update/cancel conflicts and replan from fresh context.
- [x] Distinct Policía/Guardia Civil icons in resource cards and map markers.
- [x] Initial dashboard skeletons for overview, plan, resources, missions, events and map; empty states follow successful loads.
