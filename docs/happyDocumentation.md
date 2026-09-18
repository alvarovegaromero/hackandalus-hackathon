# HappyRobot Documentation Notes

> Status: the requested page, `https://docs.happyrobot.ai/introduction`, is access-restricted and requires an access code. This document summarizes the public HappyRobot product documentation available on 2026-09-18 and translates it into implementation guidance for this hackathon project. Validate endpoint names and payloads against the private docs before enabling live actions.

## Executive Summary

HappyRobot is an agentic operations platform for deploying AI workers across voice, SMS, email, WhatsApp, web chat, Slack, Teams, and other operational channels. The platform is built around agents that can reason during a workflow, call tools, read and write operational context, trigger external systems, and surface outcomes through human-facing interfaces.

For this project, the useful framing is:

- Agents are the execution layer: they communicate, decide when to call tools, escalate, and continue workflows across channels.
- Context is the shared data layer: interactions and external data become structured records that can drive later decisions, dashboards, audits, and reporting.
- Integrations are scoped actions: agents can read records, write outcomes, create tickets, send messages, query systems, and trigger follow-ups.
- Interfaces are the supervision layer: humans can see what agents did, what changed, and where intervention is needed.
- Governance is the quality layer: HappyRobot emphasizes benchmarks, pre-deployment tests, production audits, and continuous improvement.

## Platform Concepts

### Agents

HappyRobot agents are autonomous AI workers that handle conversations, follow procedures, use shared context, and invoke tools. Public documentation describes agents as configurable through:

- Agent definition: how the agent thinks, speaks, and acts.
- Persona and boundaries: tone, communication rules, sensitive-topic handling, and "always/never" instructions.
- Operating procedures: step-by-step workflows for specific situations.
- Channel deployment: one agent logic layer can be deployed across voice, SMS, email, WhatsApp, web chat, Teams, and Slack.
- Session continuity: context can persist across sessions and authenticated data can be injected at session start.
- Human handoff: escalation can route into channels such as Slack or Microsoft Teams.

For the crisis demo, an agent should not be a generic chatbot. It should have a crisis-specific procedure: classify incoming information, update the situation, decide whether priority changed, select a concrete action, and ask for human approval when the action is high-risk.

### Agentic Tools

Agentic tools are actions an agent can invoke mid-workflow instead of handing work to a human. Public docs list examples such as:

- Looking up information.
- Reading documents or pages.
- Writing to a system.
- Sending messages.
- OCR on images, PDFs, or scanned documents.
- Browser agents for legacy systems without APIs.
- Retrieval from SOPs, policies, contracts, documentation, or training material.
- Image and document understanding.
- Multi-channel inbound and outbound messaging.

For this repo, the current action queue maps cleanly to this model. Each local `Action` should correspond to one HappyRobot action or workflow invocation, with an idempotency key derived from the local action id so retries do not duplicate calls or messages.

### Workflow Logic

HappyRobot supports deterministic workflow logic when predictable execution matters. Public docs mention branching paths, conditional routing, retry logic, fallback behavior, custom code, parallel tasks, list iteration, and trigger types such as inbound calls, webhooks, scheduled runs, file uploads, or inbound messages.

For crisis management, deterministic workflow boundaries are important:

- Use AI for interpretation, summarization, classification, and natural communication.
- Use deterministic code for priority scoring, resource constraints, idempotency, approval gates, and retry limits.
- Use explicit fallback paths when an integration fails or a channel is unavailable.

### Context

Context is described as the layer where agent interactions and external-system data become structured operational data. Public documentation highlights extracting, classifying, mapping interactions, contact intelligence, pre-loading data at session start, and making context available to downstream workflows and reporting.

For this project, Context should represent:

- Incidents and zones.
- Events and evidence.
- Available resources.
- Action queue and execution status.
- Contact profiles and escalation targets.
- Plan versions and why they changed.
- Historical run outcomes for the challenge bonus around learning from past interactions.

### Integrations

HappyRobot publicly describes 200+ native integrations across CRMs, ERPs, ticketing platforms, databases, communication tools, maps/logistics APIs, and domain-specific APIs. Integrations are exposed to agents as scoped workflow actions such as reading a record, writing an outcome, creating a case, escalating to a queue, or triggering a follow-up.

Relevant integration categories for the crisis demo:

- Communication: SMS, email, Slack, Teams, voice calls.
- Ticketing: create or update emergency tasks, cases, or field assignments.
- Databases: read/write crisis state, contacts, resources, and action results.
- Maps/logistics: verify locations, routes, blocked roads, and ETA changes.
- Webhooks: connect this Next.js app to HappyRobot without requiring a pre-built connector.

The public docs also mention that webhook nodes can connect HTTP endpoints and that browser agents can handle systems without APIs. For the hackathon, webhooks are likely the fastest integration path.

### Interfaces

