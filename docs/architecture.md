# Architecture and Decisions

For the proposed integrated architecture and contracts awaiting team validation,
read [Architecture review](architecture-review.md) and [Contracts v0](contracts-v0.md).
The decisions below describe the current sketch runtime; all-actions approval,
in-memory state and browser-driven ticking are not the confirmed target design.

> **SKETCH:** The dashboard is an exploratory prototype with demo scenario data
> and partially connected controls. It is not an approved product design or an
> operational emergency response system.

This document explains **why** the system is built this way. The _what_ is in the
README; here are the decisions and their trade-offs. This document describes
the served command center (`src/app/` and `src/lib/`). The reusable Workflow and batch ingestion modules are not connected to
that runtime; see [input-architecture.md](input-architecture.md)
and the [documentation index](README.md) before designing the combined architecture.

Context that shapes everything else: this is a weekend hackathon project,
written in parallel by multiple agents, and what is evaluated is a live demo lasting
a few minutes. Almost all decisions below represent a trade-off between "long-term
correct" and "demonstrable on Sunday without crashing."

---

## Overview

```
       signals                     decision                    execution
  ┌───────────────┐        ┌───────────────────┐        ┌────────────────┐
  │ POST /events  │        │ priority.ts       │        │ happyrobot.ts  │
  │ demo/inject   │ ─────► │ resources.ts      │ ─────► │ (single egress │
  │ scenario.ts   │        │ contacts.ts       │        │     point)     │
  │   (script)    │        │ escalation.ts     │        └───────┬────────┘
  └───────────────┘        └─────────┬─────────┘                │
                                     │                          │ webhook
                               ┌──────▼──────┐                   │
                               │  store.ts   │ ◄─────────────────┘
                               │  (state +   │   POST /actions/:id/status
                               │ orchestrates)
                               └──────┬──────┘
                                      │
                         ┌────────────▼────────────┐
                         │ GET /api/situation      │
                         │ src/app/page.tsx (polling)  │
                         │ human approves/cancels  │
                         └─────────────────────────┘
```

A core rule underpins the design: **`store.ts` maintains state and orchestrates, but does not make decisions**. Each decision lives in a specialized module that `store.ts` invokes.

---

## Decision 1 — State lives in memory, with optional JSON persistence

`src/lib/store.ts` stores the entire situation (signals, zones, resources, contacts,
actions, plans, audit log) in an object attached to `globalThis`. There is no
database.

**Why.**

- A database introduces another service to start, a schema to migrate, and an
  extra failure mode on demo day. None of those three things earn points in the
  challenge.
- The crisis lasts as long as the demo lasts. There is no requirement to persist
  state across sessions, except for the learning bonus.
- The entire state fits comfortably in memory: dozens of signals, zones,
  resources, and actions. Rebuilding the entire plan on every change is simpler
  and faster than maintaining incremental indices, and eliminates an entire class
  of out-of-sync state bugs.
- `globalThis` instead of a standalone module with state because Next hot-reloads
  modules during `npm run dev`: without `globalThis`, the situation would reset
  itself every time someone saved a file in the middle of the demo.

**The trade-offs.**

- With persistence disabled, state is lost when restarting the server. `POST /api/demo/reset`
  exists precisely to return to the starting point intentionally.
- Does not survive multiple server instances. There is no horizontal deployment,
  so this does not matter.
- Tests share state within a process, which is why `tests/` calls
  `resetSituation()` in `beforeEach`.

**Persistence is optional and disabled by default.** `src/lib/persistence.ts` writes
plain JSON under `.data/` and only activates if `CRISIS_PERSISTENCE=on`. It uses
JSON files rather than SQLite to avoid native dependencies (compilation,
platform-specific binaries) in a project that must run on any team member's
laptop. Its functions must never throw: a full disk cannot crash the demo; at
worst, it might lose history.

The implementation validates versioned envelopes on load, redacts contact details,
debounces state writes and atomically replaces JSON files. Runs and learned
weights have separate files. Disk failures produce diagnostics and safe defaults;
`tests/persistence.test.ts` covers recovery and persistence behavior. This is
local storage, not durable shared storage for a multi-instance deployment.

---

## Decision 2 — Priority is deterministic, not decided by a language model

`src/lib/priority.ts` scores each zone with an explicit formula: zone base risk,
severity and confidence of live signals, whether they are confirmed, population
at risk, open needs, and unavailable resources. The output is a number and a
factor breakdown (`PriorityFactor[]`) that the interface displays as-is.

