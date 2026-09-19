# HappyRobot Documentation Notes

> Status (2026-09-19): `https://docs.happyrobot.ai` (introduction, API reference,
> `integrations/webhook`, `developer-tools/mcp`) is gated behind an access code.
> The public API contract below was recovered from the public npm package
> `@happyrobot-ai/sdk` 0.1.50 (MIT), the public product pages and the
> step-by-step tutorial on happyrobot.ai. Treat it as verified for URL, auth,
> trigger and run endpoints; treat payload field names inside a workflow as
> ours to define. The adapter in `src/lib/happyrobot.ts` follows this contract
> and the trigger params of the FARO workflows described below; live runs have
> not been exercised yet. Ask the HappyRobot team at the event for the docs
> access code to confirm concurrency and cost limits.

## Executive Summary

HappyRobot is an agentic operations platform for AI workers across voice,
SMS, email, WhatsApp, web chat, Slack and Teams. The unit of work is a
**workflow**: a versioned graph of nodes (trigger, agent, action, condition,
tool) published per environment (`development`, `staging`, `production`). A
workflow is executed as a **run**; each conversation inside a run is a
**session** with messages, recordings and extracted variables.

For this project:

- This app decides (priorities, resources, approval gates, idempotency).
- HappyRobot executes the outward communication (call, SMS, email) and
  extracts structured answers.
- The workflow's final node posts those answers back to our webhook, which
  turns them into signals and triggers a replan.

## Verified public API contract

Source: `core/http.js`, `resources/*.js`, `helpers/trigger-and-wait.js` and
`README.md` of `@happyrobot-ai/sdk` 0.1.50.

| Item                 | Value                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| Base URL (US)        | `https://platform.happyrobot.ai/api/v2`                                                |
| Base URL (EU)        | `https://platform.eu.happyrobot.ai/api/v2`                                             |
| Authentication       | `Authorization: Bearer <key>`; keys look like `sk_live_...` or `sk_test_...`           |
| API key origin       | Platform UI: Settings > Profile > Generate API Key (keys are per environment)          |
| Trigger a run        | `POST /workflows/{workflowIdOrSlug}/runs`                                              |
| Trigger body         | `{ "payload": { ...workflow variables... }, "environment": "production" }`             |
| Trigger response     | `{ "run_id": "..." }`                                                                  |
| Run status           | `GET /runs/{run_id}`; terminal: `completed`, `succeeded`, `failed`, `canceled`, `skipped` |
| Node executions      | `GET /runs/{run_id}/nodes?node_persistent_id=...`, then `GET /runs/{run_id}/outputs/{output_id}` |
| Sessions             | `GET /runs/{run_id}/sessions`, `GET /sessions/{id}`, `GET /sessions/{id}/messages`     |
| Live transcript      | SSE `GET /sessions/{id}/stream` (events `connected`, `message`, `session_ended`)       |
| Cancel               | `POST /runs/{run_id}/cancel`; `POST /workflows/{id}/cancel-runs` (also unpublishes)    |
| Contacts             | `GET /contacts/resolve?phone_number=...`, `GET /contacts/{id}/interactions`            |
| Pagination           | `page`, `page_size`, `sort` query params; response `{ data, pagination }`              |
| SDK retry policy     | Retries 429/5xx with exponential backoff (default 2); 30 s timeout                     |

Environments are separate publish targets with separate keys and separate
webhook URLs. `file` uploads use multipart on the same trigger endpoint.

### Webhook trigger (no API key path)

Every workflow with a Webhook trigger node also exposes a direct URL per
environment, shown in the node's Setup > Test tab. Public examples use the
pattern `https://workflows.platform.happyrobot.ai/hooks/<id>`. Any method
works (POST recommended), the JSON body defines the variables available to
downstream nodes, and "Enhanced Security" makes the endpoint require an
`x-api-key` header. This is equivalent to the REST trigger above for our
purposes; the REST path is preferred because it returns a `run_id`.

### Callbacks to this app

There is no platform-level "callback URL" setting. Results reach us through a
**Webhook action node inside the workflow** that does `POST` to our public
URL with whatever variables we map (for example the output of an AI Extract
node). Consequences:

- The callback body shape is defined by us when building the workflow. Use the
  shape in "Inbound callback shape" below so
  `src/app/api/webhooks/happyrobot/route.ts` accepts it unchanged.
