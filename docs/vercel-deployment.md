# Vercel deployment and releases

Resource Dispatch requires migration 016 and [its configuration](resource-dispatch.md).
Stable callback: https://faro-lovat-iota.vercel.app/api/dispatch/results.
Deploy this revision before configuring the workflow. Callback processing uses the
existing 180-second Next.js lifetime and persists pending replanning.

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
`npm run build`. Git deployments are enabled only for `production`; `**: false`
covers all other branches, including names containing `/`. Vercel's matching rule
allows the explicit `production: true` to override that default.
Run `npm run check` locally before publishing. Deployment does not apply SQL
migrations. Vercel performs the production build; GitHub Actions is not used.

The owner authorized this release flow on 2026-09-19, replacing the blanket
NO CI rule. Repository configuration is prepared; the remote production branch,
its protection, Git connection and Vercel branch tracking still need setup.

## Current execution boundaries

- The coordinator runs in Next.js `after()` following intake, with a 180-second
  route duration. Configure Vercel Functions to support that duration. Supabase
  stores coordinator state and pending input; process-local scheduling is not
  durable. An interrupted attempt needs another intake request for recovery.
- Current `main` integrates parent mission creation, inline subagent execution
  and result-triggered replanning in Next.js. Three missions can run concurrently;
  the request lifetime remains bounded by Vercel. Durable restart recovery and
  external callbacks still need implementation. Do not run a second standalone
  worker just to duplicate inline execution. See [the subagent contract](subagent-execution.md).
- Communication operations acknowledge requests locally; they do not contact
  real services. Real model calls do not make those communications live.
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

Check the target database's migration history before use. The integrated runtime
requires the applicable migrations through 015 (patrols, evolving missions and
retaining resources after communication). The initial deployed UI predates these changes.
Apply missing migrations only with authorization for that database. This guide
does not assert that any migration has been applied remotely.

## One-time setup

1. Merge the reviewed delivery-configuration feature PR into `main`. The owner
   performs the merge. Bootstrap remote `production` from that exact reviewed
   commit, with explicit permission; this is branch creation, not a routine push.
   The local hook blocks direct pushes to `production`; do not bypass it.
2. Protect `production` on GitHub: require PRs, enforce for administrators, block
   force pushes and deletion. Keep `main` as the default integration branch.
3. Connect the existing Vercel `faro` project to
   `alvarovegaromero/hackandalus-hackathon`. Complete the GitHub login/app
   authorization if Vercel requests it. Do not create a second Vercel project.
4. In Vercel Settings > Environments > Production > Branch Tracking, set
   `production`. Confirm this setting before enabling the first release. The
   `git.deploymentEnabled` map controls whether a build starts, not its environment.
   Git connection/setup itself may create an initial deployment; check its target.
5. Confirm the Production variables and database prerequisites. Credentials stay
   in Vercel, not in GitHub Actions or the repository. No deploy hook or Vercel
   token needs to be committed.

## Regular release procedure

Development uses feature branch -> PR -> `main`. Publication uses
`main` -> release PR -> `production` -> automatic Vercel build/deployment.
Opening a release PR does not publish it. The human merge is the release decision.

From a clean checkout, fetch the latest refs and create a temporary local feature
branch at remote `main` so the local guard can validate it without permitting
direct commits to protected branches:

```sh
git fetch origin
git switch -c release/2026-09-19 origin/main
npm run pr:create -- --release --title "release: publish main" --body-file .data/release-pr.md
```

Use a unique local branch name and write the reviewed PR body first. The helper
runs local checks, verifies HEAD still equals current remote `main`, and creates
the PR with head `main` and base `production`. It does not push the temporary
branch or merge anything. If main advances, fetch/update and repeat validation.
Do not squash release PRs: use a merge commit to preserve shared branch ancestry.

After the human merges, confirm Vercel reports READY for the production commit
and the existing domain points to that deployment. Verify `/`, `/dashboard`,
`/api/map` and authorized `GET /api/state`. A successful build alone does not prove
database access or model execution. Obtain authorization for model-backed smoke
reports and real communications. Tests remain opt-in under the hackathon policy.

Manual CLI deployments remain an explicit, authorized fallback. They bypass the
branch-trigger filter, so do not run `vercel deploy --prod` as the normal release
path. For rollback, use a reviewed revert through `main` and another release PR,
or an explicitly authorized Vercel rollback. Never reset/force-push `production`.

References: [CLI deployments](https://vercel.com/docs/cli/deploy),
[Git deployment settings](https://vercel.com/docs/project-configuration/git-configuration),
[function duration](https://vercel.com/docs/functions/configuring-functions/duration).
