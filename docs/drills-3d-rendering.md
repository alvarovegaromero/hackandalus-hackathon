# Training city renderer

The `/dashboard/drills` city is a synthetic training diorama. Coordinates seed
variation; they do not retrieve a map, surveyed terrain or real buildings.
All geometry and label textures are created locally. There are no new packages
or external assets.

## Ownership and integration

- `src/components/drill-scene-layout.ts`: seeded variation, district anchors,
  connected main/outer-road paths, mission sampling and visual hazard functions.
- `src/components/drill-scene-world.ts`: terrain, neighbourhoods, care campus,
  civic square, assembly shelters, labels and instanced static geometry.
- `src/components/drill-scene.ts`: WebGL lifecycle, cameras, hazard presentation,
  population/deployment markers and state updates.
- `src/components/drill-twin.tsx`: unchanged public props, lazy scene loading,
  camera/sector buttons, status and accessible sector table.
- `src/components/drill-scene.module.css`: presentation confined to this renderer.

The simulation, persistence, main drills component and shared drills stylesheet
are unchanged. Continue using `DrillRun` and the existing `update`, `view`,
`setOrbit`, `zoom` and `dispose` scene methods.

## Reproducibility and interpretation

The locality name (trimmed and lowercased), latitude and longitude seed an
integer hash. Building heights, facades, forest positions and damage samples use
that seed. Neighbourhood anchors and roads stay fixed so operators can learn the
layout. Hazard, population and team changes do not regenerate the geography.
The same locality therefore supports comparisons across hazards and decisions.

Every hazard position comes from `drillMinute(run)`, severity and the locality seed.
The separate ad hoc scenario seed controls engine risk and travel delay; it does
not regenerate the town or change the illustrative hazard geometry.
There is no random sampling or elapsed-wall-time hazard integration per frame.
Backward replay recomputes earlier damage, vegetation and fire directly.
Automatic camera orbit is a user-controlled viewing aid, outside replay state.

### Earthquake

Seeded buildings tilt and compress at initial impact. T+15 increases damage and
adds damaged buildings, debris and a second dust/wave pulse. Damage never uses
the mutable sector risk score: a protection decision adds a safety perimeter
without repairing a structure. A tiny deterministic building tilt accompanies
the initial impact and aftershock; the camera and terrain do not shake.

At T+5, debris and a striped barricade mark the closed main road. Reopening
exercise access uses the outer-road diversion; the original obstruction remains.
Wave expansion and building shake are disabled with reduced motion.

### Wildfire

An orange line, flame band and darker ground communicate the front and burnt
area. A continuous severity-dependent clock function advances the front from the
western forest. Trees behind it become charred. Volumetric low-poly smoke leans
with the wind; at T+15 it changes direction and the front changes shape without
teleporting. The wind arrow and status text distinguish the escalation.

The T+5 main-road spot fire is the engine's scripted access event. Its location
does not imply a physically simulated ember trajectory. Secured sectors receive
a mint boundary and explicit text; unsecured sectors are labelled exposed.
Protection changes the engine's risk score, not the visual spread function.
Neither a perimeter nor an assembly shelter promises physical immunity.

### Population and deployments

Markers represent groups, not individually tracked people. Waiting groups,
active missions and arrivals use the engine's populations and mission records.
Their positions sample a road polyline by **exact `mission.progress`**; there is
no extrapolation between engine ticks and no second travel-speed model.
The existing engine quantizes time to 0.125 minutes, so movement is visibly
stepped at high playback speeds.

A main mission follows district → central road → assembly. An alternative
mission uses the outer ring. For a diversion, its first waypoint is the point
sampled on the main route at `reroutedFrom`; it then joins a nearby street
junction and the outer ring. This preserves the reached position when progress
resets to zero. A closure leaves progress unchanged, so all group positions
remain stationary. Formation offsets are also continuous across the diversion.
Completed groups remain in the assembly area, with green markers.

Vehicle orientation follows the path tangent. Convoys accompany active missions;
assessment/protection deployments appear at their destination while their model 3
service reservation is active. Models 1 and 2 retain phase-based markers.
These are deployment symbols, not an inventory or a separate
resource scheduler. Model-1 archives retain their engine's instant-arrival
semantics and are drawn directly at assembly.

## Cameras and accessibility

Overview frames the complete diorama; Plan shows road connectivity; Street
focuses the selected sector. Aspect-aware framing increases distance on narrow
screens. Drag/scroll controls have keyboard equivalents: camera presets, zoom,
auto-orbit and sector buttons. Street suppresses unrelated billboard labels;
label size does not increase when the camera approaches.

Clock, status, camera controls and legends occupy rows outside the canvas.
Sector risk and secured/exposed text complement colour. The sector table works
without interpreting 3D, and appears automatically on WebGL failure/context loss.
Reload restores a lost context; the simulation controls remain usable.
Reduced motion disables automatic orbit, building shake, expanding waves and
flame flicker; state still updates with the clock.

## GPU and scheduling

