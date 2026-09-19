# Dashboard Design Guide

> **SKETCH:** The dashboard is an exploratory prototype with demo scenario data
> and partially connected controls. It is not an approved product design or an
> operational emergency response system.

Reference guide for building the human interface of the crisis management system.
Addresses the requirements in `CHALLENGE.md`: see in two seconds what is happening and what has changed, understand what the system is doing, and intervene.
Scenario-agnostic: applies to wildfire, flood, blackout, or others, as long as there are locations to render on a map.

## 1. Initial Decisions

| Topic        | Decision                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------ |
| Audience     | An operator uses it on a laptop, and the same layout is projected before the jury.         |
| Visual focus | Situation map in the center.                                                               |
| Replanning   | Temporary highlighting of what changes, with decay over minutes and marks on the timeline. |
| Intervention | Approve or cancel actions, reorder priorities, and inject events.                          |
| Metrics      | Free/allocated resources, action status, affected/notified people, and temporal evolution. |
| Theme        | Dark by default, light as a validated alternative for projectors that wash out blacks.     |
| Signal/noise | Incoming feed with relevant items explained and dismissed items collapsed.                 |

## 2. Principles

1. **Everything in view.** Nothing critical behind tabs, modals, or scrolling at 1440×900.
2. **Reads left-to-right like the system:** information enters, the situation is assessed, decisions are made, and actions are taken.
3. **Color has a job or does not appear.** Status, resource identity, or nothing; never decoration.
4. **Never color alone.** Every status includes an icon and text; every resource includes a shape and textual identity.
5. **Simulated is not real.** Any simulated action is distinguishable at first glance from a live execution (mandated by `PROJECT.md`).
6. **What changed is noticeable without searching** and remains noticeable several minutes later.
7. **Every agent decision includes its rationale** in a legible single line.
8. **Recessive ink, prominent data.** Hairline grids and axes, neutral backgrounds, fine tick marks.

## 3. Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ STATUS BAR: scenario · clock · agent · integrations ·            │
│             last replan · [+ Inject event]                       │
├──────────────────────────────────────────────────────────────────┤
│ KPI: Affected │ Notified │ Confirmed │ Unmet requests            │
├─────────────┬────────────────────────────────┬───────────────────┤
│ INCOMING    │                                │ PRIORITIES        │
│ relevant    │              MAP               │ 1. ... [✓] [✕] ↑↓ │
│ + reason    │     incidents + resources      │ 2. ... [✓] [✕] ↑↓ │
│             │       + affected zone          │ 3. ...            │
│ ▸ 97 dism.  │                                │ ACTION STATUS     │
├─────────────┴────────────────┬───────────────┴───────────────────┤
│ RESOURCES free / assigned    │ TIMELINE EVOLUTION + replans      │
└──────────────────────────────┴───────────────────────────────────┘
```

- Three-column CSS grid: `minmax(280px, 1fr) minmax(0, 2.2fr) minmax(320px, 1.2fr)`.
- The map occupies at least 45% of width and 50% of usable height.
- Side columns scroll internally; the page does not scroll at 1440×900 or higher.
- Below 1280px width, a single column in this order: status, KPI, priorities, map, incoming, resources, evolution. Mobile is not a target; it just shouldn't break.
- 16px panel gap; 16px panel inner padding; 16px panel and card border radius (`rounded-2xl`), navigation elements at 8px, and pill-style CTAs (`rounded-full`).
- **Design system and visual blueprint:**
  - **Typography:** system font (SF Pro on Apple; Segoe UI or Roboto elsewhere) with regular and medium weights, `-0.15px` letter-spacing for tactical legibility.
  - **Type scale:** 12px (metadata/badges), 13px (compact body/buttons), 14px (standard text/subheadings), and 24px (key numbers/KPIs).
  - **Neutral hierarchy:** `#292929` (secondary panel background and dark borders), `#5D5D5D` (secondary text/neutral icons), and `#9E9E9E` (muted ink and subtitles).
  - **Icons:** 14px for navigation and buttons (`Button`), 20px for card headers (`CardHeader`).
  - **UI primitives (shadcn style):** `Button`, `Badge`, `Card` in `src/components/ui/` with `cn` (`clsx` + `tailwind-merge`).

## 4. Zones

### 4.1 Status Bar

Answers: "is the system working and what is it doing?"

- Scenario name and simulation vs. real clock, with explicit indication of which is active.
- Agent status: `Active`, `Replanning`, `Awaiting approval`, each with an icon.
- Integration health (HappyRobot and others): `Connected`, `Degraded`, `Down`, with status color + icon + text.
  If an integration goes down, the status bar states it even if no one is looking elsewhere.
