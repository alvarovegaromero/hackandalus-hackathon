# Features built and how they work

Inventory of what was built in the `feat/crisis-command-center` branch
(Next 15, state in memory) and that must be transferred on the scaffolding of
`main` (Next 16, Supabase, Vercel Workflow, AI SDK). Each section says what the module does, what functions it exports, how it is verified and what is still missing. It is
written for those who have to reimplement it without having seen it.
Reference figures when freezing the branch: 266 tests in 10 files, typecheck and
clean lint, zero vulnerabilities in production, 16 domain modules, 12
API routes, 14 interface components.
---

## Module map

| Module                         | Responsibility                                                | File                                                      | Tests                                    |
| ------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Types                          | Contract between modules                                      | `lib/types.ts`                                            | —                                        |
| Orchestrator                   | Status, replanning, audit, down payments                      | `lib/store.ts`                                            | `tests/store.test.ts` (12)               |
| Priority                       | What comes first and why                                      | `lib/priority.ts`                                         | `tests/priority.test.ts` (49)            |
| Resources                      | Where the media goes and who waits                            | `lib/resources.ts`                                        | `tests/resources.test.ts` (14)           |
| Contacts and escalation        | Who is notified, by what channel, what is requested           | `lib/contacts.ts`, `lib/escalation.ts`                    | `tests/integration.test.ts` (32, shared) |
| HappyRobot                     | External execution and callbacks                              | `lib/happyrobot.ts`, `app/api/webhooks/happyrobot/`       | `tests/integration.test.ts`              |
| Triage                         | Act, verify or discard with probability                       | `lib/triage.ts`                                           | `tests/triage.test.ts`                   |
| Assumptions                    | When to throw away the plan                                   | `lib/assumptions.ts`                                      | `tests/assumptions.test.ts` (18)         |
| Autonomy                       | What it does alone and what requires permission; waiting list | `lib/autonomy.ts`                                         | `tests/autonomy.test.ts`                 |
| Scenario                       | The crisis advances alone                                     | `lib/scenario.ts`, `app/api/scenario/`                    | `tests/scenario.test.ts` (27)            |
| Persistence, history, learning | Survive the reboot and learn                                  | `lib/persistence.ts`, `lib/history.ts`, `lib/learning.ts` | `tests/persistence.test.ts` (32)         |
| Validation and API             | Secure input, consistent errors                               | `lib/validation.ts`, `app/api/**`                         | `tests/api.test.ts` (17)                 |
| Interface                      | See, understand, intervene                                    | `app/page.tsx`, `app/components/`                         | manual verification with browser         |

The rule that made it possible to build it in parallel: **each module has a single
owner and `store.ts` orchestrates without deciding**. On Supabase, that rule
translates into "each module writes only its own tables".

---

## 1. Orchestrator (`store.ts`)

Maintains state and delegates every decision to the modules. What it does itself is coordination:

- **Replanning** with context: before mutating, capture areas, resources and
  integration; then calls `buildPlan` and `diffPlans` with the before and the
  afterwards, so that the diff can say "Sierra Morena goes to critical" and not
  only position changes.
- **Audit**: every mutation leaves an entry with an actor
  (`system | operator | happyrobot | scenario`), plan type, summary and version.
- **Sweep stuck actions** (`sweepStalledActions`): an action in
  course that passes `stalledAfter` (90 s) goes to `stalled`, releases its resource and
  replans. It runs on every poll (`pollSituation`).
- **Discard reverts**: marking a signal as false undoes its effect
  exact information about the area (risk, status, need) and the actions are canceled
  that only existed because of her. It is compared by derived category, not by
  record, because only the first signal that introduces a need is recorded.
- **Resource guard on approval**: if the action resource is no longer available
  available, the action goes to `blocked` **before** calling outside. Without
  This alerted someone that a non-existent resource was on its way.
- **Late response does not step on the operator**: `approveAction` captures the`attempt` when dispatching; if when the response returns the action is no longer in
  `running` with that same attempt (they canceled or retried), the response
  is discarded.
- **Execution shutdown** (`closeRun`): when stopping the scenario or restarting the
  demo, save the `RunRecord` and recalculate learned weights.Restart is what
  the thing clicked most often in a demo; without this all learning was lost.
- **Honest Demo Injectors**: "resource down" chooses a resource from which
  some live action depends on;"integration failure" chooses an action in flight,
  never one already completed.
  **About the scaffolding**: what is here a singleton in memory becomes
  transactions on Supabase within Workflow steps. The logic of
  coordination is the same; the "state" is the database.

