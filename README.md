# Crisis Command Center

HackSpain 2026 HappyRobot challenge prototype: an agentic crisis command center that ingests changing signals, replans priorities, proposes concrete actions, and lets a human approve or intervene.

## Prerequisites

- Node.js 18.19+
- npm 9+

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm test
```

## HappyRobot Configuration

Set these in `.env.local`:

```bash
HAPPYROBOT_API_KEY=
HAPPYROBOT_WEBHOOK_SECRET=replace-with-a-shared-secret
HAPPYROBOT_BASE_URL=https://api.happyrobot.ai
HAPPYROBOT_AGENT_ID=
ACTION_EXECUTION_MODE=mock
```

Use `ACTION_EXECUTION_MODE=mock` for local demos. Use `ACTION_EXECUTION_MODE=happyrobot` only with demo recipients and valid HappyRobot credentials.

## Demo Flow

1. Start the app with `npm run dev`.
2. Use the demo buttons to inject a new incident, route blockage, resource outage, or integration failure.
3. Watch the priority list and plan version change.
4. Approve an action from the queue.
5. Simulate a callback with `POST /api/actions/:id/status` or use the integration failure demo button.

## API Surface

- `GET /api/situation`
- `POST /api/events`
- `POST /api/actions`
- `POST /api/actions/:id/approve`
- `POST /api/actions/:id/status`
- `POST /api/events/:id/mark`
- `POST /api/demo/inject`
- `POST /api/demo/reset`
