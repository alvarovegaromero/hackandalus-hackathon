# Preserving the archived dashboard

The dashboard's four read endpoints default to the committed
`src/lib/demo/showcase-snapshot.json`. Supabase can be removed after this version
has been released and verified on the public domain. It is an archived simulation,
not a running emergency service or a fresh agent execution.

No environment variable is required for the archive. Missing, empty or `true`
`DEMO_SHOWCASE` values all select it; only the explicit value `false` restores
the connected runtime for development or a separate live deployment.

## Captured example

- Source: `https://faro-lovat-iota.vercel.app/dashboard`.
- Capture: 2026-10-12 at 20:00:15.489 UTC.
- Original run: `1edd360c-1e68-49fe-9d7a-bfcc1873d278`, revision 64.
- Original update: 2026-09-22 at 11:10:55.657 UTC.
- 32 received reports: 20 relevant and 12 discarded.
- 20 ranked reports: 8 critical, 9 high and 3 low.
- Three completed missions, no missions running.
- 96 telemetry records, retaining the original IDs and timestamps.

The capture used public GET state, map and mission responses and the first complete
SSE replay through `ready`. A second state read confirmed the run ID and revision
had not changed during capture. It contains the already-public synthetic scenario;
it does not include credentials or claim confirmed field actions. Keep the mission
summaries' uncertainty and the simulation label intact.

## Behavior and boundaries

- State, mission list and map responses return the original captured read models.
- Telemetry is a finite replay; `ready` carries `{"archived":true}` and the browser
  closes the EventSource. No background database polling occurs in that stream.
- State and mission browser polling returns the same bundled data each time.
- Demo/reset controls are rejected in showcase mode, including development.
- The timed/live runtime is unchanged when showcase mode is off. Authenticated
  intake, dispatch and mission-detail APIs still need their configured services.
- OpenStreetMap tiles remain an external map dependency; archived report locations,
  resource assignments, plan and mission results are preserved in the repository.

The existing `storage: supabase` field identifies where the original execution was
stored. It does not mean showcase requests query Supabase. Avoid changing this
literal without updating the coordinator read contract and its consumers.

## Local verification

Use Node 24 and run `npm run check`. Start the built app without `DEMO_SHOWCASE`
and no Supabase or AI provider credentials, then inspect `/dashboard`, `/api/state`,
`/api/subagents`, `/api/map` and `/api/telemetry`. Confirm the report counts, revision
and three completed missions match the capture. Confirm telemetry sends the archive
ready marker and finishes, and a same-origin reset request returns 403.

Verified locally on 2026-10-12 with Node 24.21.0: `npm run check` passed, and
the production build served all four read endpoints without `DEMO_SHOWCASE`,
Supabase or AI credentials. Orca's browser showed the captured counts, revision 64, three
completed missions and `Archived` telemetry status. The stream contained 96
records, finished successfully and was requested only once; reset returned 403.
The build reported three dynamic filesystem tracing warnings in the existing
`src/lib/persistence.ts` scenario code. No automated tests were run, following
the repository's default validation policy.

Release through the repository's normal feature PR to `main`, followed by the
human-approved release PR into `production`. Verify the public dashboard after
deployment before retiring the original database; a local check cannot update the
currently hosted application.
