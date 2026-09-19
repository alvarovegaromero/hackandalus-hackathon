# HappyRobot Documentation Notes

> Status (2026-09-19): `https://docs.happyrobot.ai` (introduction, API reference,
> `integrations/webhook`, `developer-tools/mcp`) is gated behind an access code.
> The public API contract below was recovered from the public npm package
> `@happyrobot-ai/sdk` 0.1.50 (MIT), the public product pages and the
> step-by-step tutorial on happyrobot.ai. Treat it as verified for URL, auth,
> trigger and run endpoints; treat payload field names inside a workflow as
> ours to define. **The adapter in `src/lib/happyrobot.ts` still ships defaults
> invented before this contract was known; see "Gap between code and contract"
> before enabling live mode.** Ask the HappyRobot team at the event for the
> docs access code to confirm concurrency and cost limits.

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

Local app (`src/`): ingest events (`POST /api/events`), keep state,
score priorities, propose actions, require human approval, track status and
failures, show everything to the operator.

HappyRobot: call or message demo contacts, ask for confirmations, extract
structured answers, escalate to coordinators, and post results back.

### Integration flow

1. Event enters via UI or `POST /api/events`; state and priorities update.
2. The app proposes actions; the operator approves a high-impact one.
3. `src/lib/happyrobot.ts` triggers the workflow run (idempotency key per attempt).
4. HappyRobot runs the channel-specific agent.
5. The workflow's Webhook node posts status and `newInformation` to
   `POST /api/webhooks/happyrobot`.
6. The app records the result, ingests new signals and replans.

### Outbound trigger payload (what we send as `payload`)

```json
{
  "channel": "voice | sms | email",
  "target": "recipient-or-system-id",
  "destination": "+34600000000 | name@example.org",
  "objective": "Short task the HappyRobot agent must complete",
  "briefing": { "headline": "...", "detail": "...", "askFor": "..." },
  "metadata": {
    "localActionId": "act_123",
    "zoneId": "north",
    "reason": "Evacuation priority increased after wind shift",
    "idempotencyKey": "act_123:1",
    "callbackUrl": "https://<public-host>/api/webhooks/happyrobot"
  }
}
```

These keys become the workflow's trigger variables; the agent prompt and the
Webhook node reference them by name.

### Inbound callback shape (what the workflow posts to us)

```json
{
  "externalActionId": "<run_id>",
  "localActionId": "act_123",
  "status": "completed | failed | needs_human | in_progress",
  "summary": "What happened",
  "newInformation": [
    {
      "type": "road_blocked",
      "zoneId": "north",
      "description": "MA-8301 blocked at km 12",
      "severity": "high",
      "confidence": "high",
      "confirmed": true
    }
  ]
}
```

Header: `x-happyrobot-secret`. Optional dedup header: `x-happyrobot-delivery-id`.
Accepted `status` values are mapped in the route (`completed`, `success`,
`in_progress`, `needs_human`, `failed`, `cancelled`, and aliases).

## Gap between code and contract

`src/lib/happyrobot.ts` and `.env.example` predate this information. Everything is
environment-configurable, but the following defaults and checks are wrong for
the real API and must change before live mode works:

| Setting / check                          | Current default                     | Real contract                                     |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| `HAPPYROBOT_BASE_URL`                    | `https://api.happyrobot.ai`         | `https://platform.happyrobot.ai/api/v2`           |
| `HAPPYROBOT_ACTION_PATH`                 | `/agents/{agentId}/actions`         | `/workflows/{workflowId}/runs`                    |
| `HAPPYROBOT_PAYLOAD_SHAPE=trigger` body  | `{ "input": ..., "idempotencyKey" }` | `{ "payload": ..., "environment": ... }`          |
| `HAPPYROBOT_RESPONSE_ID_PATH`            | `id,actionId,action_id,data.id`     | `run_id`                                          |
| `isHappyRobotConfigured()`               | requires `HAPPYROBOT_AGENT_ID`      | only workflow id and API key are needed           |
| Status after live dispatch               | stays `running` until callback      | add `GET /runs/{run_id}` polling as fallback      |
| `HAPPYROBOT_IDEMPOTENCY_HEADER`          | sent as `idempotency-key`           | not documented publicly; harmless, keep in payload too |

Tracked in `TASKS.md` ("Verify live HappyRobot contract"). Do not resolve
credentials or workflow ids with invented values.

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

- Build the workflow (UI or MCP): Webhook trigger with the outbound payload
  schema, voice/SMS agent, AI Extract with the `newInformation` fields, Webhook
  node posting to our callback with the shared secret.
- Align adapter defaults with the contract table above; relax the agent-id check.
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