- Add the header `x-happyrobot-secret: <HAPPYROBOT_WEBHOOK_SECRET>` in that node.
- Local development needs a public tunnel for the platform to reach the app.
- As a fallback when no callback arrives, poll `GET /runs/{run_id}` and read
  the extract node output via `/runs/{run_id}/nodes` + `/outputs/{output_id}`.

## Developer tooling

- `@happyrobot-ai/sdk` (npm, MIT, Node >= 18): `new HappyRobotClient({ apiKey, cluster })`,
  `client.workflows.triggerRun(id, { payload, environment })`, `client.runs.get(runId)`,
  `client.sessions.getMessages(id)`. Helper `triggerAndWait` from
  `@happyrobot-ai/sdk/helpers` polls until a terminal status and returns run
  plus sessions; `triggerAndWaitForNodeOutput` returns one node's output.
  Browser clients (`/voice`, `/chat`) need a scoped token created server-side.
- MCP for building workflows from the IDE (OAuth, no key in the repo):
  `claude mcp add --transport http happyrobot-workflows https://mcp.platform.happyrobot.ai/workflows/mcp`.
  The stdio package `@happyrobot-ai/mcp` is deprecated in favour of this URL.
  Tools include `create_workflow`, `update_workflow_nodes`, `manage_versions`,
  `trigger_run`, `monitor_runs`, `test_workflow`.
- `@happyrobot-ai/workflow-sdk` (typed workflows as code) and the Python SDK
  `happyrobot` exist; not evaluated.
- Builder site: `https://builder.happyrobot.ai`; platform UI: `https://platform.happyrobot.ai`.

## Platform concepts (condensed)

- **Agents**: prompt-driven workers with persona, procedures, tools and human
  handoff; one definition deploys to voice, SMS, email, WhatsApp, chat, Teams, Slack.
- **Nodes**: Action (integration events), Prompt (AI conversation), Condition
  (branching), Tool (mid-conversation functions), plus AI Extract / Classify and
  Webhook. Variables are referenced as `{{index.field}}` or `@name` in the UI.
- **Runs and sessions**: the Runs tab shows every execution with status,
  version and environment, and per-run transcripts and error logs.
- **Context**: structured records built from interactions (contacts,
  interactions, AI memories), readable through the API and MCP.
- **Integrations**: 200+ connectors (Slack, Teams, Twilio SMS, WhatsApp,
  Google Sheets, ticketing, databases) exposed as workflow actions.

## Mapping to this repository

### Responsibilities

Local app (`src/`): ingest reports (`POST /api/signals`, `POST /api/events`),
keep state, score priorities, propose actions, require human approval, track
status and failures, show everything to the operator.

HappyRobot: call or message demo contacts, ask for confirmations, extract
structured answers, escalate to coordinators, and post results back.

### FARO workflows in the hackathon workspace (EU cluster)

Built by the team in HappyRobot; ids are identifiers, not secrets. None is
published yet and each still ends in a `BLOCKED` code node that must become a
Webhook node posting to FARO (see TASKS.md).

| Workflow                          | Id                                     | Direction | FARO side                                            |
| --------------------------------- | -------------------------------------- | --------- | ---------------------------------------------------- |
| FARO — Resource Dispatch          | `01a0b6ed-542f-7485-a6c4-d13e192b6235` | outbound  | `HAPPYROBOT_DISPATCH_WORKFLOW_ID`; callback `dispatch_result` |
| FARO — Public Alert — SMS         | `01a0b8d3-914c-76c0-b7a9-dc1abe0afe0e` | outbound  | `HAPPYROBOT_PUBLIC_ALERT_WORKFLOW_ID`; callback `public_alert_result` |
| FARO — Inbound Reporter — Voice   | `01a0b6ac-8ae4-7400-8ae6-df29f46c2246` | inbound   | posts `normalized_report` to `POST /api/signals`     |
| FARO — Inbound Reporter — SMS     | `01a0b6bb-23ef-7202-a282-12a8d5dd3c01` | inbound   | same; needs a bound number and SMS credentials       |
| FARO — Inbound Reporter — WhatsApp| `01a0b6c9-4d1c-707e-85d7-d0f30682b3a1` | inbound   | optional; no Meta credentials                        |

### Integration flow

1. A report enters via `POST /api/signals` (HappyRobot Inbound Reporter), the UI or
   `POST /api/events`; state and priorities update.