---

## 2. Priority (`priority.ts`)

Formula, all deterministic and with a breakdown that exactly adds up the score:

```
score = base risk
      + live signals
      + population at risk
      + open needs
      + down resources
      - relief from completed actions
```

Weight of a live signal: `severity x credibility x repetition x decay` .

- Severity: low 8, medium 28, high 70, critical 160.
- Credibility: trust (0.4 / 0.75 / 1.0) multiplied by a punishment if not
  is confirmed (0.3 / 0.6 / 0.85).Confirmed, without punishment.
- Repetition: `min(1,8; 1 + ln(occurrences) · 0,4)` .Five repetitions
  they reinforce ×1.64, not ×5.
- Decay: `0,5^(edad_min / vida_media)`, with half-life 6/12/25/45 min
  according to severity, and floor 0.3 confirmed / 0.05 unconfirmed. A signal from 12:00
  weighs less at 12:20.
- Stacked with diminishing returns by zone: the nth signal counts
  `1/(1 + 0,75·n)`, ceiling 200.
- Relief: 20 per completed action, half-life 20 min, buffered and limited
  at 50% pressure.Failed and pending actions do not relieve pressure.
  Exports `buildPlan`, `scoreZone`, `explainZone`, `signalWeight`,
  `credibilityFactor`, `occurrenceFactor`, `decayFactor`, `liveEventsForZone`,
  `defaultPriorityWeights` .`buildPlan` accepts an optional seventh parameter
  `{ now, weights }` for deterministic tests and learned weights.
  **Measured**: eight noise signals (low/low, unconfirmed) raised the highest zone
  calm from last to second place (143 points);now it ranks fourth (40).
  Completing an action lowered the score by 0 points;now it goes down 20.
  **Pending**: incorporate vulnerability multiplier and time to
  damage (variables V and t from the source document formula). The data model
  It already has both columns in `incidents`.

---

## 3. Resources (`resources.ts`)

Score 0–100 with weights exported as `WEIGHTS`:

| Weight | Factor             | How                                                                                            |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------- |
| 45     | Technical capacity | `capabilities` versus the need derived from the objective; covering the main need is worth 0.7 |
| 25     | Proximity          | Euclidean distance between zone coordinates; same zone = 1; no base = 0.6                      |
| 15     | Sufficiency        | `capacity` versus one unit per 100 people, only in capacities that scale with population       |
| 10     | Availability       | `available` 1, `assigned` 0, `unavailable` always excluded                                     |
| 5      | Channel fit        | Communications add up if the action goes out through a messaging channel                       |

Hard rules: a resource that does not meet any need is not a candidate for
| however close it is;`unavailable` is never chosen; one `assigned` alone is expropriated |
| If there is no alternative **and** the new area is more urgent than the current one. |
| Exports `selectResourceForAction` , `assignResource` , `releaseResource` , |
| `reassignAffectedActions` , `resolveResourceConflicts` (returns |
| `{ allocations, waiting, summary }`, the answer to "three ambulances and five |
| sites"), `rankResourcesForAction` (complete ranking with reason for discarding |
| candidate), `explainUnassignable` , `actionNeeds` , `zoneUrgency` , |
| `distanceBetweenZones` . |
| **Measured**: when the Seville health unit fell, the |
| Sierra Morena forestry brigade (first in the array). Now that brigade remains |
| discarded due to incompatibility and the Granada health unit enters with |
| reason: "INFOCA Sierra Bravo is closer but does not cover triage." |
| **Important detail**: the word "coordinate" was removed from the table |
| needs because the orchestrator writes all the objectives as "Coordinate |
| response from...", and turned the communications link into a universal wildcard. |

---

## 4. Contacts and escalation (`contacts.ts`, `escalation.ts`)

- `rankContacts` scores role appropriate to the category (with alias es/en and
  accent normalization), zone deployment, `responsiveness`, and
  `contactStats` learned.
- `selectChannelWithReason` combines urgency, contact preferences, bias
  by role and `channelStats` . In practice: the coordinator gets a call, the
  volunteer or neighbor is sent SMS or WhatsApp, the authority gets a written message.
- `briefingForRole` generates different `headline / detail / askFor` per role. The
  `askFor` is what closes the loop: whatever responds enters as a new signal.
