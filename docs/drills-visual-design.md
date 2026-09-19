# Drills visual design

## Reference and scope

This local visual update is based on the approved `Luissantra/far0-landing` at
`44503c8cd5611a5e31127f38d16e5d192d7294b7` and the drills implementation at
`1a57abe7894cc049f2faa8b2de4353a54e3102d7`.

Reference reading: landing `README.md`, `AGENTS.md`, `docs/design-context.md`,
`src/app/landing.css`, `src/app/globals.css` and `src/components/landing/Logo.tsx`.
The existing console brand asset at `public/brand/faro-icon.svg` preserves the
supplied symbol path and mint dot. It is reused decoratively beside the existing
Far0 command-centre link; the accessible link name and destination stay intact.
No reference-repository files or brand exports are changed.

Only `src/app/(console)/dashboard/drills/drills.css` changes application
presentation. No component interfaces, simulation rules, outputs or storage
contracts change. The route, English copy, native controls and DOM reading order
remain intact. No fonts, scripts, dependencies or operational integrations are added.

## Visual plan

The workspace uses a paper work surface, an ink navigation band and a framed
digital twin. Configuration is a compact side rail on wide screens. Open metric
rows precede the city; the response desk and decision log sit below it. Replay
and the learning review use the same alignment as the live workspace.

```text
Far0 command centre     Training workspace          Simulation only
Emergency drills                                   Configuration toggle
Configuration rail | Run state / temporal controls
                   | Metrics separated by rules
                   | Ink frame / existing synthetic city / sector selection
                   | Replay and comparison when available
                   | Response desk       Decision timeline
                   | Lessons and facilitator notes
Exercise notebook
Training limitations
```

At 960px and below, configuration moves above the city in DOM order. At 520px,
fields become one column and metrics use two columns. Sector selection becomes
full-width rows. At 380px, hazard choices stack. Long locality names wrap rather
than widen the workspace. The sector table keeps its own horizontal scrolling.

The deliberate focal point is the existing synthetic city. The design does not
add a marketing hero or extra explanatory labels. Response, learning and history
use rules and whitespace instead of repeating the old rounded white cards.
Numerals and timeline marks express actual recorded states, never new claims.

## Tokens and hierarchy

The drills page inherits the dashboard tokens from
`src/app/(console)/dashboard-theme.css`, so both console routes share one dark theme.
`drills.css` only defines aliases on `.drills-shell`:

| Alias                         | Value                                  | Role                                       |
| ----------------------------- | -------------------------------------- | ------------------------------------------ |
| `--deep`                      | `#0e1219`                              | Viewport frame and 3D stage surround       |
| `--green`, `--drills-emerald` | `--focus`                              | Primary actions, selection, decision marks |
| `--drills-mint`               | `#a7f3d0`                              | Running state and camera selection         |
| `--red`, `--amber`, `--blue`  | `--critical`, `--high`, `--running`    | Errors, warnings, earthquake choice        |
| `*-soft`                      | 14-16% `color-mix` of the matching hue | Tinted callout backgrounds                 |

Scoped `:where()` element defaults restore button, input and select styling
that the console's Tailwind preflight resets. Both routes share the
`ConsoleNav` tabs (Live operations / Drills) in their header.

The landing's monospace stack (`IBM Plex Mono`, `JetBrains Mono`,
`SFMono-Regular`, Consolas, `Liberation Mono`, monospace) supplies medium-weight
headings, clocks and key numbers. It deliberately falls back to installed fonts;
no remote font request is required. The console sans-serif stack remains for
instructions, long evidence and controls.

Headline size is fluid from 28px to 44px. Section headings are 17px; body copy is
13–14px. Controls have a 44px minimum height. A 4px control radius and 6px viewport
radius keep the workspace distinct from the reference landing's broader sections.
Spacing follows the operational reading order: configure, run, decide, learn.

Earthquake retains blue and wildfire uses amber in the configuration choices,
paired with the existing icon, label and radio state. Brand green indicates
actions and selection, not incident severity. Alerts remain amber/red, while
baseline comparison keeps its amber selected state. Three.js scene colors are
unchanged.

## Accessibility and preserved behavior

- Focus uses a 3px brand-green outline; cinema controls use mint. Sector focus is inset to avoid viewport clipping.
- Form borders use a stronger neutral than decorative separators. Buttons have
  explicit hover and disabled states. Inputs and textareas retain native behavior.
- Timeline decisions have solid marks and events have hollow marks/dashed rules.
  Pressed controls retain their existing text and ARIA attributes.
  Timeline rows explicitly use block layout so the console's shared `.event`
  grid cannot compress timestamps beside long locality descriptions.
- Reduced motion removes added transitions. No entrance, pulse or looping
  animations are introduced. Forced-colors selection and focus use `Highlight`.
- Loading, WebGL-unavailable messaging, readable sector table, storage warnings,
  validation errors and facilitator notes remain in their original components.
  While the renderer is loading or unavailable, the disabled camera toolbar is
  hidden so it cannot cover the explanation on narrow screens. It returns when
  the renderer is ready; simulation controls and sector selection remain visible.
- Earthquake/wildfire rules, the 20-minute clock, delayed arrivals, decisions,
  replay, comparison, JSON export, model 2 and `faro.emergency-drills.v1` are
  untouched.

## Integration boundary

This stylesheet works with the current class names and needs no changes from
other sessions. It does not edit `emergency-drills.tsx`, `drill-twin.tsx`,
`drill-scene.ts` or `src/lib/emergency-drills.ts`.

Hazard styling currently uses the existing `.lucide-flame` class inside its
radio label. If that icon is replaced later, an optional integration improvement
is `data-hazard="earthquake|wildfire"` on each label, with a corresponding CSS
selector update. That proposal is not required for this version to function.

The canvas background and scene geometry belong to the scene owner. The CSS
frame uses ink without applying filters to the canvas or altering hazard colors.
Changing the actual renderer background would require a separate scene-owner
decision.

## Validation and limitations

`npm run check` passed on Node 24.19.0 and Ubuntu Linux after the final CSS change.
It includes secret checks, formatting, lint, type generation, TypeScript,
production build and Graft wiring verification. The build reports three dynamic
filesystem tracing warnings in the unchanged `src/lib/persistence.ts`; none
were suppressed.

Chrome testing passed both hazards through T+20, desktop at 1600 × 1069 and
narrow viewports at 390px and 320px. Recorded checks cover decisions, delayed
arrivals, replay/comparison, notes/history reload, downloaded JSON, keyboard
focus, reduced motion, loading, WebGL fallback and invalid-storage preservation.
Targeted retests confirmed that fallback messages stay unobstructed and long
timeline entries wrap separately from timestamps. No unresolved CSS regression
was observed.

No automated suite or CI is added under the hackathon policy. No disabled hook
is restored. Local commits, a patch and a bundle are the integration artifacts;
there is no push, pull request or deployment. The preview requires this session's
machine to remain awake. Physical mobile devices, Safari/Firefox, screen readers
and actual Windows forced-colors mode were not tested. Mobile testing used
viewport emulation; forced-colors CSS is present but is not a verified OS result.

The 44px form controls place the generate action just below the first fold at the
tested 1600 × 1069 desktop viewport. This needs a short scroll; narrow screens
also retain the existing configuration-first reading order. No sticky form or
visual reordering is used to obscure fields or diverge from keyboard order.
Response actions remain below the city and require scrolling, especially on
mobile.

An existing wildfire assessment helper says "Required before earthquake
evacuation." The wildfire action still works without that gate. Contextual helper
copy is a possible follow-up for the component owner, outside this CSS change.