2. The app proposes actions; the operator approves a high-impact one.
3. `src/lib/happyrobot.ts` picks the workflow by channel (`call` → dispatch,
   `sms` → public alert, otherwise the generic workflow) and triggers a run in
   `HAPPYROBOT_ENVIRONMENT` with an idempotency key per attempt. The `run_id`
   becomes the action's `externalActionId`.
4. HappyRobot runs the agent and its deterministic code nodes.
5. The workflow's Webhook node posts the result to `POST /api/webhooks/happyrobot`
   with `x-happyrobot-secret`.
6. The app moves the action, updates resource availability, ingests what the
   responder said as a signal and replans.

### Outbound trigger payloads (`payload` of `POST /workflows/{id}/runs`)

Built by `buildDispatchPayload`, `buildPublicAlertPayload` and
`buildGenericPayload`; the keys are the trigger params defined in each workflow.

Resource Dispatch (`dispatch_id` is the idempotency key `<action>:<attempt>`):

```json
{
  "dispatch_id": "act_123:1",
  "incident_id": "faro-sierra-bermeja-demo",
  "plan_id": "plan_7",
  "action_id": "act_123",
  "resource_id": "res-field-1",
  "resource_display_name": "INFOCA Sierra Bravo",
  "resource_type": "field",
  "resource_contact_name": "Field coordinator",
  "resource_phone": "+34600000000",
  "mission_summary": "Confirm deployment to the north sector",
  "mission_destination": "Sierra Bermeja north",
  "mission_requested_eta": "",
  "mission_instructions": "...",
  "context": "...",
  "requested_at": "2026-09-19T12:00:00.000Z"
}
```

Public Alert (the HappyRobot gate only sends when `approval_status` is `approved`;
`recipients` are the explicit demo-safe numbers, never discovered):

```json
{
  "action_id": "act_124",
  "incident_id": "faro-sierra-bermeja-demo",
  "plan_id": "plan_7",
  "approval_status": "approved",
  "approval_approved_by": "operator",
  "approval_approved_at": "2026-09-19T12:00:00.000Z",
  "audience_id": "zone-north",
  "audience_label": "Sierra Bermeja north",
  "simulated_population_count": 1200,
  "recipients": [{ "recipient_id": "con-demo", "phone": "+34600000000" }],
  "message": "...",
  "requested_at": "2026-09-19T12:00:00.000Z"
}
```

### Inbound callbacks (`POST /api/webhooks/happyrobot`)

Header: `x-happyrobot-secret`. Optional dedup header: `x-happyrobot-delivery-id`.
The route accepts the object or its `*_json` string variable.

`dispatch_result` (from "Normalize Outcome"): `dispatch_status` in `accepted`,
`accepted_with_constraint` → action `succeeded`; `rejected`, `unavailable`,
`unclear` → `blocked` (operator decides) and the resource becomes `unavailable`
for `rejected`/`unavailable`; `no_answer`, `failed` → `failed`.
`responder_statement` and `claims` enter as a `dispatch-feedback` signal.

`public_alert_result` (from "Build Public Alert Result"): `completed` →
`succeeded`; `partial` → `blocked` with the failed count; `failed` → `failed`;
`not_approved` → `blocked` (gate refusal).

Generic shape, still accepted:

```json
{
  "externalActionId": "<run_id>",
  "localActionId": "act_123",
  "status": "completed | failed | needs_human | in_progress",
  "summary": "What happened",
  "newInformation": [
    { "type": "road_blocked", "zoneId": "north", "description": "MA-8301 blocked at km 12" }
  ]
}
```

### Inbound reports (`POST /api/signals`)

The Inbound Reporter workflows post the `normalized_report` object itself (not
the `normalized_report_json` string) with `x-happyrobot-secret`. The route
validates it against the exact schema in `src/lib/signals/happyrobot.ts`
(unknown keys are rejected), stores the raw report durably in the Supabase table
`public.signals` (`src/lib/signals/repository.ts`, migration
`supabase/migrations/202609190001_happyrobot_signals.sql`) and only then
interprets it in FARO (`src/lib/signals/process.ts`): zone, category, severity
and confidence are derived here and cannot be set by the caller. The signal
identity is `happyrobot:<channel>:<native_interaction_id>` (or a payload hash
when the id is null), so a redelivered report returns the same `signalId` and
`eventId` with `duplicate: true` instead of creating a second event. The
response is `{ signalId, eventId, duplicate, status }`; without Supabase
credentials the route answers `503 persistencia_no_disponible` and nothing is
accepted. Public (citizen) reports are not accepted on this route yet.