- `buildEscalationChain` produces 3–4 steps without repeating person: who is
  in the area through the most direct channel → another useful role → coordination room →
  written authority.`waitSeconds` 90s urgent, 180s normal, +15s per
  step`isStepOverdue` and `describeChain` for the interface.
- `canReceiveLiveAction`: `demoSafe` **and** usable phone or email.
  `isUsableDestination` discards markers like `[phone omitted]` which leaves
  persistence when writing personal data.
  **Pending**: The chains are built and displayed but **not executed
  step by step**, because there is no long-lasting runtime that waits and advances. It is
  exactly what Vercel Workflow provides.`advanceChain` , `satisfyChain` and
  `isStepOverdue` are ready.

---

## 5. HappyRobot (`happyrobot.ts`, webhook)

The actual contract is not verified against private documentation, so
everything doubtful is configurable by environment with the current default value:
`HAPPYROBOT_ACTION_PATH`, `HAPPYROBOT_AUTH_HEADER`, `HAPPYROBOT_AUTH_SCHEME`,
`HAPPYROBOT_IDEMPOTENCY_HEADER`, `HAPPYROBOT_PAYLOAD_SHAPE` (`flat | wrapped |
trigger`), `HAPPYROBOT_RESPONSE_ID_PATH`, `HAPPYROBOT_CHANNEL_MAP`,
`HAPPYROBOT_WORKFLOW_ID`, `HAPPYROBOT_TIMEOUT_MS`, `HAPPYROBOT_MAX_ATTEMPTS`,
`HAPPYROBOT_RETRY_BASE_MS` . On demo day we edit `.env.local`, not code.

- `AbortController` per attempt;exponential backoff **only** in 5xx, network and
  timeout;a 4xx is never retried;an illegible 2xx response is not given
  successful.
- `HappyRobotError.kind`: `missing-credentials | timeout | client-error |
server-error | network | unreadable-response`, with a useful message for the
  operator.
- **Safeguard**: even in `happyrobot` mode, it is only truly called if
  `canReceiveLiveAction(contact)` . If not, downgrade to simulation with
  `externalActionId = mock-not-approved-<id>` and explains it. The six contacts
  seed contacts have `demoSafe: false` and without data: today it is impossible for it to come out
  nothing outside, and there is a test that proves it.
- Webhook `POST /api/webhooks/happyrobot`: mandatory secret with
  `timingSafeEqual` ; without secret configured responds 503. Accept
  `externalActionId, localActionId, status, summary, newInformation[]` . Each
  `newInformation` enters as signal (`source: happyrobot`) and replans.
  Idempotence by `x-happyrobot-delivery-id` or SHA-256 from body, cache 15
  min: a redelivery returns the same with `duplicate: true` .
  **Activate actual execution**: confirm contract → credentials in `.env.local` →
  `HAPPYROBOT_WEBHOOK_SECRET` shared with HappyRobot → register a
  contact `demoSafe: true` with explicit permission → only then
  `ACTION_EXECUTION_MODE=happyrobot` .

---

## 6. Calibrated triage (`triage.ts`)

Tres salidas con umbrales configurables (0,85 y 0,5 por defecto):

- p high → `act` .
- intermediate p → `verify` : generates a check action with two or three
  closed questions (`buildVerificationRequest`).Verifying is acting, not
  wait.
- low p → `discard`, with saved reason.
  `assessSignal` derives `pRelevant` , `pTruthful` , `urgency` and `confidence` from
  severity, declared trust, source and its reliability, confirmation,
  repetitions and coherence with other signals in the area.`fuseConfidence`
  applies `C = 1 − ∏(1 − p_i · r_i)` only between **independent** sources: two
  signals from the same source do not multiply.`updateSourceReliability` learn
  with a minimum of samples and limited movement.
  `SignalAssessor` interface with the deterministic engine as implemented by
  default implementation and room for Jev and for an LLM with a structured output. Access to Jev
  is confirmed; the deterministic remains the always available fallback.
  **Pending**: Latch onto orchestrator signal input. The module
  is complete;nothing calls it yet.

---

## 7. Live assumptions (`assumptions.ts`)

- `deriveAssumptions(plan, zones, resources, world, actions)`: between three and
  six assumptions that come from real decisions in the plan. If a resource crosses
  a road, the assumption is that it is still open;if an action goes out by SMS,
  that SMS works;if prioritized by wind, the direction of the wind.
