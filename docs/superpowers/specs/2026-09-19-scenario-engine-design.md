# Plan: input model and scenario engine (FARO, Sierra Bermeja)

## Context

FARO reasons only over evidence, never over the simulator's ground truth (Source of Truth, "Crisis Digital Twin").
Today the repo has a generic `crisisEventSchema` and an in-memory demo, with no hidden world, no scripted chaos and no noisy signals.
This work adds the `scenario` and `signals` modules so later branches (triage, Twin, planner, HappyRobot, panel) have a realistic, reproducible input to build on.

Scope (confirmed): contracts + engine, ending at a stream of validated `Signal`s.
Out of scope: triage, incidents/Twin, Supabase persistence, HappyRobot calls, panel wiring, new API routes.
Existing `crisisEventSchema`, `simulatePlan`, dashboard and workflow stay untouched (they coexist).

## Decisions (confirmed with the user)

- Noise: deterministic Spanish templates with a seeded PRNG. No LLM, no network.
- Clock: pure virtual clock. The engine is a pure function of simulated time; whoever calls it (test, tick endpoint, Workflow) decides when.
- Persistence: in memory behind a small `ScenarioStore` port, so Supabase can be plugged in later.
- Ground truth: scripted keyframes per variable, no physical fire model.
- Location: lat/lon (fictitious points on real geography) plus a place name and accuracy radius.
- Chaos: every chaos and extra event is a timed `ScenarioEvent`; the panel button only fires one by id (once).
- Noise types: duplicates/rewordings, hoaxes, wrong or contradictory testimony, delay and loss.
- Channels: citizen call (transcript), inbound SMS, sensor/API, verification/responder reply.
- Includes `probe(question, source, t)` so FARO's verification calls are answered from the ground truth.
- Crisis-agnostic: the wildfire is only the first scenario pack. The engine and contracts know nothing about fires, so a flood (DANA), blackout or other crisis is a new pack (data + templates), not an engine change.
- Branch: `feat/scenario-engine` from `main`, local only. No push without explicit permission.

## Design

Identifiers in English, signal text in Spanish. Time unit: crisis minutes (`atMin`); the clock converts wall time with a configurable ratio (default 10 crisis min per real minute), so the demo timeline T+0..T+7 maps to 0..70.

### Files (new, under `src/lib/`)

| File | Responsibility |
| --- | --- |
| `signals/schema.ts` | Zod `Signal`: `id`, `channel` (`citizen_call` / `sms` / `sensor` / `verification`), `sourceId`, `receivedAtMin`, `location {lat, lon, accuracyM, placeName}`, `body` (discriminated union: `text` or sensor `reading {metric, value, unit}`). Nothing about truth. |
| `scenario/world.ts` | Generic Zod `GroundTruth`: a map of `Fact`s, each `{ id, kind, entityId, location, value }` with `value` a string, number or boolean, plus `Keyframed<T>` with `valueAt(t)`. `kind` is a free string owned by the pack (e.g. `wind_direction`, `road_status`, `sms_provider`, `headcount`; a flood pack would use `river_level`, `underpass_status`). |
| `scenario/pack.ts` | `ScenarioPack` contract every crisis implements: places, initial facts, sources with hidden reliability, `ScenarioEvent` timeline, and Spanish message templates per fact `kind` and channel. Validated by Zod at load time. |
| `scenario/packs/sierra-bermeja.ts` | First pack (wildfire), pure data. Later crises live beside it as `packs/<name>.ts`. |
| `scenario/events.ts` | `ScenarioEvent { id, atMin, kind: scheduled / chaos / noise_burst, effect }`. Effects are generic: set a fact value or emit a burst about facts. The wildfire chaos (wind to SW, A-397 closed, SMS provider down, +50 at camping) is pack data using these effects. |
| `scenario/noise.ts` | Seeded PRNG (mulberry32) and the four noise transforms, working on facts and pack templates only: duplicate/reword, hoax (signal about a fact that does not exist), wrong (states a value different from truth), delay/drop. |
| `scenario/engine.ts` | `advance(state, toMin)` returns new state, emitted `LabeledSignal`s and fired events. `fire(state, eventId, atMin)` for manual injection. `probe(state, question, sourceId, atMin)`. |
| `scenario/clock.ts` | wall ms to crisis minutes, ratio configurable. |
| `scenario/store.ts` | `ScenarioStore` interface plus in-memory implementation. |

### Key invariants

- Hidden truth stays hidden: the engine returns `LabeledSignal { signal, label }`, where `label` (`genuine` / `duplicate` / `hoax` / `wrong` plus the fact it refers to) is for metrics only. The public export used by FARO strips it, and `Signal` has no field that can carry it.
- Deterministic: each event generates its signals from a PRNG seeded with `(seed, eventId)`, so replays, reordering and manual injection never change content.
- Idempotent: the fired-event set lives in state; advancing past an event twice, or injecting an already-fired one, emits nothing new.
- Chaos changes the truth, not the feed: e.g. "wind to SW" patches the world and then yields witness signals about it (some right, some stale or wrong), so FARO must detect it from evidence.
- `probe` answers from truth: reliable sources answer correctly, weaker sources with per-source error rate and delay. Returns a `verification` signal.
- Comms failure is just a fact (e.g. `sms_provider = down`) exposed for later execution/fallback work; the engine has no special case for it.
- No crisis vocabulary in `engine.ts`, `noise.ts`, `world.ts` or `signals/`: they may only reference facts, kinds and templates. Crisis words appear only in `packs/`.

### First pack: Sierra Bermeja wildfire (from the Source of Truth)

T+0 burst of about 40 signals (sightings, duplicates, one hoax, one sensor alert) over 3 real sub-incidents; T+3 wind to SW; T+4 A-397 closed; T+5 SMS provider down; T+6 +50 people at the camping. Order is configurable data, not code.

## Verification

Vitest, matching `src/lib/domain.test.ts` style, in `src/lib/scenario/*.test.ts` and `src/lib/signals/*.test.ts`:

- Same seed gives identical signals; different seed differs.
- `advance` is idempotent and monotonic; manual `fire` runs once.
- All scenario data and emitted signals parse with their Zod schemas.
- The public feed has no truth label; hoaxes have no matching fact in the world.
- Each chaos event patches the world at the right time; keyframes interpolate correctly.
- `probe`: reliable source is correct, unreliable source errs at the configured rate, deterministic per seed.
- T+0 burst yields about 40 signals with the expected duplicates and one hoax.
- Crisis-agnostic proof: a tiny second pack in tests (e.g. a flood with `river_level` and `underpass_status`) runs through the same engine and passes the same invariants, with no engine change.

Then `npm run lint`, `npm run typecheck`, `npm test`.

## Process notes

- Commits are local, small, in English, Conventional Commits (e.g. `feat: add signal schema`), no co-author trailer (global instruction).
- After approval: write the spec to `docs/superpowers/specs/2026-09-19-scenario-engine-design.md` from this plan, then start on `feat/scenario-engine`.
