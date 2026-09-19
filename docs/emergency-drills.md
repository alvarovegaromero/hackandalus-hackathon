# Wildfire drills

Open **Wildfire drills** in the dashboard header, or visit `/dashboard/drills`.
This standalone training workspace rehearses wildfire decisions
without contacting operational APIs or triggering HappyRobot, calls or alerts.
No credentials or backend worker are required for drills.

## Rehearsal

1. Choose a locality preset (Estepona by default), or a custom name and coordinates. Set severity, simulated
   population and response-team count.
2. **Prepare wildfire** creates a paused exercise. Review the approved checklist
   before pressing **Run simulation**. Select a sector in the scene or its
   keyboard-accessible buttons, then establish a perimeter, assist evacuation,
   restore access or brief the community. Wildfire evacuation needs no building
   assessment. Pause whenever you need time to plan.
3. Twenty simulated minutes take 80 seconds at 1× speed; 2× and 4× are available.
   **Next phase** processes the intervening simulation immediately. Running
   and replay both pause when the tab becomes hidden. The training allocation
   model keeps teams occupied until service completion or evacuation arrival.
   Keep capacity available for reopening access; blocked missions keep their teams.
4. Conditions change: access closes at T+5, communications fail at T+10, and an
   wind shift occurs at T+15. The drill ends at
   T+20 with an outcome, recorded decisions and lessons.
5. **Play 3D replay** reconstructs the recorded state over time. Scrub to any
   point, or use **View in 3D** on a timeline entry to see the state immediately
   after that interaction, including decisions sharing the same timestamp.
   A decision shows before/after team availability, transit and route access.
   Replay never changes the original run, notebook or notes.
6. **Compare without intervention** replays an otherwise identical scenario
   with no operator decisions. The debrief compares risk-weighted exposure,
   identifies people who never arrived, and supplies evidence-based lessons.
   Add facilitator observations and export JSON, Markdown or decision JSONL.
   Review individual lessons before exporting offline context.
7. Approve or reject each generated lesson, then **Rehearse this scenario again**.
   The configuration panel shows audited, facilitator-approved lessons with
   source run IDs; those lessons accompany the new exercise. Unreviewed/rejected
   lessons, synthetic demo approvals and free-form notes do not enter the checklist.
   Matching requires the same configuration, seed and model. The running exercise
   excludes itself and later exercises from its briefing.
8. Compare arrivals, unfinished journeys, waiting exposure and occupied
   team-minutes with the preceding matching exercise. A difference is evidence
   about these recorded decisions under the simulator, not a causal estimate of
   the checklist's benefit.

Overview, street and plan cameras, zoom, automatic orbit and sector selection
have keyboard-operable buttons. Pointer dragging also orbits the camera.
The sector table provides the same state without requiring interpretation of
the 3D scene. If WebGL is unavailable or its context is lost, the table remains
available and all simulation actions still work. Reduced-motion preferences
disable shaking, camera auto-orbit and cosmetic interpolation; the clock can
still run and the state updates discretely.

## Model and learning boundaries

The scene lazy-loads Three.js/WebGL and uses procedural buildings, roads, trees,
terrain, shelters, shadows and labeled districts. Wildfire effects advance
across the town, with smoke direction changing after escalation.
Coordinates seed synthetic building heights; they do not load a surveyed city,
terrain or actual road network. Visual hazard effects illustrate the clock,
severity and protection decisions, not a physical hazard calculation.
Sector populations, team costs, evacuation capacity and risk are deterministic
exercise rules, not hazard predictions. Severity changes exercise risk and
evacuation capacity. The schematic has residential, care/school and town-centre
sectors with an assembly point. Human markers represent population groups;
vehicle markers represent deployments rather than individual vehicles.

The v3 engine advances in deterministic 0.125-minute increments. Evacuation
orders reserve people immediately but count them as safe only upon arrival.
Travel duration, care-sector vulnerability, service occupation, seeded variation,
milestone effects and objectives can be configured under **Ad hoc conditions &
objectives**. Defaults are two minutes on the main route and four on the
alternative route, with care travel multiplied by 1.25 plus seeded delay.
A closure stops all in-flight
evacuations. Rerouting restarts remaining travel on the longer route from the
recorded diversion point. Evacuations can remain unfinished at T+20.
Assessment, warning and protection policies take effect immediately; their
team movement is illustrative, not a delay before the policy applies.