### Remaining gaps

| Gap                                            | Status                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Workflows end in `BLOCKED` nodes               | Replace with Webhook nodes to a public FARO URL (tunnel in local dev). |
| Status after live dispatch                     | Stays `running` until the callback; add `GET /runs/{run_id}` polling.  |
| Webhook triggers without `enhanced_security`   | Enable API key auth on Dispatch and Public Alert triggers.             |
| SMS provider                                   | Telnyx number is not toll-free and no Twilio credentials exist.        |
| `HAPPYROBOT_IDEMPOTENCY_HEADER`                | Not documented publicly; harmless, the key also travels as `dispatch_id`. |

Do not resolve credentials or workflow ids with invented values.

## Mocking without credentials

Three levels, cheapest first:

1. **Built-in mock mode** (`ACTION_EXECUTION_MODE=mock`, the default). Nothing
   leaves the process; actions succeed immediately with `mock-simulado-*` ids
   and the UI labels them as simulated. Limitation: no field answer ever
   arrives, so replanning from a callback is not exercised.
2. **Replay the callback by hand** against the real webhook route. This does
   exercise ingestion, dedup and replanning:

   ```bash
   curl -X POST http://localhost:3000/api/webhooks/happyrobot \
     -H "content-type: application/json" \
     -H "x-happyrobot-secret: $HAPPYROBOT_WEBHOOK_SECRET" \
     -d '{"localActionId":"<action id>","status":"completed","summary":"Sector chief confirms dense smoke","newInformation":[{"type":"road_blocked","zoneId":"<zoneId>","description":"MA-8301 blocked at km 12","severity":"high","confirmed":true}]}'
   ```

3. **Fake HappyRobot server**: a small local server answering
   `POST /workflows/:id/runs` with `{ "run_id": "fake-..." }` and posting the
   callback above to our webhook a few seconds later. Point
   `HAPPYROBOT_BASE_URL` at it and mark one fictitious contact `demoSafe: true`
   to rehearse `ACTION_EXECUTION_MODE=happyrobot` end to end at zero cost.

Tests in `tests/integration.test.ts` stub `fetch` and must never reach the network.

## Implementation Checklist

- Finish the workflows (UI or MCP): replace each `BLOCKED` node with a Webhook
  node posting to our callback or signals route with the shared secret; publish
  to `development` first.
- Set the workflow ids and the EU base URL in `.env.local`.
- Keep `ACTION_EXECUTION_MODE=mock` by default; enable `happyrobot` only with
  approved `demoSafe` recipients and explicit approval for each live action.
- Store credentials in `.env.local` only (Next.js does not read `env.local`).
- Require and validate `HAPPYROBOT_WEBHOOK_SECRET` on callbacks.
- Log the `run_id` as `externalActionId`; show `mock` vs `happyrobot` per action.
- Treat external failures as visible state, never silent success.
- Confirm concurrency and cost limits of the hackathon account with the HappyRobot team.

## Demo Opportunities

- Voice call to a sector chief asking whether an evacuation route is still open.
- SMS to a volunteer team with a concise assignment and acknowledgement request.
- Email summary to an operations lead after the plan changes.
- Slack/Teams escalation when an integration fails or a capacity event arrives.
- Inbound reply that becomes a new event and forces reprioritisation.

The strongest story is not "we sent a message". It is: the situation changed,
the system noticed, it reprioritised, it acted through HappyRobot, then it
incorporated the answer and updated the plan under human supervision.

## Source Notes

Reviewed on 2026-09-19:

- `https://docs.happyrobot.ai/introduction`, `/api-reference/introduction`,
  `/integrations/webhook`, `/overview/workflows`,
  `/api-reference/dial/create-outbound-call`, `/developer-tools/mcp`: all
  return an access-code gate.
- `https://www.happyrobot.ai/product/developer-tools`, `https://builder.happyrobot.ai`.
- `https://www.happyrobot.ai/hub/how-to-use-happyrobot-a-step-by-step-tutorial`.
- npm: `@happyrobot-ai/sdk` 0.1.50 (README, `core/http.js`, `helpers/*.js`),
  `@happyrobot-ai/mcp` 0.1.25 (README), `@happyrobot-ai/workflow-sdk`.
- `https://github.com/happyrobot-ai` (Python SDK, web SDK examples).