Buildings, roads and windows are batched by material into instanced meshes.
Trees, debris, flames, smoke, population and convoy parts are also instanced.
Low-poly geometry and shared materials keep object/draw-call counts bounded.
No geometry/material allocation occurs on the frame path. No particle textures
or downloaded models are needed; canvas label textures are created once.

Rendering is demand-driven, capped at roughly 30 submissions/second and skipped
when the document is hidden. A paused scene with no orbit submits no new frames.
Pixel ratio is capped at 1.5 on desktop and 1 below 600px canvas width. Shadows
use one 1024px map, refresh on hazard damage/resize, and are disabled on narrow
canvases. Cosmetic shake does not redraw the shadow map.

Disposal releases instancing buffers, unique geometries/materials/textures,
shadow targets, controls, listeners, ResizeObserver and the renderer. The
animation-frame callback is cancelled on disposal or context loss.

The canvas host exposes read-only `data-drill-renderer` diagnostics: draw calls,
triangles, geometry/texture counts, pixel ratio, shadow state, cumulative frames
and average CPU submission time. This is **not GPU time or display FPS**.
`data-drill-missions` exposes sampled positions/progress for verification without
changing the engine. Measure frame-count deltas over a known active interval;
wall-time averages across paused periods are not a throughput measurement.

## Local validation and boundaries

Use Node 24 and npm. `npm run check` runs secret scanning, formatting, ESLint,
TypeScript, production build and Graft index freshness. No CI, hooks or new test
suite are introduced. The authenticated application backends are not required
for the standalone drills workspace.

`npm run check` passed on the final renderer revision. The production build
emitted three dynamic-filesystem tracing warnings in the unchanged
`src/lib/persistence.ts`. Graft reported the wiring graph in sync. Ad hoc shell
assertions covered 303 diversion start/end positions and road segments, 3,000
monotonic damage samples, wind-transition continuity and stable locality seeds;
no suite was added.

Recorded browser validation passed for both hazards, closure/diversion/arrival,
protection without repair, T+15 escalation, replay in both directions and without
intervention, keyboard controls, reduced motion and narrow-screen framing.
Actual `WEBGL_lose_context` triggered the fallback table while **Next phase**
continued to advance the exercise; reload restored 3D.

At T+5, a wildfire mission stopped at progress `0.3125`, position
`[-18.25, 0.65, 0]`. At T+10 both values were unchanged. Rerouting reset progress
to zero while preserving that position; the group arrived at T+13.
Earthquake diversion was also checked at progress `0.75` and position
`[37, 0.65, 14.25]`. Protection reduced the care sector's risk from 82 to 62
without restoring damaged roofs. Replaying T+6 → T+20 → T+6 for earthquake,
and returning to T+12 for wildfire, produced identical mission diagnostics and
pixel-identical full-page screenshots. The no-intervention comparison removed
missions and retained the same geography.

An initial Street-view pass found foreground labels obscuring buildings. Labels
now have bounded projected size and Street shows only the selected district's
label. Both residential and care views were retested with zoom and passed.
Narrow-screen checks used 390×844 Chrome emulation: no horizontal document
overflow; both hazards, camera/sector controls and the separate HUD remained usable.

### Observed performance

Measured in development mode, Node 24.19.0, Chrome 137 on Linux x86-64:
8 vCPU Intel Xeon Platinum 8559C, KVM, 31 GiB RAM. WebGL reported
**ANGLE / Vulkan SwiftShader Device (Subzero)**. Viewport 1600×1069, DPR 1,
canvas 1519×530, shadows enabled. These are software-rendered VM observations,
not native-GPU or production benchmarks.

| Observation                 | Paused T+5, automatic orbit | Active T+6.5 → T+9, fixed camera |
| --------------------------- | --------------------------- | -------------------------------- |
| Sample duration             | 10.032 s                    | 10.013 s                         |
| Renderer frame delta        | 225                         | 20                               |
| Render submissions / second | 22.43                       | 2.00                             |
| Display rAF callbacks / sec | 22.43                       | 57.23                            |
| Approx. CPU submission      | 0.49 ms/frame               | 1.08 ms/frame                    |
| Draw calls / triangles      | 50 / 36,832                 | 50 / 36,832                      |
| Geometries / textures       | 25 / 8, unchanged           | 25 / 8, unchanged                |

The active fixed-camera rate follows the roughly 2 Hz engine/UI updates;
it is not the browser's display frame rate or a maximum rendering benchmark.
Orbit is continuous and did not reach the roughly 30 Hz throttle on this VM.
CPU timings are derived from rounded cumulative diagnostics and exclude GPU
execution. GPU timing, production throughput, power usage and long-duration
memory profiling were not measured.

The renderer has no structural engineering, smoke dispersion, collision
avoidance, route-exposure or real transport model. Transparent instanced smoke
uses approximate blending. Small group markers may need Street/zoom on mobile.
Only the tested Linux/Chrome environment establishes observed performance;
physical mobile devices and macOS/Windows remain unmeasured.
