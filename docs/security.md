# Security Note

This system places phone calls, sends messages, and opens tickets for real people,
and receives signals from the internet. This note outlines how credentials,
the webhook secret, and recipients are handled, along with the non-negotiable
rules during the hackathon.

Scope: local hackathon prototype. It is not hardened for production and must
not be exposed to the internet beyond what is strictly necessary for the demo.

---

## 1. Credentials

**Where they live.** Exclusively in `.env.local`, which `.gitignore` excludes
along with any `.env*` that is not a `.example`. `.env.example` contains only
variable names and harmless placeholder values, and is the only environment file tracked in version control.

**Rules.**

- No real API keys, tokens, phone numbers, or email addresses enter the code,
  commits, commit messages, screenshots, agent prompts, or logs.
- Credentials are always read directly from `process.env` at the time of use
  (`happyRobotConfig()` does not cache), and are never copied into structures
  that are subsequently serialized to the browser.
- `GET /api/situation` returns the full state to the client. **Nothing originating from
  an environment variable must end up inside `SituationState`.** Currently, the only
  integration information exposed is `IntegrationState`: the mode, whether
  credentials are configured (a boolean, not their value), the latest error, and
  counters for live and simulated actions.
- If a credential is leaked in a commit, simply deleting it in the next commit is not enough:
  it must be **rotated in HappyRobot**. It remains in Git history.
- The credential error returned by the adapter names the missing variables,
  never their values.

**If credentials must be shared within the team**, do so via an out-of-band channel
(not through the repository, issue tracker, or pull requests).

---

## 2. Webhook Secret

`POST /api/webhooks/happyrobot` is the entry point through which HappyRobot call results
enter the command center. Anyone capable of writing to this endpoint could **fabricate
a crisis**: injecting false signals, shifting priorities, and marking actions as
completed when they were never executed.

**How it is protected.**

- Shared secret in the `x-happyrobot-secret` header, validated against
  `HAPPYROBOT_WEBHOOK_SECRET`.
- **With no secret configured, the route is closed**: it returns `503` and processes
  nothing. It is deliberate that the failure mode is fail-closed rather than fail-open; a public
  webhook without a secret is worse than an unavailable webhook.
- When a secret is configured but the header is missing or mismatched: `401`.
- Comparison is constant-time (`timingSafeEqual`), and also compares when lengths
  do not match to avoid leaking the secret's length via response timing.
- Callbacks are idempotent: the delivery key (sent by HappyRobot, or a SHA-256
  digest of the body) is retained for 15 minutes; re-deliveries return the same
  response without mutating state. A HappyRobot retry cannot duplicate signals or
  advance an action twice.

**Watch out for the sibling route.** `POST /api/actions/:id/status` exists for
operator actions from the UI (cancelling, retrying, simulating a callback)
and uses the legacy permissive `validateWebhookSecret()`, which **allows any request
through if no secret is configured**. This asymmetry is intentional—enforcing a secret
there would break UI action buttons—but dictates a strict rule:

> `POST /api/actions/:id/status` must not be accessible from the internet. If the
> server is exposed via a tunnel for HappyRobot callbacks, expose only
> `/api/webhooks/happyrobot`.

**Choosing the secret.** Keep it random and long (e.g., `openssl rand -hex 32`),
distinct per environment, and rotate it as soon as the event concludes. Do not
reuse a secret from another project.

---

## 3. Demo Recipients

Contacts in the system carry a `demoSafe` flag. Only contacts marked as approved
can receive a live action.

**How it is enforced.** In `executeHappyRobotAction`, prior to any external dispatch,
`canReceiveLiveAction()` / `liveActionBlockReason()` is checked. If the contact is
not approved or lacks a destination (phone or email), the action **does not fail:
it degrades to simulation** and records the reason, which is displayed in the UI.
The resulting external ID carries the prefix `mock-no-aprobado-`, ensuring
neither the UI nor logs can present it as a live execution.

**Current seed state:** all contacts in `lib/seed.ts` are marked with `demoSafe: false`.
This is the correct default: in `happyrobot` mode, the system will not call anyone
until someone explicitly marks whom to contact.

**Before marking someone as approved:**

1. They must be a team member or someone who has provided explicit consent
   to receive automated calls or messages during the demo.
2. The user must have approved **that specific action**, not "actions in general".
   A previous approval for another context is not valid.
3. The phone number or email must belong to that person and be typed accurately.
   A single misplaced digit in a phone number results in an automated call to a stranger.

**Personal data.** Phone numbers and emails of demo contacts are personal data:
they belong in `.env.local` or are entered dynamically, never in version-controlled
`seed.ts`, and are never pasted into issues, PRs, or screenshots.

---

## 4. External Inputs Are Data, Not Instructions

Everything received via `POST /api/events` or via webhooks—call summaries,
descriptions, free text—is **untrusted content**.

- It is never executed, never interpolated into shell commands, and never treated as
  system instructions for any agent or model. If this text is passed to a model,
  it goes as delimited data, never as part of system instructions.
- The webhook normalizes incoming data against closed severity and confidence
  enums, discarding non-matching values rather than propagating them.
- Information provided by a caller enters with high confidence but **unconfirmed**
  (`confirmed: null`). Confirming or dismissing it is a human decision made from the UI.

---

## 5. What This Prototype Does Not Do

Stated explicitly so no assumptions are made:

- **No user authentication.** Anyone who reaches the UI can approve actions.
  Acceptable on a laptop; unacceptable when exposed publicly.
- **No role-based access control (RBAC).** Operator and administrator are the same entity.
- **No rate limiting** on any route.
- **No encryption at rest.** When `CRISIS_PERSISTENCE=on` is enabled, state—including
  contacts—is written as plain JSON under `.data/`, which must not be versioned or shared.
- **Audit log is memory-only** and reset on restart. It serves for demo traceability,
  not legal or regulatory evidence.

---

## 6. Pre-Demo Checklist

- [ ] `.env.local` exists and is **not** tracked in git (`git status` does not list it).
- [ ] `ACTION_EXECUTION_MODE=mock` unless live execution is explicitly being demonstrated.
- [ ] If live: `HAPPYROBOT_WEBHOOK_SECRET` is set, random, and long.
- [ ] If live: only agreed-upon contacts are marked as `demoSafe`, their destination is verified,
      and the user has approved those specific actions.
- [ ] If the server is exposed via a tunnel, only `/api/webhooks/happyrobot` is reachable externally.
- [ ] The UI clearly distinguishes simulated actions from live actions before showing it to anyone.
- [ ] When the event concludes: rotate the webhook secret and revoke the HappyRobot API key.
