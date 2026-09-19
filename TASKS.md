# Project Tasks

## Phase 1 · Base Scaffolding Completed

- [x] TypeScript repository with Next.js App Router and React.
- [x] npm, lockfile, and commands for dev, build, lint, typecheck, and tests.
- [x] Shared event and plan schemas with Zod.
- [x] Coordinator prepared with Vercel AI SDK and configurable model.
- [x] Example workflow with persistent steps and token-protected API.
- [x] Local zero-credential dashboard: events, proposal review, pause, and cancel.
- [x] Supabase server and browser clients; Realtime subscription helper.
- [x] Initial migration for incidents, events, resources, plans, actions, and outcomes.
- [x] Deny-by-default RLS enabled in schema, no public data access.
- [x] HappyRobot integration boundary explicitly returning `blocked`.
- [x] `.env.example`, README, and agent instructions updated.
- [x] Verified build, lint, TypeScript, and tests (7 tests across 2 files: domain and hook guards).
- [x] Tested local workflow to completion in simulation, validating 401/400 errors.
- [x] Reviewed dependencies: clean vulnerability audit after adjustments.

The dashboard is an in-memory browser simulation separate from the workflow.
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
- [x] shadcn/ui-inspired primitives (`Button`, `Badge`, `Card`) and `cn` utilities (`clsx` + `tailwind-merge`) in `app/components/ui/` and `lib/utils.ts`.
- [x] Clean design blueprint application: system typography (SF Pro on Apple) with `-0.15px` letter spacing, neutral grey hierarchy (`#292929`, `#5D5D5D`, `#9E9E9E`), 16px radius cards, and pill-style buttons.
- [x] Interactive tactical map with React Leaflet and OpenStreetMap layer (no API keys required) centered on Sierra Bermeja, with fire perimeter scaling with wind speed, A-397 and MA-8301 road overlays reflecting simulation closures, accessible markers, tactical/regional view toggle, and automatic fallback to schematic if tiles fail.

## Shared Development Skills

- [x] Pin Graft as development dependency and document local index and queries.
- [x] Require Graft in agent instructions and PR checklist; generate and verify index in commit and push hooks.
- [x] Include four skills for React/Next.js, Postgres/Supabase, UI review, and visual design.
- [x] Record upstream revisions, references, licenses, and usage guide for the team.
- [x] Link skills from PROJECT.md for agents without auto-discovery.

## Phase 2 · Decisions and Configuration, for Later

- [x] Select crisis scenario and changes injected during demo:
      Sierra Bermeja wildfire with three chaos events (wind shift, A-397 closure, SMS outage). Details in source document and `thoughts/open-questions.md`.
- [ ] Define available resources, priority rules, and allocation policies.
- [ ] Select AI provider/model and configure AI Gateway credentials.
- [ ] Set up Supabase project and apply migration in development.
- [ ] Finalize HappyRobot operations, authentication, and callbacks.
- [ ] Agree on demo recipients and test resources for external validations.

Open decisions do not block the foundational scaffolding and must not be resolved with invented values.
The full list, sorted by blocking phase, is in [thoughts/open-questions.md](thoughts/open-questions.md);
construction phases (contracts, minimal end-to-end, full decisioning, robust execution, learning, rehearsal)
are in the source document.

## Phase 3 · First Connected Vertical

- [x] Batch ingestion with event deduplication (Milestone A in `docs/input-architecture.md`), optional persistence in Supabase.
- [x] Forward scenario engine signals to agent workflow and display plans on dashboard.
- [ ] Persist plans, actions, and outcomes in Supabase.
- [x] Prevent duplicate external actions during retries: `lib/happyrobot.ts` adapter sends idempotency key per dispatch/attempt and webhook caches processed deliveries.
- [ ] Integrate history and live resource availability into decisioning.
- [ ] Add operator authentication and per-incident RLS policies.
- [ ] Connect dashboard to backend and Realtime subscriptions.
- [ ] Persist pause, cancellation, and human overrides, honoring them during execution.
- [ ] Add AI SDK tools and subagents based on agreed operations.
- [x] HappyRobot adapter with timeout, retries, and shared-secret authenticated webhook (`lib/happyrobot.ts`, `app/api/webhooks/happyrobot`). Live API contract remains unverified: see `docs/happyDocumentation.md`.
- [ ] Verify live HappyRobot contract and test an action with approved demo recipients.
- [ ] Add waits, retries, and failure recovery to workflow.
- [x] Demonstrate replanning when situation changes mid-execution:
      self-advancing scripts, chaos fault injection, and plan version diffs in command center.
- [x] Digital twin, initial release: `lib/digitalTwin.ts` reconstructs perceived world from signals and measures accuracy against simulated ground truth; displayed in `app/components/DigitalTwinPanel.tsx`.
- [ ] Digital twin, second release: simulate variants (wind, road cuts, resource loss) on state clones, compare alternative outcomes, and present recommendations before acting.
- [ ] Test resource constraints, failures, and human oversight (`tests/`).
- [ ] Configure and deploy to Vercel upon authorization.

## Phase 4 · Consolidation Post Command Center Merge

- [ ] Unify both trees. Next serves `app/` and ignores `src/app`:
      batch ingestion (`/api/events` with deduplication and Supabase), `/api/runs/<runId>`, `/api/scenario/signals`, workflow in `src/workflows/crisis.ts`, and `src/components` dashboard are only exercised in tests. Decide what to port to `app/`/`lib/` and what to retire.
- [ ] Rename seed and default script to Sierra Bermeja (`lib/seed.ts`, `lib/scenario.ts` use "Sierra Morena" and `wildfire-andalucia`) and title in `app/layout.tsx` to FARO.
- [ ] Explain zone and resource changes between plans: helper `capturePlanContext` in `lib/store.ts` was not invoked and removed in cleanup; `diffPlans` currently compares current state with itself. Must capture snapshot before each replanning mutation.
- [ ] Scope `.data/` directory in `lib/persistence.ts` to prevent Turbopack from tracing the full project (warning in `npm run build`).
- [ ] Connect command center to Supabase following `docs/data-model.md`.

## Ideas

- [ ] Extend digital twin as sandbox testing environment to compare alternatives prior to live action execution (see Phase 3 & 4).

## Report intake contract — confirmed, implementation pending

- [x] Fix the simple payload and normalization boundary in
      [docs/input-contract.md](docs/input-contract.md): text, optional location,
      trusted metadata, synchronous receipt and asynchronous interpretation.
- [x] Identify compatibility work for Luis's scenario bridge and batch ingestion.
- [x] Envelope schema (`lib/report.ts`) and scenario adapter (`signalToReport`),
      preserving scenario evidence and retry IDs.
- [ ] Public report validator and remaining channel adapters.
- [ ] Reconcile persistence and scheduling recovery, migrate the workflow consumer,
      and expose intake in root `app/` as part of route-tree consolidation.
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
  route-tree limitations, and migration milestones.
- [docs/input-contract.md](docs/input-contract.md): confirmed report payload and
  normalization contract; envelope and scenario adapter implemented.
