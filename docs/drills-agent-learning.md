# Local drill learning and evaluation

This extension is a local training workspace, implemented with pure TypeScript.
It generates evidence for human review and an offline coordinator context fixture.
It does not call an LLM, run a worker, send a report to intake, write Supabase,
dispatch resources, send alerts, calibrate production policy or train model weights.

## Run the complete circuit

Use Node **24.x** and npm. No secrets or services are required.

```sh
npm ci
npm run check
npm run drills:try
npm run drills:try -- --demo-review --out .data/drills-learning-reviewed
npm run dev
```

Visit `/dashboard/drills`. Choose either hazard and an existing locality or a
custom name/coordinates. Open **Ad hoc conditions & objectives**, configure the
case, then run/pause/step, make decisions and complete the exercise. Replay
individual timeline entries and compare against no intervention. Download the
JSON report from the controls or Markdown, decision traces and candidate examples
from **Auditable learning outputs**. Review individual generated lessons using
their selectors before downloading **Reviewed context JSON**.

`drills:try` is an explicitly invoked verification/demo command, not a CI suite.
It writes synthetic examples, schemas, evaluation and verification results under
the ignored `.data/` directory. The default leaves every lesson unreviewed and
produces empty retrieved context. `--demo-review` adds a clearly marked
`synthetic-review-fixture` approval of the generated access lesson to demonstrate
the full circuit. It does **not** claim a human approved those examples.

To consume an actual browser report reviewed by a facilitator:

```sh
npm run drills:try -- --run /path/to/faro-drill-report.json --out .data/reviewed-drill
```

This validates and replays the report before export. It never executes imported
text. Do not use `--demo-review` when documenting real human review. The command
always generates the two demonstration runs as well; filenames include UUIDs.
The imported report must be a **completed model 3** run. Browser report import
is not implemented; offline consumption is through this command.

## Model 3 and scenario 1

New runs use model 3. The existing notebook key/envelope remains
`faro.emergency-drills.v1`. Models 1 and 2 retain their previous code paths,
instant/delayed arrivals, phase team replenishment and historical export schema 2.
Model 3 exports use schema 3 and require `scenario`, `policyVersion`,
`teamBusyMinutes`, service `reservations` and decision `observation`.
No old run is silently upgraded. The unchanged renderer sees the original
three sectors, phases, mission fields and props.

`src/lib/drill-scenario.ts` is the executable scenario schema. Generated
`scenario.schema.json` is its machine-readable equivalent.

| Field                                 | Domain / effect                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`                             | Literal 1                                                                                                                          |
| `seed`                                | Integer 0–4294967295; stable integer hash varies initial risk by −4…+4 and new-mission travel by 0…0.5 min in 0.125-min increments |
| `careShare`                           | 0.1–0.4 of population; residential share is 0.75 minus care share; centre receives the rounding remainder                          |
| `careTravelMultiplier`                | 1–2; multiplies care-sector route duration                                                                                         |
| `mainTravelMinutes`                   | Integer 2–4, before vulnerability and seeded delay                                                                                 |
| `alternativeTravelMinutes`            | Integer 4–6; rerouting restarts a full alternative journey from the visual diversion point                                         |
| `serviceMinutes`                      | 0.5–2, multiple of 0.125; team occupation for assessment, protection and rerouting                                                 |
| `events.*Minute`                      | Fixed literals 5/10/15 for closure/network loss/escalation; deliberately not editable                                              |
| `events.unbriefedCapacityMultiplier`  | 0.5–1 applied after network loss until a radio briefing                                                                            |
| `events.escalationRisk`               | Integer 5–25; protected sectors receive 30%, rounded; extreme severity adds 5                                                      |
| `objectives.minimumCoverage`          | Integer 0–100; evaluated against rounded arrival coverage                                                                          |
| `objectives.maximumExposurePerPerson` | 0–20; evaluated against raw waiting exposure / initial population                                                                  |

Hazard, severity, population (50–10000), team count (2–20), locality and coordinates
remain configurable. Coordinates/locality label the synthetic scene; they do not
load real terrain. Assessment is required for earthquake evacuation and is
invalidated at the aftershock. Protection remains effective. Briefing increases
dispatch capacity and must be repeated after the observed network outage.

All time advances on a 0.125-minute grid; fractional requests are floored to that
grid, with no hidden fractional remainder. Long ticks process every intervening
arrival, service completion and fixed milestone. Costs are integrated per tick.
Arrivals/service releases at a milestone are processed before its hazard event.
Actions sharing a timestamp are ordered by log index.

Two teams remain occupied throughout each evacuation, including while access is
blocked. Arrivals release those two teams. Service actions apply their effect
immediately but release their teams only after the configured interval. No return
journey is modeled. Repeated evacuation dispatch is possible while people wait
and enough teams remain. Team conservation is validated:

```text
available + teams in service reservations + teams in unfinished missions = total
```

Committing every team before a closure can leave no capacity to reopen access.
This is a modeled consequence, not a UI error. Pending missions/reservations at
T+20 remain pending in the debrief; they are not silently completed or released.
Exposure still excludes people in transit, so dispatching people who never arrive
can make that metric look better. Always inspect coverage and unfinished missions
together with exposure. Team sprites are illustrative deployment markers: model 3
service markers follow active reservations and disappear when service finishes;
mission markers follow unfinished evacuations. Each marker represents a deployment,
not one team. The availability counter and trace are the resource ledger.

The renderer currently expresses hazards using phase and T+5/T+10/T+15. Arbitrary
event times, route topology and physically modeled wind direction require a
future shared renderer/engine contract. They are not offered as controls here.

## Recorded evidence and export schemas

All examples are synthetic. Free-text facilitator notes are untrusted and excluded
from coordinator retrieval and training inputs. Use synthetic locality names and
do not enter personal information or credentials into this workspace.

| Artifact                        | Contract                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.json`                        | Schema 3 report: complete validated `run`, metrics, objectives, evidence-linked lessons, no-intervention metrics, synthetic provenance                                  |
| `*.md`                          | Context, configuration/seed/versions, timestamps, goals, timeline IDs, decisions, arrivals/pending consequences, matched reference, facts, hypotheses and limits        |
| `*-traces.jsonl`                | One `drillTraceSchema` v1 object per accepted decision; schema emitted as `trace.schema.json`; events are resolved through the accompanying report's complete `run.log` |
| `*-candidates.jsonl`            | v1 candidate record described below; every row has `eligibleForTraining: false`                                                                                         |
| `reviewed-context.json`         | Array of `reviewedContextSchema` v1 records, with evidence, review identity/time and `authority: untrusted-reference-data`                                              |
| `evaluation.json`               | v1 `family-split-v1` evaluation described below                                                                                                                         |
| `offline-coordinator-demo.json` | Offline-only synthetic input, real-schema state, retrieved observations and validated proposal fixture; zero assignments                                                |
| `verification.json`             | Named local checks, result, Node version and tested platform                                                                                                            |

