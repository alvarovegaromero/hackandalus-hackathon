# Demo Runbook

How to run a live FARO demo with a real HappyRobot webhook. This is an
operational checklist, not an architecture document — see
[architecture.md](architecture.md) and [data-model.md](data-model.md) for that.

## Why this needs one long-lived process

Events, the Digital Twin, the Plan, Actions, the audit trail and the
`/api/telemetry` SSE stream all live in **process-local memory**
(`src/lib/store.ts`, `src/lib/event-pipeline.ts`). There is no shared/durable
state across processes for this operational data (only the raw HappyRobot
`signals` receipt is durable, in Supabase — see `docs/data-model.md`).

Consequences:

- Restarting the Next.js process resets the situation, plan, actions and
  audit trail to the initial scenario state.
- Only one FARO process may serve the demo. Do not run a second `npm run dev`
  or `npm start` alongside it: it would hold separate, diverging state.
- The public tunnel must point at that same single process for its entire
  lifetime, or HappyRobot calls will land in a different process's memory
  than the one the operator dashboard is watching.

## Demo startup sequence

### A. Start FARO

```sh
npm run build
npm start -- -p 3100
```

Keep this process running for the whole demo. Do not run `npm run build`
again against this same working directory while it is serving — a rebuild
in place overwrites the `.next` output the running server reads from and can
disrupt in-flight requests. If you need to rebuild, do it in a separate
worktree/checkout and swap processes deliberately, not by rebuilding under
the live one.

### B. Verify FARO is serving

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/api/situation
```

Expect `200`.

### C. Start the temporary Cloudflare tunnel

```sh
cloudflared tunnel --url http://localhost:3100
```

Read the assigned `https://<random-words>.trycloudflare.com` URL from
`cloudflared`'s startup log.

### D. Verify the public URL

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://<PUBLIC_HOST>/api/situation
```

Expect `200`.

### E. Point HappyRobot at the public URL

Configure the Inbound Reporter workflow's Webhook node to call:

```
POST https://<PUBLIC_HOST>/api/signals
```

with the header `x-happyrobot-secret: <HAPPYROBOT_WEBHOOK_SECRET>` (same
value as `.env.local`), sending the `normalized_report` shape from
`src/lib/happyrobot.ts`'s `happyRobotNormalizedReportSchema`. See
`docs/happyDocumentation.md` for the full workflow contract.

### F. Keep both processes running

**Both** the FARO process (A) and the `cloudflared` process (C) must stay
running, uninterrupted, for the entire demo. If either exits, the public URL
stops working (or in FARO's case, the whole app stops responding).

### G. The tunnel URL is temporary

A Cloudflare **quick** tunnel (`cloudflared tunnel --url ...`, no account) is
not a stable, reusable hostname. Every time the `cloudflared` process is
restarted, it is assigned a **new random** `trycloudflare.com` subdomain.

### H. If the public URL changes, update HappyRobot first

If `cloudflared` has to be restarted for any reason during demo prep, the
HappyRobot webhook configuration (step E) must be updated with the new
`<PUBLIC_HOST>` **before** relying on it again — otherwise HappyRobot keeps
calling a dead URL and reports silently fail to arrive.

## Pre-demo checklist

Run through this immediately before going live:

- [ ] `.env.local` present, with `SUPABASE_*` and `HAPPYROBOT_WEBHOOK_SECRET` set.
- [ ] FARO process alive (`ps`/terminal check on the process from step A).
- [ ] `GET http://localhost:3100/api/situation` returns `200`.
- [ ] Cloudflare tunnel process alive (step C's `cloudflared` still running).
- [ ] `GET https://<PUBLIC_HOST>/api/situation` returns `200`.
- [ ] HappyRobot webhook URL matches the **current** public URL (re-check
      after any tunnel restart — see G/H above).
- [ ] `x-happyrobot-secret` is configured in both `.env.local` and the
      HappyRobot Webhook node, and the two values match.
- [ ] One real HappyRobot test call succeeds end to end (not a curl
      simulation — trigger it from HappyRobot itself).
- [ ] The resulting signal appears in Supabase `public.signals`
      (`processing_status = 'processed'`, `event_id` set).
- [ ] The resulting Event appears in FARO (`GET /api/situation` shows it,
      with a matching zone/Digital Twin update and audit entries).
- [ ] The operator dashboard (`/`) visibly updates with the new event/action.
- [ ] Mac sleep disabled (`caffeinate`, or System Settings) so the demo
      machine cannot suspend mid-demo and kill both processes.