Exposure sums `(population - arrivals - people in transit) × sector risk / 100
× elapsed minutes`. It measures risk-weighted person-minutes waiting within
sectors; it excludes route exposure and is not a casualty estimate. The
no-intervention comparison explains deterministic model behavior, not
real-world causal effectiveness. The simulation does not predict casualties.

Lessons are rules evaluated over the recorded decisions and final state:
alternative access, radio fallback, assembly-point coverage and wildfire
perimeters. Every lesson includes supporting evidence
and a suggested rehearsal action. No model training takes place. Matching
requires the same hazard, locality (case-insensitive), coordinates, severity,
population, team count, model version and (for v3) the complete scenario/seed, so comparisons do not mix
configurations or instant-arrival and delayed-arrival models.
An archived run is compared only with a run that started earlier.

This workspace is isolated from `src/lib/digitalTwin.ts`, the operational
coordinator, Supabase and `src/lib/learning.ts`. It does not complete the planned
operational twin feature that branches live state into alternative plans.
Facilitator notes and checklists inform human practice; they do not update
operational policies. The [offline learning extension](drills-agent-learning.md)
adds reviewed retrieval context and a schema-validated coordinator demonstration,
without calling that coordinator.

## Notebook and exports

The versioned `faro.emergency-drills.v1` local-storage notebook contains one
unfinished exercise and at most 20 completed exercises, newest first.
An unfinished exercise resumes paused after a reload. Replacing it requires
explicit confirmation; export it first to keep its record.

The workspace only creates and displays wildfires. Historical non-wildfire runs
remain in the shared notebook and retain their engine semantics; they are not
shown or reused as wildfire knowledge. A non-wildfire unfinished run is not
automatically opened. Its export and replacement confirmation remain available
before a new wildfire replaces the active slot. The 20-run retention limit
still applies to the shared notebook.

If all teams are trapped on a blocked route and no service completion can
release a team, the action controls explain that the exercise cannot recover
access. Finish it and rehearse a different allocation; waiting alone does not
release those teams.

Completed exercises preserve configuration, timestamps, decisions, events,
missions, modeled exposure, outcomes and facilitator notes. The clock and
mission progress are saved as the simulation runs. Replay derives state from
the initial configuration and ordered decisions, avoiding large frame dumps.
Editing an archived observation preserves any
separate unfinished exercise and does not change the chronological order.
Notes are limited to 2,000 characters. The notebook is browser/origin-specific;
it is not shared between operators, devices or deployments. Older completed
exercises leave the notebook when its 20-run limit is reached.

Storage is validated on load. Invalid data is left untouched; the user can
continue in memory and export. Storage failures show a warning. A notebook
change from another tab pauses writes to avoid overwriting that tab; export
the current report, then reload to use the latest notebook.

JSON exports contain schema/model versions, simulation and geography labels,
the entire run, metrics, and lessons for completed runs. They can be downloaded
at any time. Importing or merging reports is not implemented.

The existing notebook key and envelope remain version 1. Runs without
`modelVersion` are read as model 1 with no missions and keep their original
instant-arrival semantics, including when resumed. Model 2 retains its original
travel durations and phase team budget. New runs use model 3 with audited
observations and occupied-team accounting. Old export envelopes retain schema 2;
model 3 uses schema 3. Models 2 and 3 include no-intervention metrics.
Old runs remain viewable but are excluded from model 3 comparisons; no storage
reset is needed. See [schemas, commands and evaluation](drills-agent-learning.md).

## Implementation and local verification

- `src/app/(console)/dashboard/drills/`: route and scoped styles.
- `src/components/emergency-drills.tsx`: configuration, controls, timeline,
  notebook, debrief and export.
- `src/components/drill-twin.tsx`: 3D controls, lazy loading and sector table.
- `src/components/drill-scene.ts`: WebGL scene, cameras, procedural geometry,
  state-driven entities, hazard effects and GPU-resource cleanup.
- `src/lib/emergency-drills.ts`: validated config/state, pure transitions,
  metrics, comparison and rule-based lessons.
- `src/lib/drill-storage.ts`: versioned notebook validation and retention.

Use Node 24 and `npm run check` for the repository's local validation (no CI or
automated test suite by default). For a manual browser rehearsal, complete
both hazards, check blocked-action explanations, reload an unfinished run,
review an archived run while another is active, and export a debrief. Repeat
an identical configuration to inspect prior lessons and coverage comparison.
Also check a narrow viewport, keyboard controls, unavailable storage and a
notebook change from another tab. Verify that replay changes scene state
instead of just the timeline, that blocked missions stop and resume on the
diversion, and that replay and no-intervention views leave the saved report
unchanged.
