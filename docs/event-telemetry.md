# Event ingestion and SSE telemetry

The served vertical slice is `scripts/mock-events.mjs` → `POST /api/events` →
`src/lib/event-pipeline.ts` → `GET /api/telemetry` → event log on `/`.
No database adapter, migration, filtering worker or LLM call is implemented in
this slice. The ingestion boundary contains `TODO: save in Supabase` and a
separate TODO for dispatching to filtering, followed by triage and the LLM.

## Try it

With Node 24.x, run `npm ci`, then `npm run dev`. Open
<http://localhost:3000/>. In another terminal run `npm run mock:events`.
The script sends three timed HTTP requests, prints their IDs and fails on HTTP
errors. The backend terminal logs each accepted ID without logging its payload.
The viewer shows `event.accepted` and `filtering.pending` for each event.

`EVENT_API_URL` overrides the script's base URL. Both routes are unauthenticated,
like the rest of the command-center API. No external communications or model
calls are triggered by this pipeline.

## Input and acknowledgement

`POST /api/events` takes one object, not a batch:

```json
{
  "id": "7a6461f2-42ea-4ca4-84af-cf18f7e16491",
  "source": "demo",
  "title": "Smoke detected",
  "description": "Simulated signal sent over HTTP",
  "zoneId": "zone-south",
  "category": "wildfire",
  "severity": "high",
  "confidence": "high",
  "confirmed": true
}
```

The strict schema is `incomingEventSchema` in `src/lib/validation.ts`. The UUID `id`
is optional; the backend generates one if omitted. Reuse it when retrying:
identical validated content returns 200 without publishing or projecting again;
changed content with the same ID returns 409. A new ID returns 202:

```json
{
  "eventId": "7a6461f2-42ea-4ca4-84af-cf18f7e16491",
  "duplicate": false,
  "status": "awaiting_filtering",
  "storage": "memory"
}
```

Acceptance does **not** claim persistence or filtering execution. A pending
handoff is represented in memory only. Distinct IDs remain distinct ingress
events even if the legacy command-center projection merges similar signals.
That projection still updates `/api/situation` and proposes actions as before;
it is not the new filtering/triage/LLM chain. Its signal IDs differ from ingress
UUIDs. The response no longer returns the full situation; existing clients
should read `/api/situation` separately.

## SSE contract

`GET /api/telemetry` is read-only: subscribing never starts processing or ticks
a scenario. Every default-message frame has `id:` and JSON `data:` with
`id`, `eventId`, `type`, `at`, and `payload`. IDs use a random process epoch plus
a monotonic counter. The two current record types are `event.accepted` and
`filtering.pending`. Their payloads explicitly state memory storage / the
unconnected filtering module.

Without a cursor, the server replays the latest 100 retained records. With
`Last-Event-ID` (preferred) or `?after=...`, it replays subsequent records in
pages of 100, then streams new ones. Backend stream reads occur once per second
and include heartbeat comments. The browser uses streaming fetch to support
bearer headers, reconnects after 1.5 seconds, sends its in-memory cursor, and
deduplicates displayed IDs. It retains at most 500 visible rows. A reload
replays recent history; no cursor is persisted without its associated history.

An expired cursor or server restart emits a named `reset` frame, clears the
cursor and replays recent history. The viewer clears stale rows on reset.
Disconnects/aborts clean up timers. Slow consumers are disconnected and can
resume via their cursor.

## Limits and next steps

- Single long-lived Node process only. The store retains 1,000 events for ID
  deduplication and 1,000 telemetry records. Older data is evicted. A restart or
  process replacement loses everything; retries outside retention can repeat.
- Multiple server instances do not share this store. Do not deploy this as a
  reliable distributed ingestion service. Shared persistence and ordered replay
  are prerequisites for that deployment.
- Scenario controls, demo buttons and HappyRobot callbacks still use the legacy
  store directly; they do not yet publish into this ingress telemetry feed.
  The new mock script uses only HTTP ingestion.
- Next: save the event, telemetry and pending-processing handoff atomically in
  Supabase, then implement a backend worker that consumes the handoff regardless
  of SSE viewers and publishes filtering/triage/LLM lifecycle records.
- Both routes are unauthenticated and telemetry contains input payloads. Add
  operator authentication and incident-specific access control before using
  private incident data.

Verification: automated tests cover ingestion, validation, ID deduplication,
conflicts, live delivery, replay, cursor precedence, expiration and stream
cleanup. Runtime/browser checks are performed on macOS; Linux and Windows are
intended supported platforms, not verified by these checks.
