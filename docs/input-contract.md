# Report input contract

For POC integration, [module contracts v1](poc-contracts.md) reuses the existing
legacy input/SSE slice from `origin/event-pipeline-backend-frontend` (`e2579a9`).
Its `/api/events` memory acknowledgement remains distinct from the durable
`/api/signals` target below. P1 adapts both into the existing `NormalizedReport`;
neither input contract is silently replaced. That branch is not yet integrated
into this checkout.

Confirmed on 2026-09-19. This is the target contract for report intake and the
normalization boundary before triage. It supersedes the earlier requirement
that a reporter supply `title`, `body`, `category`, `severity`, or confidence.
The envelope schema (`src/lib/report.ts`) and the scenario adapter are implemented;
public validation, intake and the route are not yet exposed by the running application.

See [the current architecture](architecture.md) for implemented intake and
processing boundaries. The public reporting experience below remains a proposal.

## Reporter experience

Only the report text is required. A person can optionally share their current
location, select the incident location, or describe a place. Failure or refusal
to share GPS must not prevent reporting. The interface supplies the technical
fields; the person does not need to know the crisis UUID or classify the event.

```json
{
  "text": "I see smoke near the campsite; there are people inside",
  "location": {
    "latitude": 36.537,
    "longitude": -5.046,
    "description": "North entrance of the campsite",
    "reference": "incident"
  }
}
```

These are also valid:

```json
{ "text": "I can see smoke from my house" }
```

```json
{
  "text": "The road is closed",
  "location": {
    "description": "A-397, near the Benahavís junction",
    "reference": "incident"
  }
}
```

## Public report fields

| Field                  | Contract                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `text`                 | Required trimmed string, 1–4000 characters.                                                                            |
| `location`             | Optional object; if supplied, requires a coordinate pair, a nonempty description, or both. An empty object is invalid. |
| `location.latitude`    | Finite number in [-90, 90], WGS84 decimal degrees; requires longitude.                                                 |
| `location.longitude`   | Finite number in [-180, 180], WGS84 decimal degrees; requires latitude.                                                |
| `location.description` | Optional trimmed string, 1–500 characters.                                                                             |
| `location.reference`   | `incident`, `reporter`, or `unknown`; defaults to `unknown`.                                                           |

Reject unknown fields and invalid coordinates; do not silently coerce strings
into numbers. Zero is a valid coordinate. Missing location remains unknown.
Coordinates supplied by device GPS describe the **reporter**. A pin explicitly
identifying the reported event describes the **incident**. Do not turn reporter
or unknown coordinates into a confirmed incident location.

Geocoding happens later. Keep the original description and treat an inferred
position as a candidate requiring evidence; do not overwrite supplied coordinates
when text and coordinates disagree. This first contract carries one location;
simultaneously reporting two positions is a future additive extension.

## Common input to triage

All channel adapters produce the same internal envelope. This is an application
contract, not a database migration:

```ts
type NormalizedReport = {
  id: string; // Server-assigned UUID; stable across retries of the same delivery.
  runId: string; // Existing crisis UUID, resolved from trusted request context.
  source: "operator" | "sensor" | "happyrobot" | "public" | "scenario" | "webhook";
  channel?: string; // Channel supplied by the adapter, not the public form.
  externalRef?: string; // Provider message/delivery ID, scoped to source and run.
  receivedAt: string; // Server timestamp, ISO 8601 UTC.
  occurredAt?: string; // Only when actually known; never inferred from receipt.
  text: string;
  location?: {
    latitude?: number; // Both coordinates or neither, as validated above.
    longitude?: number;
    description?: string;
    reference: "incident" | "reporter" | "unknown";
  };
  extracted: {
    category?: string; // Candidate category, not a confirmed fact.
    peopleReportedPresent?: boolean; // Omit when unknown; unknown is not false.
  };
};
```

Keep the original report/provider payload associated with the signal for
traceability. Structured sensor readings must remain available as structured
evidence, even when the adapter also generates readable text. Never expose
simulator ground truth to normalization or triage.

The server resolves and validates `runId` through the reporting session or
authenticated integration context. If that context is absent or ambiguous,
reject the request; do not guess a crisis. An integration adapter supplies source,
channel and external references. A public caller cannot impersonate a sensor or
set confidence by adding fields to the body.

Normalization preserves claims and provenance. Code handles the envelope and
coordinates; language interpretation may use a model. Missing or failed
extraction leaves `extracted` empty and does not discard the original report.
Triage evaluates relevance, urgency, confidence and the required response.
It does not require a severity invented by the intake adapter. Downstream
incident correlation groups distinct reports of the same real-world problem.

## Implemented HappyRobot first slice

`POST /api/signals` now accepts one exact HappyRobot `normalized_report`, stores
it in `public.signals`, and synchronously calls `processSignal` after durable
persistence. Authentication uses `x-happyrobot-secret`. The compact response
contains `signalId`, `eventId`, `duplicate`, and `status`. HappyRobot cannot set
severity, confidence, zone, priority, or actions; FARO derives the active
`CrisisEvent` and passes it to `addCrisisEvent`. See
[input-architecture.md](input-architecture.md) for the current retry contract.