**Why not an LLM.**

1. **It is explainable.** The challenge asks: "does it know what comes first when
   everything seems urgent?". A number with its breakdown answers that in front of
   a jury; a generated paragraph does not. The UI can show _why_ a zone moved to
   first place, factor by factor.
2. **It is testable.** `tests/priority.test.ts` asserts that a confirmed critical
   signal takes precedence over initial priority. With a model behind it, that
   test would be flaky and would have to be relaxed until it tests nothing.
3. **It is reproducible in the demo.** The same script produces the same order
   however many times it is rehearsed. A model can change its mind between
   rehearsal and presentation.
4. **No added latency or external point of failure.** Replanning is synchronous
   and occurs on every state change: a model call in that path would mean
   second-long pauses and a new failure mode every time a signal arrives.
5. **Zero cost per replanning cycle.** The scenario replans dozens of times during
   a five-minute demo.

**Where a model does fit:** at the edges, not in the decision core. Classifying
free text from a call into `{zone, category, severity}`, or drafting the briefing
read to a contact. That is, turning language into structure, not deciding whom to
save first.

**The trade-offs.** Weights are tuned by hand and are debatable. This is
mitigated by showing the breakdown: if the jury disagrees with the priority, they
can at least see exactly what produced it and debate it.

---

## Decision 3 — All external actions require human approval

No action leaves the system on its own. The lifecycle is:

1. The system **proposes**: the action originates in `pending` state and appears
   in the interface queue with its objective, recipient, zone, and rationale.
2. A human **approves** (`POST /api/actions/:id/approve`).
3. Only then does `happyrobot.ts` execute, and the action transitions to `running`.
4. The result returns—via the response or the status webhook—and the action ends
   in `succeeded`, `failed`, `blocked`, or `stalled`.

**Why.**

- The challenge requires "a screen to understand the situation, see what the
  system is doing, and intervene when necessary." An approve button is the most
  direct way to make that intervention real rather than cosmetic.
- Live actions make phone calls, send messages, and open tickets for real people.
  In a simulated crisis during a hackathon, contacting the wrong recipient is a
  real incident, not a bug.
- Approval is the natural point where state becomes irreversible. Concentrating
  the check there leaves a single boundary to audit.

**Chained safeguards** (all must grant permission for anything to go out):

| Safeguard          | Where                                                | What it does                                                                                                                                                 |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Execution mode     | `getExecutionMode()`                                 | With `ACTION_EXECUTION_MODE` set to anything other than `happyrobot`, nothing leaves the process. This is the default.                                       |
| Credentials        | `isHappyRobotConfigured()`                           | Without an API key, base URL, and at least one workflow id, live execution fails with an explicit error instead of attempting partial dispatch.              |
| Approved recipient | `canReceiveLiveAction()` / `liveActionBlockReason()` | A contact without `demoSafe` **degrades the action to simulation** and explains why. In the current seed, all contacts are marked as not approved.           |
| Human approval     | `approveAction()`                                    | Nothing executes without human approval.                                                                                                                     |
| Idempotency        | `idempotencyKey = "<id>:<attempt>"`                  | Prevents duplicate alerts when retrying or receiving the same event twice.                                                                                   |
| Honesty in the UI  | `IntegrationState`, `simulated`, `mock-…` IDs        | Real and simulated actions are counted separately, and simulated actions carry the prefix in their identifier so that even logs cannot present them as live. |

**The trade-offs.** The system is not fully autonomous, which brushes against the
"decides and acts on its own" criterion. This is balanced by the rest: the system
decides, prioritizes, allocates resources, chooses contacts and channels, and
replans autonomously; it only asks for confirmation before touching the real world.
This is also the exact design a real crisis command center would require.

---

## Decision 4 — Modules with a clear owner

`src/lib/` is split by responsibility, and each file declares its owner on the first
line:

```ts
// OWNER: priority engine agent.
```