- Last replan: timestamp and cause on one line, e.g. `12:20 · Replan due to: N-340 highway blocked`.
- `Inject event` button opening a form with summary, severity, source, and location.
- If simulated data is on screen, a permanent `SIMULATED DATA` badge on the bar.

### 4.2 KPI Row

Four stat tiles, not charts: here the number is the chart.

| Tile           | Value                             | Context                                               |
| -------------- | --------------------------------- | ----------------------------------------------------- |
| Affected       | Estimated affected individuals    | Delta in last 5 min (`+50 in 5 min`)                  |
| Notified       | Warned / alerted individuals      | `out of N affected` and percentage                    |
| Confirmed      | Individuals who confirmed receipt | `out of N notified`                                   |
| Unmet requests | Unassigned resource requests      | In critical status (icon + color) when greater than 0 |

- Value in 40px weight 600 on laptop; label in 14px secondary ink above.
- Delta uses text ink, not series color, with arrow as direction indicator.
- Estimates marked with `≈` and the word `estimated`; the system never has complete data and must state so.
- No sparklines in tiles: evolution lives in its dedicated panel.

### 4.3 Incoming (Signal and Noise)

Answers: "what information matters?"

- Reverse-chronological list of relevant messages: time, source icon (call, message, sensor, operator, webhook), one-line summary, and reason in secondary ink, e.g. `Reason: elevates Barrio Norte priority`.
- Dismissed items grouped at the bottom under `▸ 97 dismissed`, expandable, each with a brief reason (`duplicate`, `no location`, `no state change`).
- Hovering or focusing a message highlights its incident on the map and in priorities.
- Events injected by the operator carry the `Operator` tag.

### 4.4 Situation Map

Answers: "what is happening and where?"