Each decision trace contains:

- `runId`, engine/policy versions, and `synthetic: true`.
- `observation`: only the current minute, hazard/severity, visible sector state and
  waiting counts, team availability, transit count, route/comms state and **already
  observed** event IDs. There is no seed, planned event schedule, future risk,
  future arrival time, final outcome or lesson in the policy input.
- `decision`: stable evidence ID, minute, action, sector and committed teams.
- `consequence`: immediate observed state, linked mission ID, actual final arrival
  time/people or unfinished people, observation cutoff, and paired exposure delta.
- `valuation`: arrival/support/unfinished classification, correctness **unreviewed**,
  synthetic-rule quality and a causal limitation.

The paired delta advances the state just before and just after the action for at
most one minute, with no additional actions, bounded by the recorded horizon.
It isolates a short simulator contrast, not downstream real-world causality.
Final mission outcomes can depend on later actions. Export checks full deterministic
replay and rejects a mismatching state or decision observation. Replay integrity
does not cryptographically authenticate the operator or the scenario.

Candidate row fields are `schemaVersion: 1`, `kind: faro-drill-candidate`,
`synthetic`, `source` (run/decision/engine/policy/seed), `split`, `input` (only the
observation), `candidateResponse` (action/sector), `outcomeForReviewOnly`,
`quality`, `eligibleForTraining: false` and `requiredReview`. Outcomes and split
metadata must never be concatenated into the model input. The scripted examples
carry the matching training-family assignment; ad hoc downloads are **unassigned**
and must be grouped by family/scenario/seed before any later training pipeline.
Lesson approval does not approve the corresponding decisions as correct labels.

Lesson provenance records rule version, evidence IDs/times, final metrics reference
and, where relevant, the no-intervention reference. Generated lesson proposals
are hypotheses for a later rehearsal. The exact lesson and review verdict,
timestamp and local facilitator identity are kept in `run.learningReview`.
Rejected/unreviewed lessons do not enter retrieval. Unknown or duplicate review
IDs are rejected. Approved text is regenerated from validated state; imported
Markdown and facilitator text cannot become new policies.

## Offline consumption and the actual agent boundary

The current implementation is `src/lib/coordinator/runtime.ts`:
`proposeCoordinatorState(state, observations, trigger)` serializes those values
into the user prompt, uses `Output.object` with `coordinatorProposalSchema`, and
validates the result. The live cycle loads accepted observations from Supabase.
It does **not** read drill files, Markdown or reviewed lessons.

`src/lib/drill-agent-context.ts` imports only the actual coordinator contract,
the deterministic engine and learning modules. It does not import the runtime,
provider client, worker or database. The demonstration:

1. Produces a schema-valid synthetic `CoordinatorInput` / `NormalizedReport`.
2. Validates a fixture with `coordinatorStateSchema` **v2**.
3. Retrieves only reviewed records matching current hazard/severity, excludes the
   target run and limits the result to six records.