- `checkAssumptions(assumptions, world, event?)` : what is still standing, what is
  broken and why. A broken assumption is not broken twice or resurrected alone.
  Use `unknown` when data is no longer available, instead of pretending it's still fine.
- `applyEventToWorld(world, event)` : an `route-blocked` signal adds the
  road to `blockedRoads` ;a wind change updates `windDirection`.
  Pure, no mutation.
- `explainInvalidation`: control-room text.Real example: "The plan
  v3 is no longer valid: it was assumed that the wind would continue from the northeast over
  Sierra Morena, and just turned. The order of priorities no longer holds..."
- `consequencesOfBreak` : which actions stop making sense.
  **Pending**: engage in replanning. It is the climax of the demo (the
  jury turns the wind, the plan turns red) and it is built but not
  connected.

---

## 8. Graduated autonomy and opportunity cost (`autonomy.ts`)

| Action type                     | Reversibility | Level                                                 |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| Verify a fact                   | reversible    | automatic                                             |
| Notify a person in charge       | reversible    | automatic with warning                                |
| Assign or move a resource       | reversible    | automatic with warning, undoable                      |
| Mass notice to the population   | partial       | automatic only with confidence ≥ 0.9;if not, approval |
| Order evacuation                | irreversible  | always approval                                       |
| Request external reinforcements | irreversible  | always approval                                       |

- `classifyAction` deduces the type from the target (the category is the
  useful signal).
- `decideAutonomy` returns level and reason;when in doubt, the most conservative;
  an unclassified action falls into approval;`autonomyPaused` strength
  approval in everything.
- `canAutoDispatch` : the one-line watchdog that is queried before executing
  without asking. If information is missing, `false` .
- `buildWaitingList(actions, resources, zones)` : wraps
  `resolveResourceConflicts` and returns `WaitingDemand[]` with estimated wait.
  **Pending**: Hook up automatic dispatch in the orchestrator and publish the
  waitlist in state ( `waiting` exists in type, is initialized empty).

---

## 9. Scenario (`scenario.ts`, `app/api/scenario/*`)

- Real elapsed time clock: polling more does not speed up, polling less does not
  delay.
- **One beat per tick maximum.** Previously, 60 s without polling triggered all
  all overdue beats at once.Beats with more than 60 s delay and another later
  also due are skipped and are plotted in `skippedBeatIds`; the most
  recent is never omitted. After three minutes without looking, the system jumps to
  present instead of reproducing history.
- Real pause and resume;speed 0.25×–10× hot;order
  deterministic.
- Heartbeat on server (`ensureHeartbeat`, 5 s): the crisis advances although no one
  look at the screen.Handle in `globalThis` that clears the previous one, `unref()` ,
  off in tests and with `SCENARIO_AUTOTICK=0`. No duplicate timers.
- Three scripts: `wildfire-andalucia` (default, 6 beats at 20/55/90/125/
  160/200s), `blackout-guadalquivir` , `flood-guadalquivir` . They are chosen with
  `POST /api/scenario/start { scriptId, speed, restart }` .
  **Pending**: transfer the script to Sierra Bermeja (Estepona, Jubrique,
  Genalguacil, Benahavís, Los Pinares) and add the noise beat (forty
  messages, three relevant). On Supabase, the triggered beats will
  `scenario_beats` and the heartbeat to a Vercel cron or a Workflow step with
  wait.

---

## 10. Persistence, history and learning