Interfaces are HappyRobot's operational UI layer. Public documentation describes purpose-built dashboards/apps that sit on Context, show real-time and historical agent data, trigger workflow actions, log tickets, manage escalations, and provide transparency into what each AI worker is doing.

Our current Crisis Command Center is aligned with this requirement. It should continue to show:

- Situation summary.
- New events.
- Priority reasoning.
- Plan version changes.
- Pending, approved, failed, and completed actions.
- Human approval/intervention controls.
- Integration failures and retries.

### Developer Tools

HappyRobot public docs describe the platform as programmable through:

- REST API for workflows, agents, integrations, contacts, usage, and other resources.
- TypeScript SDK for embedding calls, transcripts, phone number management, and related capabilities.
- MCP server for workflow creation, integration management, evals, and agent configuration through MCP-compatible tooling.
- Web SDK for browser-based voice over WebRTC.
- Embedded chat through a script tag.
- Workflows as code.
- Context REST API and MCP access for reading/writing the Context layer.

The exact API surface is not available without the restricted docs, so the current local integration in `lib/happyrobot.ts` should be treated as a provisional adapter until private docs confirm the real endpoint and payload.

## Recommended Architecture For This Repo

### Local App Responsibilities

Keep these responsibilities in the Next.js app:

- Ingest incoming events through `POST /api/events`.
- Maintain local crisis state for the demo.
- Score priorities deterministically.
- Generate candidate actions.
- Require human approval before live external execution.
- Track action status and failure reasons.
- Expose a clear UI for judges.

### HappyRobot Responsibilities

Use HappyRobot for live external interaction and multi-channel execution:

- Call or message demo contacts.
- Ask for confirmations or field updates.
- Send summaries to human coordinators.
- Create or update tickets in an external system if available.
- Receive inbound replies and push them back into this app as events.

### Integration Flow

Recommended webhook-first flow:

1. Crisis event enters this app through UI demo controls or `POST /api/events`.
2. The app updates situation state and recomputes priorities.
3. The app creates one or more proposed actions.
4. A human approves a high-impact action in the UI.
5. `lib/happyrobot.ts` sends the approved action to HappyRobot.
6. HappyRobot executes the channel-specific workflow.
7. HappyRobot posts status callbacks or newly gathered information back to this app.
8. The app records the result and replans if the new data changes priorities.

### Suggested Payload Shape

Use this as our internal contract until official docs confirm the real shape:

```json
{
  "channel": "voice | sms | email | slack | teams | webhook",
  "target": "recipient-or-system-id",
  "objective": "Short task the HappyRobot agent must complete",
  "metadata": {
    "localActionId": "act_123",
    "zoneId": "north",
    "reason": "Evacuation priority increased after wind shift",
    "planVersion": 4,
    "idempotencyKey": "act_123"
  }
}
```

Inbound callback shape for this app:

```json
{
  "externalActionId": "happyrobot_action_id",
  "localActionId": "act_123",
  "status": "completed | failed | needs_human | in_progress",
  "summary": "What happened",
  "newInformation": [
    {
      "type": "road_blocked",
      "zoneId": "north",
      "description": "A-92 is blocked near exit 241"
    }
  ]
}
```

## Implementation Checklist

- Confirm private-doc endpoint names for agent actions, workflow triggers, callbacks, authentication, and idempotency.
- Keep `ACTION_EXECUTION_MODE=mock` by default.
- Enable `ACTION_EXECUTION_MODE=happyrobot` only with approved demo recipients.
- Store credentials in `.env.local`, never in git.
- Require `HAPPYROBOT_WEBHOOK_SECRET` on callbacks and validate it.
- Add idempotency for every external action.
- Log the external action id returned by HappyRobot.
- Treat external failures as visible state, not silent success.
- Show whether each action ran in `mock` or `happyrobot` mode.
- Avoid sending live messages/calls without explicit approval for the exact demo action.

## Demo Opportunities

Good HappyRobot-backed demo moments:

- Voice call to a field coordinator asking whether an evacuation route is still open.
- SMS to a volunteer team with a concise assignment and acknowledgement request.
- Email summary to an operations lead after the plan changes.
- Slack/Teams escalation when an integration fails or a hospital capacity event arrives.
- Inbound reply from a contact that becomes a new event and forces reprioritization.

The strongest judging story is not "we sent a message." It is: the situation changed, the system noticed, it reprioritized, it executed a concrete external action through HappyRobot, then it incorporated the response and updated the plan under human supervision.

## Source Notes

Public pages reviewed:

- `https://docs.happyrobot.ai/introduction`: access-restricted login page.
- `https://www.happyrobot.ai/product/platform-overview`
- `https://www.happyrobot.ai/product/agents/agents-overview`
- `https://www.happyrobot.ai/product/agents/agentic-tools`
- `https://www.happyrobot.ai/product/agents/integrations`
- `https://www.happyrobot.ai/product/interfaces`
- `https://www.happyrobot.ai/product/developer-tools`

