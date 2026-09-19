# Vercel deployment and releases

Resource Dispatch requires migration 016 and [its configuration](resource-dispatch.md).
Stable callback: https://faro-lovat-iota.vercel.app/api/dispatch/results.
Deploy this revision before configuring the workflow. Callback processing uses the
existing 180-second Next.js lifetime and persists pending replanning.

## Current deployment

Production was deployed from Git branch `production` on 2026-09-19 to project `faro` in team
`alvaros-projects-329c5aac`:

- [Landing](https://faro-lovat-iota.vercel.app/)
- [Dashboard](https://faro-lovat-iota.vercel.app/dashboard)
- Deployment ID: `dpl_7WMT5tqgnc9CbvnpWGVvzy8gEmt5` (Production, READY).
- Commit: `ce3afe11d4078edcdb67e6f2ee6514e78f688235`.
- Public access feature: [PR #63](https://github.com/alvarovegaromero/hackandalus-hackathon/pull/63).
- Release: [PR #64](https://github.com/alvarovegaromero/hackandalus-hackathon/pull/64),
  merged into `production` at `2026-09-19T19:02:44Z`. Its merge automatically
  triggered Vercel; GitHub's Vercel status and the deployment ID match this commit.

### Public access window

- Activation: `2026-09-19T19:02:13.807Z`.
- Automatic expiry: `2026-09-20T21:02:13.807Z`, **20 September at 23:02 CEST
  (Europe/Madrid)**.
- No login, popup, code or cookie. All visitors share this fixed 26-hour window.
- The landing remains public after expiry; the dashboard shows a closed page and
  public state/mission/telemetry access and demo controls stop. Protected integrations
  retain their existing credentials. Already accepted background work can finish.
- Do not refresh the activation timestamp during ordinary releases: redeployment
  with the same value does not extend access.

### Verified behavior and remaining checks

Unauthenticated remote checks after this release returned 200 for `/`, `/dashboard`,
`/api/map`, `/api/state`, `/api/subagents` and `/api/telemetry`. The dashboard rendered
demo controls without a dialog; the telemetry response opened an SSE stream.
The dashboard was also opened in an active Orca tab without a load error.

State reported `storage: supabase`, revision 66 and 20 events; subagents returned
seven stored completed missions. These are observations at verification time,
not fixed fixture counts. Supabase read connectivity is verified. No reset, new
model execution or real communication was triggered by these checks. Existing
mission results do not prove a new remote agent run; a new report-to-plan-to-mission
exercise on Vercel remains pending. Agents execute after intake or mission results,
not as continuously running processes.

Production contains Supabase URL/public key, provider/model, Jev model/timeout,
mock action mode and the public activation timestamp as Config; Supabase, OpenCode,
TypeSafe private keys and the pipeline API token remain Secret. Secret values are
not recorded here. This supersedes the initial missing-token 503 and protected-read
401 deployment checks.
GitHub login and the Vercel GitHub App installation are connected; the installation
is limited to `alvarovegaromero/hackandalus-hackathon`.
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
NO CI rule. Configuration and the `faro-deploy` skill landed through PR #61,
merged as `a8f697d1cc7679adcb9d9fd6e1ed014003c03930`. Remote `production` was
created at that commit and protected with required PRs, administrator enforcement,
and force-push/deletion disabled. Vercel is connected to the repository and
Production branch tracking is saved as `production`. Automatic delivery was
verified by release PR #64: its deployment is READY and serves the existing domain.

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
- Hosted dashboard access is public for one fixed twenty-six-hour window, with
  no login, code, popup or cookie. At activation, set `DEMO_PUBLIC_STARTED_AT` to
  the current UTC timestamp produced by `new Date().toISOString()` and keep
  `ACTION_EXECUTION_MODE=mock`. Every server instance computes the same expiry
  as activation plus 26 hours; reloads, new visitors and redeployments do not extend it.
  State, mission and telemetry reads are public within that window. Reset and
  fixture-event controls additionally require a same-origin request.
  General intake, legacy action APIs and webhooks retain their existing credentials.
  No server token or provider key is sent to the browser. Missing, invalid, future
  or expired activation timestamps keep access closed; live action mode also
  disables public demo access. Expiry is checked on each request and SSE poll/send;
  the dashboard reloads to a closed page at expiry. No redeployment is needed to
  close access. Already accepted background work can finish. All visitors share one demo run;
  Reset & run events resets that shared simulation and invokes the configured models.
- Legacy command-center and telemetry state still uses process memory. Do not
  enable `CRISIS_PERSISTENCE` on Vercel: local JSON files are not shared durable
  storage. See [coordinator state](coordinator-state-contract.md) for the durable
  read model and [event telemetry](event-telemetry.md) for legacy limitations.

## Environment and database prerequisites

The public-window implementation is deployed through PRs #63 and #64, with
`DEMO_PUBLIC_STARTED_AT` set to the activation timestamp above. Preserve that
timestamp for this demo. The previously configured `DEMO_ACCESS_CODE` and the
code-entry implementation have been removed.

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
| Public demo window                    | `DEMO_PUBLIC_STARTED_AT` (canonical UTC ISO timestamp); requires mock action mode |
| Inbound HappyRobot reports/callbacks  | `HAPPYROBOT_WEBHOOK_SECRET`                                                       |
| Initial simulated actions             | `ACTION_EXECUTION_MODE=mock`                                                      |

Select one model provider explicitly. The application currently requires an API
key even when using AI Gateway on Vercel. The public site URL is optional; metadata
can use Vercel's production origin. See `.env.example` for the complete inventory.
Direct database connection strings are migration tooling credentials, not required
by the deployed Supabase HTTP client.

Check the target database's migration history before use. The integrated runtime
requires the applicable migrations through 015 (patrols, evolving missions and
retaining resources after communication). Production state and mission reads work,
but this release verification did not audit the full migration history or apply SQL.
Apply missing migrations only with authorization for that database; successful reads
alone do not establish every write/recovery path.

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