- **Technical implementation:** Rendered via **React Leaflet** (`src/components/LeafletMap.tsx`) loaded dynamically (`next/dynamic` without SSR) alongside a selector to toggle with the SVG regional diagram (`src/components/OperationsMap.tsx`).
- **Cartographic base layer:** **OpenStreetMap** (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`), without external API key dependencies or restrictive quotas.
- **Operational focus:** Centered on **Sierra Bermeja / Serranía de Ronda** (`[36.525, -5.185]`), with dynamic thermal focus and 2.2 km radius.
- **Critical transit routes:** Explicit tracing of the **A-397 road** (critical closure) and alternative route **MA-8301**.
- **Incidents:** Compact interactive marker via `L.divIcon` with priority rank, zone name, severity, and pulse indicator on critical zones.
- **Resources:** Markers with distinct shape from incidents (square or resource-type icon) and categorical color by resource type.
  Maximum three resource colors on the map (see section 5); from the fourth type onward, distinguished by icon in neutral ink.
- **Assignments:** 2px line from resource to incident, in secondary ink; dashed only if the action is simulated or pending approval.
- **Affected zone:** Single polygon with 2px stroke in critical status and 12% opacity fill.
  If forecasted (fire front advance, flood rise), dashed stroke and `forecasted` badge.
- **Cut roads or blocked access:** Blocked icon and critical status stroke, with label.
- Direct labels only on top 3 priority incidents; remainder via tooltip.
- Hover tooltip with name, severity, assigned resources, last update, and current priority.
- Clicking an element on the map selects its card in priorities, and vice versa.
- Compact fixed legend in a corner: severities, resource types, and meaning of dashed strokes.

### 4.5 Priorities and Actions

Answers: "what comes first, why, and what is being done?"

Each priority card displays:

1. Rank (`1`, `2`, `3`) in large text.
2. Severity as a badge with icon and text.
3. Incident title and zone.
4. Rationale on one line, authored by the agent (`Hospital without power; 2 of 3 ambulances already committed`).
5. Next concrete action, with channel and owner (`Call to Civil Protection via HappyRobot`).
6. Action status (section 5.3).
7. Controls: `Approve`, `Cancel`, `↑`, `↓`.

Rules:

- High-impact actions originate in `Awaiting approval` and show `Approve` as the primary button.
- The rest execute automatically and show only `Cancel` while cancellation remains possible.
- `Cancel` and `Approve` on external actions require inline confirmation (no modal), stating what is about to happen.
- When the operator reorders, the card shows `Pinned by operator` and the agent replans respecting that position.
- Below the queue, a single horizontal stacked bar showing action counts by status with a legend and figures.

### 4.6 Resources

Answers: "where are resources going?"

- One row per resource type with horizontal bar: filled segment = assigned, outlined segment = available, against a total capacity track.
- Direct label on the right: `3 / 5 assigned · 2 available`.
- If there are unmet requests for that type, `⚠ 2 unmet` in critical status with icon is added to the right.
  Not drawn as a bar segment because it is not capacity.
- Bars sorted by scarcity (lowest available proportion at the top), stable order between updates unless real change occurs.
- Each row's color matches the resource type on the map: color follows entity.

### 4.7 Temporal Evolution

Answers: "how is this progressing and when did the plan change?"

- Stacked small multiples sharing X axis (time): `Open incidents` and `Available resources`.
  Never dual Y-axis.
- 2px line, single color per chart (series 1 ink), un-filled area.
- Each replan is a vertical hairline crossing both charts, with a short label on top (`Replan 3 · road blocked`).
  Preserves adaptation history after temporary highlights fade.
- Crosshair and tooltip with values of both series at that instant.
- Default window: past hour or since scenario start if shorter.

## 5. Color

All values come from the reference palette of the `dataviz` skill and have been validated with its script.
Defined as CSS variables by role in `:root` and redefined for dark mode; component code never uses direct hex values.

### 5.1 Surfaces and Ink

| Role                       | Light                 | Dark                     |
| -------------------------- | --------------------- | ------------------------ |
| Page background            | `#f9f9f7`             | `#0d0d0d`                |
| Panel surface              | `#fcfcfb`             | `#1a1a19`                |
| Primary ink                | `#0b0b0b`             | `#ffffff`                |
| Secondary ink              | `#52514e`             | `#c3c2b7`                |
| Muted ink (axes, metadata) | `#898781`             | `#898781`                |
| Grid                       | `#e1e0d9`             | `#2c2c2a`                |
| Axis / baseline            | `#c3c2b7`             | `#383835`                |
| Hairline border            | `rgba(11,11,11,0.10)` | `rgba(255,255,255,0.10)` |

Text always uses ink, never a series or status color.
Status color is applied to the icon, dot, or border adjacent to text.

### 5.2 Severity (Status)

| Severity   | Color               | Suggested icon    |
| ---------- | ------------------- | ----------------- |
| `critical` | `#d03b3b`           | octagon with `!`  |
| `high`     | `#ec835a`           | triangle with `!` |
| `medium`   | `#fab219`           | circle with `!`   |
| `low`      | muted ink `#898781` | circle with `i`   |

- Status colors are fixed in light and dark mode and are not used for anything else.
- `high` and `medium` have a ΔE of 13.6 from each other (below the threshold of 15): without icon and text they cannot be reliably distinguished.
  Icon and label are mandatory, including on the map.
- In light mode, `medium` and `high` have contrast below 3:1 with the surface; therefore the icon carries a border in primary ink.

### 5.3 Action Status

| Status            | Treatment                                                  |
| ----------------- | ---------------------------------------------------------- |
| Completed         | `#0ca30c` + check                                          |
| Running           | series 1 (`#2a78d6` / `#3987e5`) + static spinner or clock |
| Awaiting approval | `#fab219` + hand or padlock                                |
| Failed            | `#d03b3b` + cross, with visible failure reason             |
| Cancelled         | muted ink + strikethrough title                            |
| Simulated         | 45° line hatching in muted ink + `SIMULATED` badge         |

An action does not transition to `Completed` until confirmed by integration result.

### 5.4 Resource Types (Categorical)

| Slot           | Light     | Dark      |
| -------------- | --------- | --------- |
| 1 · blue       | `#2a78d6` | `#3987e5` |
| 2 · orange     | `#eb6834` | `#d95926` |
| 3 · aquamarine | `#1baf7a` | `#199e70` |

- Palette validator output in all-pairs mode (map is sparse, any pair may coincide):
  light, CVD worst ΔE 9.2 and normal vision worst ΔE 24.0; dark, CVD worst ΔE 9.4 and normal vision worst ΔE 20.9.
- In light mode, aquamarine has a 2.74:1 contrast ratio: requires direct label or icon, as already mandated by principle 4.
- Fixed assignment per resource type, defined once in code; filtering or removing a type never recolors others.
- More than three types: additional types are styled in neutral ink with their own icon, never with a generated color.
- The resource orange coexists with the `high` severity orange: distinguished by shape (square or icon for resource, circle for incident), never solely by color.

### 5.5 Validation Command

Any palette change must be validated before merging, in both modes:

```bash
node <dataviz-skill>/scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --pairs all
```

```bash
node <dataviz-skill>/scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark --pairs all
```

## 6. Changes and Replanning

The operator must see what changed without searching for it.

- Every new or modified element (message, incident, priority, action, resource) receives a badge: `New` or `Changed · 2 min ago`.
- The badge is a 2px ring or left border in primary ink plus text; it does not use status or series colors.
- The badge persists for 5 minutes and fades during the final minute before disappearing.
- On the map, the modified marker pulses at most three times upon appearing, then retains the static ring.
- Priority cards that change rank animate to their new position over 300ms and display `↑ from 4` or `↓ from 1`.
- Actions cancelled by a replanning cycle do not disappear instantly: they remain struck-through with `Cancelled by replan` for the 5-minute badge window.
- When `prefers-reduced-motion` is active, pulse animations and position transitions are disabled; only the static badge is shown.
- The permanent trace of each replan lives in the status bar (latest) and in the temporal evolution panel (all).

## 7. Typography and Projection

- System font: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Scaled in `rem` so browser zoom scales everything uniformly.
  For projection, 125–150% zoom is sufficient; a separate presentation mode is unnecessary.

| Usage                   | Size                                       | Weight    |
| ----------------------- | ------------------------------------------ | --------- |
| KPI value               | 2.5rem                                     | 600       |
| Priority rank           | 1.5rem                                     | 600       |
| Panel title             | 0.875rem, uppercase, 0.04em letter-spacing | 600       |
| Card text               | 1rem                                       | 400 / 500 |
| Metadata, reasons, axes | 0.8125rem                                  | 400       |

- Nothing below 0.8125rem (13px).
- Numbers aligned in tables and axes with `font-variant-numeric: tabular-nums`; KPIs with proportional numbers.
- Time in 24h format `HH:MM`; relative times (`2 min ago`) only for change badges.
- Numbers formatted with locale-appropriate thousands separators.

## 8. Marks and Chart Anatomy

- Bars 12–16px high with 4px rounded ends on the data side, anchored to the baseline.
- 2px surface-color gap between stacked bar segments; no borders around marks.
- 2px lines; markers at least 8px.
- Grid and axes in continuous hairline, never dashed.
  Dashed stroke is reserved for forecasted, pending, and simulated items.
- Selective direct labels: the latest value, the extreme, or what matters; never a number at every point.
- Legend always present when two or more series are displayed.
- Hover and click hit targets larger than the mark (minimum 24×24px).

## 9. Interaction and Intervention

- Tooltip on all charts and on the map, rendered on panel surface with primary ink.
- Cross-selection: selecting an incident in incoming, map, or priorities highlights it across all three zones.
- Each data panel offers `View as table` (resources, evolution, action status) for accessibility and when color alone is insufficient.
- Every operator action is logged in incoming with the `Operator` badge and triggers a visible replanning cycle.
- Controls are native buttons with visible focus rings; everything can be operated via keyboard.
- Integration errors are displayed on the affected card with the reason and a `Retry` option, which will not duplicate the action if already executed.

## 10. Accessibility

- AA text contrast (4.5:1) in both themes.
- No meaning conveyed solely by color: icon + text for statuses, shape + label for resources.
- Textures available for simulated items and for `forced-colors`.
- `prefers-reduced-motion` respected (section 6).
- `aria-live="polite"` regions for the status bar and priority queue so changes are announced without interrupting.
- Dark theme is a dedicated color selection validated against its surface, not an automated inversion.

## 11. Anti-patterns to Avoid

- Dual Y-axis in temporal evolution.
- Donut or gauge charts for free/assigned resources.
- Generated colors for a fourth resource type.
- Status color used as series color, or vice versa.
- Recoloring resources upon filtering.
- Heavy grids, large saturated blocks, or full-color base maps.
- Numbers on every single point or segment.
- Simulated actions styled identically to live ones.
- Replanning cycles that can only be noticed if looking at that exact second.
- Critical information hidden behind tabs or modals.

## 12. Acceptance Checklist

- [ ] At 1440×900, all zones are visible without page scrolling.
- [ ] Projected at 125–150% zoom, KPIs and priority ranks can be read from 5 meters away.
- [ ] Upon injecting an event, the map, priorities, and status bar update in under 5 seconds, and all changes carry badges.
- [ ] Five minutes later, the replanning cycle remains visible in temporal evolution.
- [ ] A disconnected integration is visible in the status bar and on the affected action.
- [ ] No simulated action can be mistaken for a live one.
- [ ] Palette validator passes in both light and dark modes.
- [ ] In grayscale (achromatopsia simulation), severities, statuses, and resource types remain distinguishable.
- [ ] Everything can be operated via keyboard and focus is always visible.
- [ ] Both themes reviewed via screenshot before closing the task.