4. Builds the actual prompt-data shape `{trigger, state, observations, now}`.
5. Validates a clearly labeled, hand-authored proposal fixture through
   `validateCoordinatorProposal`; stale revisions are rejected.

The state contract requires `storage: "supabase"`; in this fixture that is only a
contract literal, not a claim of database persistence. Its ten ambulance units
belong to the coordinator fixture and are **not** an invented conversion from
drill response teams. No fixture is submitted to intake or a model.

`candidateFromReviewedContext` maps an approved, generated access lesson to the
frozen reserve-team policy experiment. It does not parse arbitrary prose as code,
change instructions, or update production. This demonstrates how reviewed
knowledge can inform a bounded, reversible local policy choice.

Later operational integration would require a reviewed source registry, authenticated
approvals, retrieval selection/budget, provenance display, scenario mismatch handling,
and dedicated evaluation on the actual coordinator. Retrieved material must remain
untrusted observations under the existing system instruction, without granting
authority over current facts, inventory or dispatch controls.

## Reproducible before/after evaluation

`src/lib/drill-evaluation.ts` freezes two local policies:

- `greedy-arrivals-v1`: brief if needed; restore observed blocked access if a team
  is free; inspect when necessary; dispatch waiting sectors in fixed order.
- `reserve-access-v1`: the same policy with one team held back from assessment and
  dispatch for contingencies. It does not receive the future event schedule.

Both receive exactly the observation recorded by the engine. They take at most
one action per 0.125-minute tick and use identical configurations/seeds per pair.
No numerical weights are fitted. No policy is automatically promoted.

| Split      | Family        | Cases               | Seeds              |
| ---------- | ------------- | ------------------- | ------------------ |
| Training   | `compact`     | 2 hazards × 2 seeds | 100, 101, 110, 111 |
| Validation | `slow-access` | 2 hazards × 2 seeds | 200, 201, 210, 211 |
| Held-out   | `care-heavy`  | 2 hazards × 2 seeds | 300, 301, 310, 311 |

Families, IDs and seeds are disjoint. Both hazards appear in every split; this is
condition-family generalization, not an unseen-hazard benchmark. The candidate
was fixed before held-out scoring; it must not be tuned against these results.
A later candidate needs a new reserved family set. Sample size is small and
deterministic; no significance/confidence or real-world performance claim is made.

Evaluation v1 contains `policies`, `splitProtocol`, metric definitions, `results`
(split/family/scenario ID/seed/full config, baseline/candidate run IDs and
metrics/objectives, signed deltas and outcome classification), `heldOut`, a
`promotionRecommendation` and `limits`. Positive coverage delta is favorable;
negative waiting exposure/unfinished people is favorable. Occupied team-minutes
is a cost, not a success label. Non-regression requires coverage not to decrease
and waiting exposure not to increase; all other metrics remain visible.

The initial generated result does **not** justify the candidate: held-out
earthquake coverage decreases from 75% to 65% and waiting exposure increases;
wildfire cases tie at 75%. Two of four reserved cases are non-regressing, none
shows an improvement on those two primary metrics. The candidate is explicitly
marked **do not promote**. Keeping this negative result is part of the learning
circuit, and is preferable to claiming success or tuning to the reserved cases.

## Markdown, calibration and fine-tuning

The implemented route is reviewed knowledge/context plus candidate examples and
offline evaluation. Markdown storage, retrieval and a policy rule change are
not fine-tuning.

The repository has a numeric P3 impact policy in `src/lib/triage/impact.ts`
(`timeScaleMinutes`, vulnerability multipliers and `weightsVersion`). That is
separate from the current coordinator, which builds its own global proposal.
This delivery does not calibrate those weights or imply that the coordinator
consumes drill metrics. The coordinator uses the provider model selected by
`src/lib/agents/model.ts`; this checkout has inference/provider integrations, not
a local trainable checkpoint or a verified local training pipeline.

LLM fine-tuning remains a separate decision: choose a supported provider/model,
task, dataset format, supervised objective, budget and credentials; independently
review action correctness, remove sensitive data, assign new disjoint
train/validation/reserved families, and evaluate against the frozen baseline.
Translate only reviewed `input` and approved responses to the chosen provider's
format; retain provenance separately and exclude outcome labels from prompts.
Do not submit raw candidates directly. No external training job or production
weight change is included.

## Verification and remaining limits

`npm run drills:try -- --demo-review` checks deterministic repeats and exact
replay for both hazards across all policy/scenario pairs; resource conservation
through closure, rerouting and arrival; each configurable effect; schema bounds
and fixed milestones; tick batching; observation timestamps; tamper rejection;
legacy notebook compatibility; export parsing; split isolation; review filtering;
offline coordinator schemas and stale proposals.

Run `npm run check` for secrets, formatting, lint, typecheck, build and Graft.
Browser validation should configure ad hoc cases for both hazards, exercise
decisions and replay, download reports/traces/evaluation, approve one lesson and
download reviewed context. No production credentials are needed. Only Linux /
Node 24 was exercised for this delivery; shell commands and paths above are
examples to adapt on other platforms.