**Persistence** ( `persistence.ts` , `CRISIS_PERSISTENCE=on` ): JSON files in
`.data/` with `{ schemaVersion, savedAt, payload }` envelope, atomic write
(temporary + rename), deferred (500 ms silence, maximum 4 s), final dump
in `process.on("exit")`.It discards the entire file if JSON is invalid,
truncated, different schema version or incorrect form, and starts with the
seed.`sanitizeState` puts phones and emails to `null` and filters text
free text. Tested with two real processes.
**History** (`history.ts`): `diffPlans(previous, next, context)` detects the
seven types of `PlanChangeKind` and writes for the screen: "Costa del Sol
advances Sevilla Hub and Sierra Morena", "The integration with HappyRobot is
failing", "Sierra Morena becomes critical".Sorted by importance,
cut to 12.
**Learning** (`learning.ts`): `buildRunRecord` summarizes the execution from the
state (idempotent);`weightsFromRuns` reconstructs weights from scratch by adding
executions.Sample minimums: channel 5 attempts, contact 4 warnings,
`unconfirmedPenalty` 3 runs and 8 verified signals.What does not reach
the minimum is not published.`explainWeights` returns `LearningInsight[]` in
Spanish, including what **does not** apply yet and why ("it takes 3
executions and there are only 2").
**About scaffolding**: file persistence disappears;history and
learning reads `domain_events` , `decisions` and `action_results` . The logic of
minimums and explanation are preserved as is.
---

## 11. Validation and API (`validation.ts`, `app/api/**`)

Single error shape:

```json
{
  "error": "Zone \"zone-nope\" does not exist…",
  "code": "unknown_reference",
  "details": [{ "field": "zoneId", "message": "…" }]
}
```

Codes: `cuerpo_invalido` 400, `json_invalido` 400, `cuerpo_vacio` 400,
`referencia_desconocida` 400, `tipo_contenido_no_soportado` 415,
`cuerpo_demasiado_grande` 413 (32KB), `no_autorizado` 401, `no_encontrado`
404, `conflicto` 409, `metodo_no_permitido` 405 with `Allow`, `error_interno` 500. All with `cache-control: no-store`.Strict Zod schemas: a misspelled field returns 400 instead of being lost.
Paths: `GET /api/situation` (uses `pollSituation` ), `POST /api/events` ,
`POST /api/events/:id/mark`, `POST /api/actions`, `POST /api/actions/:id/approve`,
`POST /api/actions/:id/status` (operator operations, **no** secret),
`POST /api/demo/inject`, `POST /api/demo/reset` (with `DEMO_API_TOKEN`),
`POST /api/scenario/{start,stop,tick}`, `POST /api/webhooks/happyrobot`.
`DEMO_API_TOKEN`: undefined in development, open;defined, header
`x-demo-token` , `Bearer` or `?token=` ;undefined in production, routes
deactivated.
Reusable helpers: `apiOk`, `apiError`, `apiErrorFromThrown`,
`methodNotAllowed`, `parseJsonBody`, `validarReferencias`, `autorizarRutaDemo`.

**Pending**: `POST /api/actions/:id/assign`, `POST /api/autonomy`, routes to
accept y rechazar lecciones. La interfaz ya los llama y avisa si no existen.

---

## 12. Interface (`app/page.tsx`, `app/components/`)

Hierarchy: header with plan version and mock/real badge → banners →
three-block hero (priority now, what has changed, 6 KPI) → bar
scenario with world state and landmarks → injectors → map with live markers
that open the zone detail → plan with diff and previous versions → tabs
(actions, signals, resources, contacts and escalation, audit).
What the operator can do: approve, retry, cancel, confirm or
discard signals, create action by hand, reallocate resource against ranking
complete with reasons for discarding, starting, stopping and accelerating the script, stopping the
live autonomy.Permanent stripe of honesty: "Real actions
executed: 0 · simulated: N".
Technique: 4s polling with JSON fingerprint to not repaint without changes;interface state outside the `situation` object to avoid losing tab or scroll;
`aria-label`, `role=tablist`, `aria-live`, `focus-visible`,
`prefers-reduced-motion` ;cuts at 980 and 640 px.
Components: `ActionQueue`, `AuditPanel`, `ChangeBar`, `ContactsPanel`,
`HeroSummary`, `NewActionForm`, `OperationsMap`, `PlanChanges`,
`ResourcePicker`, `ResourcesPanel`, `ScenarioBar`, `SignalsPanel`,
`ZoneDetail` .Four more written but **not connected**, for distribution
for the six-zone layout of the source document: `AgentStrip`, `ChaosBar`, `ContextPanel`,
`PriorityBoard` .
---

## Integration status when freezing

| Piece                                                                                        | State                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Priority, resources, contacts, escalation, HappyRobot, scenario, persistence, API, interface | Built, plugged in and verified                             |
| Calibrated triage                                                                            | Built and tested;**not plugged in** at signal input        |
| Living assumptions                                                                           | Built and tested;**not plugged in** in replanning          |
| Autonomy and waiting list                                                                    | Built and tested;**not plugged in** in dispatch            |
| Running escalation chains                                                                    | Ready functions; without runtime to advance them           |
| `assign`, `autonomy` routes, lessons                                                         | They do not exist; the interface calls them and warns them |
| Scenario in Sierra Bermeja                                                                   | Not done;continues in abstract areas of Andalusia          |
| Four components of the new distribution                                                      | Written, not imported                                      |
