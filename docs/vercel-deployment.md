# Manual Vercel deployment

## Current deployment

The UI was deployed manually on 2026-09-19 to project `faro` in team
`alvaros-projects-329c5aac`:

- [Landing](https://faro-lovat-iota.vercel.app/)
- [Dashboard](https://faro-lovat-iota.vercel.app/dashboard)
- Deployment ID: `dpl_4AajTMyfA6TBfAaQ4R9EFPovEXQZ` (Production, READY).

Unauthenticated HTTP checks returned 200 for `/`, `/dashboard` and `/api/map`.
`/api/state` returned 503 on the initial deployment. Production variables were
subsequently added through the Vercel UI: Supabase URL/public key, provider/model,
Jev model/timeout and mock action mode as Config; Supabase, OpenCode and TypeSafe
private keys plus a newly generated API token as Secret. All 11 names and their
Production-only scope were verified with the CLI. Values are not recorded here.
A redeployment is still required to apply them. Operator authentication, database
connectivity and remote model execution remain unverified. This is a UI deployment,
not a working remote-agent demo.
The GitHub connection attempt failed because a GitHub login connection was
missing; CLI deployment succeeded without it. No Git push was performed.
Local `npm run check` passed on Windows with Node 24. The remote build also
passed, with three dynamic-filesystem tracing warnings in `src/lib/persistence.ts`.

## Build configuration

One Next.js project serves `/`, `/dashboard` and `/api/*`. Use Node.js 24.x
(declared in `package.json`). `vercel.json` selects Next.js, `npm ci` and
`npm run build`, and disables deployments triggered by Git. There is no CI.
Run `npm run check` locally before publishing. Deployment does not apply SQL
migrations or start the standalone subagent worker.

## Current execution boundaries

- The coordinator runs in Next.js `after()` following intake, with a 180-second
  route duration. Configure Vercel Functions to support that duration. Supabase
  stores coordinator state and pending input; process-local scheduling is not
  durable. An interrupted attempt needs another intake request for recovery.
- Subagents currently require `npm run subagents:work` on a persistent Node 24
  host. Vercel does not start this command when deploying Next.js. Running every
  agent within Vercel requires a separate bounded execution and durable scheduling
  implementation, including retries of waiting missions. Do not claim that a
  successful web deployment provides that implementation.
- Parent mission creation and result consumption remain pending in this branch.
  See [the subagent contract](subagent-execution.md). Communication tools are mock
  only, even when model calls are real.
- `CoordinatorPanel` fetches `/api/state` without an authorization header, while
  that route requires `CRISIS_API_TOKEN` in production. A configured token yields
  401 for that browser request; an absent token yields 503. Operator/session
  authentication must be integrated before the hosted panel can display this
  state. Vercel deployment protection does not replace application authentication;
  do not expose the server token in a public environment variable to bypass this.
- Legacy command-center and telemetry state still uses process memory. Do not
  enable `CRISIS_PERSISTENCE` on Vercel: local JSON files are not shared durable
  storage. See [coordinator state](coordinator-state-contract.md) for the durable
  read model and [event telemetry](event-telemetry.md) for legacy limitations.

## Environment and database prerequisites

Configure values in the intended Vercel environment before deploying. Never
upload local credential files or put secrets in `NEXT_PUBLIC_*` variables.

| Purpose                               | Variables                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Coordinator database                  | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`                                 |
| Browser Supabase client, if used      | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                            |
| Jev relevance filtering               | `TYPESAFE_API_KEY`; optional Jev settings in `.env.example`                       |
| AI Gateway model                      | `AI_PROVIDER=gateway`, `AI_MODEL`, `AI_GATEWAY_API_KEY`                           |
| Alternative existing OpenCode adapter | `AI_PROVIDER=opencode-go` or `opencode-zen`, `OPENCODE_MODEL`, `OPENCODE_API_KEY` |
| Protected APIs                        | `CRISIS_API_TOKEN`, `DEMO_API_TOKEN` as required by the selected routes           |
| Inbound HappyRobot reports/callbacks  | `HAPPYROBOT_WEBHOOK_SECRET`                                                       |
| Initial simulated actions             | `ACTION_EXECUTION_MODE=mock`                                                      |

Select one model provider explicitly. The application currently requires an API
key even when using AI Gateway on Vercel. The public site URL is optional; metadata
can use Vercel's production origin. See `.env.example` for the complete inventory.
Direct database connection strings are migration tooling credentials, not required
by the deployed Supabase HTTP client.

Check the target database's migration history before use. The current coordinator
requires the schema through migration 008; subagents additionally require 009.
Apply missing migrations only with authorization for that database. This guide
does not assert that any migration has been applied remotely.

## Release procedure

1. Authenticate with Vercel CLI and select the intended team and project. If the
   project does not exist, confirm its creation before making that remote change.
2. Keep Git auto-deployments disabled. Link the local folder explicitly using
   `vercel link --project <project-name> --scope <team-slug>`; inspect the linked
   project before deployment. `.vercel/` is ignored by Git.
3. Configure Preview environment values through Vercel's settings or interactive
   CLI prompts, and verify the database prerequisites. Keep deployment protection
   enabled for the initial demo; operator authentication is not implemented.
4. Run `npm run check` locally. Record failures without bypassing checks. Tests
   remain opt-in under the hackathon policy.
5. After authorization to publish, run `vercel deploy --scope <team-slug>` for a
   Preview. A CLI deployment does not require a Git push. Use `vercel curl` for
   protected Preview checks rather than disabling deployment protection.
6. Verify `/`, `/dashboard` and authorized `GET /api/state`. A successful build
   alone does not prove database access, filtering or model execution. Obtain
   authorization for a model-backed smoke report and any real communications.
7. Configure Production separately and publish with `--prod` only when authorized.

References: [CLI deployments](https://vercel.com/docs/cli/deploy),
[Git deployment settings](https://vercel.com/docs/project-configuration/git-configuration),
[function duration](https://vercel.com/docs/functions/configuring-functions/duration).
