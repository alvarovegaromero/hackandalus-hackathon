# Emergency drills

Open **Emergency drills** in the dashboard header, or visit `/dashboard/drills`.
This standalone training workspace rehearses earthquake and wildfire decisions
without contacting operational APIs or triggering HappyRobot, calls or alerts.
No credentials or backend worker are required for drills.

## Rehearsal

1. Choose an earthquake or wildfire, a locality preset (Granada, Lorca or
   Estepona), or a custom name and coordinates. Set severity, simulated
   population and response-team count.
2. Generate the drill. It starts paused. Select a sector in the 3D scene or its
   accessible sector buttons, then inspect buildings, establish a perimeter,
   assist evacuation, restore access or brief the community.
3. Use **Next phase**, or explicitly start **Auto advance**. Each phase represents
   five simulated minutes; auto advance moves one phase every 12 seconds and
   pauses when the tab becomes hidden. Teams return at each phase boundary.
4. Conditions change: access closes at T+5, communications fail at T+10, and an
   aftershock or wind shift occurs at T+15. Earthquake evacuation requires an
   assessment, which becomes invalid after the aftershock. The drill ends at
   T+20 with an outcome, recorded decisions and lessons.
5. Add facilitator observations, inspect the recorded interactions, and export
   the JSON report. The interaction slider highlights a log entry; the 3D scene
   continues to show the final state.
6. Rehearse again. A matching completed exercise supplies its evidence-based
   checklist and facilitator observations. The debrief compares assembly-point
   coverage with the preceding matching exercise.

Rotation, zoom, reset and sector selection use keyboard-operable buttons.
The sector table provides the same state without requiring interpretation of
the 3D scene. Status uses text as well as visual treatments.

## Model and learning boundaries

The scene uses native CSS 3D transforms. Coordinates seed synthetic building
heights; they do not load a surveyed city, terrain or actual road network.
Sector populations, team costs, evacuation capacity and risk are deterministic
exercise rules, not hazard predictions. Severity changes exercise risk and
evacuation capacity. The schematic has residential, care/school and town-centre
sectors with an assembly point.

Lessons are rules evaluated over the recorded decisions and final state:
alternative access, radio fallback, assembly-point coverage, and earthquake
reassessment or wildfire perimeters. Every lesson includes supporting evidence
and a suggested rehearsal action. No model training takes place. Matching
requires the same hazard, locality (case-insensitive), coordinates, severity,
population and team count, so comparisons do not silently mix configurations.
An archived run is compared only with a run that started earlier.

This workspace is isolated from `src/lib/digitalTwin.ts`, the operational
coordinator, Supabase and `src/lib/learning.ts`. It does not complete the planned
operational twin feature that branches live state into alternative plans.
Facilitator notes and checklists inform human practice; they do not update
operational policies.

## Notebook and exports

The versioned `faro.emergency-drills.v1` local-storage notebook contains one
unfinished exercise and at most 20 completed exercises, newest first.
An unfinished exercise resumes paused after a reload. Replacing it requires
explicit confirmation; export it first to keep its record.

Completed exercises preserve configuration, timestamps, decisions, events,
outcomes and facilitator notes. Editing an archived observation preserves any
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

## Implementation and local verification

- `src/app/(console)/dashboard/drills/`: route and scoped styles.
- `src/components/emergency-drills.tsx`: configuration, controls, timeline,
  notebook, debrief and export.
- `src/components/drill-twin.tsx`: schematic 3D presentation and sector table.
- `src/lib/emergency-drills.ts`: validated config/state, pure transitions,
  metrics, comparison and rule-based lessons.
- `src/lib/drill-storage.ts`: versioned notebook validation and retention.

Use Node 24 and `npm run check` for the repository's local validation (no CI or
automated test suite by default). For a manual browser rehearsal, complete
both hazards, check blocked-action explanations, reload an unfinished run,
review an archived run while another is active, and export a debrief. Repeat
an identical configuration to inspect prior lessons and coverage comparison.
Also check a narrow viewport, keyboard controls, unavailable storage and a
notebook change from another tab.