## Future multi-source asynchronous contract

The broader target would accept a report, an array, or
`{ "signals": [...] }`, up to 50 reports. The reporting UI normally sends one.

1. Validate request context and each report; deduplicate transport retries.
2. Persist the original report and server metadata.
3. Confirm a durable processing start for each new report.
4. Return `202` with IDs, without waiting for interpretation or triage.
5. During background processing, normalize/enrich, triage, correlate incidents and replan.

Response arrays are `accepted`, `merged`, `rejected`, and `errors`, each keyed by
input `index`. Accepted and merged entries include the signal `id`; merged
entries also include `occurrences`. Rejections carry validation issues; errors
carry a stable error code and whether retry is possible. A `202` acknowledges
receipt and scheduled processing, not completed triage or executed actions.

Use `202` when at least one new report is scheduled, `200` for duplicate-only
success, `400` for malformed/empty/all-invalid input, `413` above the batch limit,
and `503` when no report succeeds because required persistence or scheduling is
unavailable. Mixed batches retain per-item outcomes. Authentication follows the
trusted context and is separate from the public report fields. A demo-only
`?wait=1` may wait for triage and return `200`; it is not the default.

Do not mark a persisted-but-unscheduled report accepted or treat its retry as
already processed. Implementation must track scheduling and resume it using the
same signal identity. Keep in-memory demo operation explicitly labeled; it does
not provide durable acceptance. Realtime is later dashboard delivery, not the
mechanism that starts processing.

Deduplication must distinguish the same **message** from the same **incident**.
Use a provider delivery ID when available. Without one, a shared area/category
is insufficient to merge reports from different people. The fallback key/window,
browser retry identity and atomic persistence/scheduling recovery remain
implementation decisions to resolve before exposing this endpoint.

## Compatibility with Luis's work

Luis Sánchez Travesí's `da1cc21` introduced batch ingestion and the scenario-to-agent
bridge. Preserve the scenario engine, bounded processing starts, per-item results,
retry identity and existing tests while migrating the contracts.

- `src/lib/signals/schema.ts` remains the simulator's producer contract. Its
  text and reading variants do not need to become the public form contract.
- Done: `signalToReport` in `src/lib/signals/to-event.ts` returns
  `{ report, evidence }`, where `report` is a `NormalizedReport` validated by
  `normalizedReportSchema` (`src/lib/report.ts`) and `evidence` is the original
  signal. It keeps the stable identity based on crisis and signal ID (the same
  `id` the legacy `signalToEvent` produces), sets `source: "scenario"`, the
  signal channel as `channel` and the signal ID as `externalRef`, maps
  `lat/lon/placeName` to `latitude/longitude/description` with reference
  `unknown`, and renders readings as text while the evidence keeps them
  structured, together with `accuracyM`. `extracted` starts empty.
- Keep `receivedAtMin` as simulation-relative metadata; do not interpret it as
  a wall-clock timestamp without the scenario clock origin.
- Replace the hard-coded `medium` severity with triage assessment when migrating
  the consumer. Preserve structured readings, channel and source provenance.
- Port batch orchestration from `src/lib/ingest.ts` while
  adapting their old `CrisisEvent` input and persistence model. Their current
  event-ID deduplication is not yet the target deduplication contract.
- Connect the processing consumer and scenario bridge together. Keep the current
  `/api/events` contract until its callers have migrated; do not silently change
  its meaning or route public reports through the development-only demo bridge.

The running application now serves `src/app/`. The old batch endpoint and
scenario bridge routes were retired during consolidation; their reusable modules
remain. Integrate them into the served API after reconciling the report contract.

## Broader contract progress

- [x] Add the envelope schema (`src/lib/report.ts`) and the scenario adapter.
- [x] Add the exact HappyRobot `normalized_report` validator and inbound adapter.
- [ ] Add public form and remaining non-HappyRobot channel adapters.
- [ ] Test text-only reports, textual/GPS locations, coordinate pairing/ranges,
      reporter vs incident semantics, unknown fields and missing extraction.
- [x] Test scenario retry identity, structured readings and no ground-truth leak.
- [x] Add durable HappyRobot Signal persistence and expose the route under
      `src/app/`; synchronous recovery is implemented for this first slice.
- [ ] Migrate the broader batch contract to durable background scheduling.
- [ ] Test mixed batches, duplicate deliveries, scheduling failure and recovery.
- [ ] Add the reporting form: text, optional device location or incident pin,
      textual place alternative, and a receipt distinct from triage results.

The existing SQL proposal still needs reconciliation for an unassessed report
with unknown category, severity and location. Do not fabricate those values to
satisfy the old model. No schema or runtime behavior changes with this decision.