| Module           | Responsibility                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`       | Boundary between modules. Shared types and nothing else.                                              |
| `validation.ts`  | Input validation with Zod and unified error formatting across the entire API.                         |
| `store.ts`       | State and orchestration. Coordination; module agents do not edit this.                                |
| `priority.ts`    | Scores zones and builds the plan.                                                                     |
| `resources.ts`   | Selects, allocates, and releases resources.                                                           |
| `contacts.ts`    | Whom to notify, via which channel, and with what briefing.                                            |
| `escalation.ts`  | Escalation chains: what happens if the first contact does not answer.                                 |
| `digitalTwin.ts` | Digital twin: state perceived from signals, divergences, and accuracy against simulated ground truth. |
| `happyrobot.ts`  | Single egress point to the outside world.                                                             |
| `scenario.ts`    | The script that drives situation changes automatically.                                               |
| `history.ts`     | Plan history, version diffs, and audit trail.                                                         |
| `learning.ts`    | Weights learned from previous runs (bonus).                                                           |
| `persistence.ts` | Save and restore, optional.                                                                           |
| `seed.ts`        | Initial situation and scenario beats.                                                                 |

**Why.**

- Multiple agents write concurrently. Without file boundaries, two agents editing
  the same function would result in conflicts or, worse, silent merges that break
  functionality. A file with a single owner prevents these collisions.
- `types.ts` as a contract allows a module to be written against the _shape_ of
  another without depending on its internal implementation. Persistence uses
  those same shared types to validate and restore saved state.
- Concentrating orchestration in `store.ts` provides a single place to understand
  the complete cycle. When someone asks "what happens when a signal arrives?", the
  answer is in one file.
- Isolates risk: if a module breaks, it is clear where it happened and does not
  contaminate the rest.

**The trade-offs.** `store.ts` is the largest file and acts as a bottleneck for
cross-module changes. This is a deliberate trade-off: we prefer a single, large,
explicit coordination point over scattered coordination where nobody knows who
is in charge.

---

## Decision 5 — Browser polling, not WebSockets

`src/app/page.tsx` polls `GET /api/situation` periodically and re-renders. The
event log on `/` consumes `GET /api/telemetry` over read-only SSE; see
[event-telemetry.md](event-telemetry.md). It does not replace command-center polling
or share its side effects.

**Why.** State is small, the server is local, and a demo cannot tell the
difference between one-second polling and push. A WebSocket would add connection
management, reconnection logic, and a visible failure mode on screen right when
it matters most. Polling also self-heals: if a request fails, the next request
retrieves the full ground truth again.

**Side effect intended by the design:** polling acts as the system clock.
`GET /api/situation` calls `pollSituation()`, which advances the scenario
(`scenario.ts`) and sweeps stalled actions before returning state. The browser
advancing time by querying.

Because that would bind the script to having a tab open, `scenario.ts` also
maintains a server heartbeat (`ensureHeartbeat`) while the script runs, and
`POST /api/scenario/tick` allows advancing it manually from outside. Three
clocks for the same engine, because the demo clock cannot fail.

---

## Decision 6 — The scenario is scripted, but can be triggered manually

`src/lib/scenario.ts` plays scripts made of timestamped _beats_—there are three:
wildfire, blackout, and flood—the fire front advances, wind shifts, a road is cut,
a resource goes down. They can be started, paused, and accelerated via
`/api/scenario/*`. Additionally, UI buttons allow injecting any of these
disruptions on demand at any moment.

**Why both.** The script demonstrates that the system adapts without human
prodding—the "autonomously changing environment" criterion; the buttons allow
triggering the exact change the jury just asked about. Reproducible rehearsal
and interactive demo powered by the same underlying engine.

---

## What is implemented and what is not

| Component                                                              | Status                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| In-memory state, replanning, audit trail                               | Implemented                                                                                                                              |
| Deterministic priority engine with factor breakdown                    | Implemented                                                                                                                              |
| Resource allocation, contacts, escalation chains                       | Implemented                                                                                                                              |
| HappyRobot adapter with retries, timeout, and idempotency              | Implemented against the public SDK contract (`POST /workflows/{id}/runs`); live runs not yet exercised. See `docs/happyDocumentation.md` |
| Human approval and action queue                                        | Implemented                                                                                                                              |
| Input validation and homogeneous error responses across the entire API | Implemented                                                                                                                              |
| Self-advancing script with three scenarios and adjustable speed        | Implemented                                                                                                                              |
| Digital twin with accuracy, divergence, and uncertainty metrics        | Implemented                                                                                                                              |
| JSON persistence                                                       | Implemented, opt-in local JSON with validation, redaction and atomic writes                                                              |
| Cross-execution learning                                               | Implemented statistics and optional persistence; influences contact/channel selection, not zone priority scoring                         |
