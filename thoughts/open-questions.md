# Open decisions

Aligned with the current version of `HackSpain 2026 · Source of Truth del
proyecto.md`. Ordered by the phase each item blocks. Confirmed items are at
the end so nobody reopens them.

---

## Blocking phase 1 · Contracts

- [ ] **Separate ground truth from the Digital Twin in the schema.** The
  document requires the simulator to keep a hidden `world_state` that agents
  cannot read, with FARO rebuilding its own picture from signals only. The
  current data model has a single `world_state_versions`. Decide between two
  tables (`ground_truth_versions` owned only by `scenario`, and
  `infrastructure` as perceived state with confidence and evidence) or one
  table with an origin column. Without this, *time-to-truth* and *twin
  accuracy* cannot be measured.
- [ ] **Add `infrastructure` and `intelligence_tasks`.** These are the two
  new modules in the document and neither has a table yet. `infrastructure`:
  perceived state of roads, hospitals, shelters and communications, with
  capacity, confidence and linked evidence. `intelligence_tasks`: unknowns
  tied to active decisions, with decision impact, chosen source, verification
  launched and evidence obtained.
- [ ] **Impact and confidence as separate axes.** The document is explicit:
  criticality `I = G · log10(1+N) · V · 1/(1+t/15)` is **not multiplied** by
  confidence. `incidents` already has the five fields; decide whether
  `plan_priorities.score` stores only `I` with `C` alongside, and how the
  ranking orders (impact, time to damage and coverage; confidence decides how
  much to verify and which autonomy level is safe).
- [ ] **Five triage outcomes, not three.** The document moves from
  act / verify / discard to **act, prepare a response while verifying, verify
  urgently, observe, discard**, driven by the impact × confidence matrix.
  Widen the `triage_decision` enum and the Zod schema, and define what
  "prepare a reversible response" means in terms of actions.
- [ ] **Mass alerts to the population: always human approval.** This changes
  from the earlier confidence ≥ 0.9 threshold. FARO prepares audience,
  content, channel and evidence; a person approves. Update `autonomy_rules`
  and drop `confidence_threshold` for that action kind.
- [ ] **Coverage cost.** Before committing a resource, estimate which area is
  left worse covered, how much its ETA grows and what reserve is consumed.
  Decide the formula and where it lives: `unmet_demands` already has
  `accepted_risk` and `estimated_wait_minutes`; residual coverage per area is
  missing. Hourly cost becomes a secondary metric and never drives a critical
  decision.

## Blocking phase 2 · Minimal end to end

- [ ] **Primary AI model** for the coordinator and subagents. Undecided.
- [ ] **Real HappyRobot contract**: endpoint, authentication, idempotency
  header, body shape, where the external id comes back, channel naming. All
  configurable through the environment; still to confirm against the private
  documentation.
- [ ] **How call results arrive**: webhook, executions API, or both. This
  shapes the Workflow wait step.
- [ ] **HappyRobot verification agent**: which structured fields it returns
  (confirms smoke, direction, people, road, capacity) so the Workflow can turn
  them into evidence without free-text interpretation.

## Blocking phase 3 · Complete decision

- [ ] **Value of information.** How to estimate an unknown's decision impact:
  how much priority, assignment or plan would change if the fact were
  different. It needs an operational definition the code can compute without
  a model, even if the coordinator uses it to choose.
- [ ] **Best verification source.** Preference order: API or official source,
  sensor, deployed responder, call or SMS through HappyRobot. Decide how the
  availability of each route is modeled per unknown type.
- [ ] **At least one unknown resolved by Active Intelligence in the demo.**
  The document makes it a phase exit criterion. Pick which: whether the
  MA-8301 is open or closed, which decides whether the last bus goes to the
  campsite or the care home, is the document's own example.
- [ ] **Scenario noise.** Generate the forty messages when the beat fires, or
  pre-generate them as signals with a future timestamp so the burst can be
  inspected before the demo.

## Blocking phase 4 · Robust execution

- [ ] **Channel fallback order**: SMS → WhatsApp → voice → email, or another
  contact in the same organization. Confirm `contact_channels.priority`
  models it and who decides the hop: the Workflow or the `execution` module.
- [ ] **Confirmation timings**: re-call at 2 min without confirmation,
  reassign and alert the human at 4 min. Global parameters or per action kind.
- [ ] **Tickets**: actions with `kind = ticket`, or a dedicated `tickets`
  table with owner, status and confirmation time, as the document lists. If
  due dates and reassignment are needed, a table.
- [ ] **Channels enabled on the hackathon account** (voice, SMS, WhatsApp,
  email) and whether Spanish mobile numbers belonging to the jury can be
  called and texted.
- [ ] **Concurrent call and cost limits** on the HappyRobot account.
- [ ] **Jev requests-per-minute limits** on our account.

## Blocking phase 5 · Learning and polish

- [ ] **Digital Twin metrics**: *time-to-truth*, *twin accuracy*, false or
  stale state rate, uncertainty reduction after verification, *decision
  recovery time*. Decide where they are computed (the `learning` module,
  comparing the Twin against ground truth at run close) and how they show in
  the demo closing.
- [ ] **Context panel**: two columns, confirmed and unconfirmed or unknown.
  Each unknown with its impact on active decisions, the chosen source and the
  verification in progress.
- [ ] **Natural-language steering** ("prioritize the school", "do not use
  helicopter 2"). Marked "if time allows". The interpreter that turns text
  into a structured, visible constraint is missing.

## Security and data

- [ ] **Encrypt `contact_channels.address`** before loading the jury member's
  number.
- [ ] **Real time to the panel**: server-side relay with no operator
  authentication, or read policies for `authenticated` with a minimal login.
- [ ] **Repository license.** Undecided.

## Staging

- [ ] **Who voices the pitch and who operates.**
- [ ] **Pitch length and number of questions.** Ask on arrival.
- [ ] **Phone number of the jury member** who will play the mayor, and a plan
  B with a teammate in the audience.

---

## Confirmed, do not reopen

- **Scenario**: wildfire in the wildland-urban interface of Sierra Bermeja.
  Estepona, Jubrique, Genalguacil, Benahavís and the Los Pinares development.
  Care home with 45 residents, rural school, campsite of 120. Roads A-397,
  MA-8301, AP-7. Hospitals Costa del Sol and Serranía.
- **Name**: FARO.
- **User**: the control-room chief of 112 Andalucía. Everything in Spanish.
- **Stack**: TypeScript, Zod, Next.js, Vercel AI SDK, Vercel Workflow,
  Supabase PostgreSQL and Realtime, HappyRobot, Jev. Out: Convex, Python, a
  separate worker, Supabase Queues.
- **Golden rule**: if it does not show in the five-minute demo, it is not
  built.
- **The LLM proposes, the code validates.** Ranking, allocation and assumption
  checking are code.
- **Autonomy**: verify and notify, automatic; move resources, automatic with
  notice and undoable; mass alerts and evacuation, always a person.
