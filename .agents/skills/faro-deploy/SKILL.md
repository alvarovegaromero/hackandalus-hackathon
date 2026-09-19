---
name: faro-deploy
description: Prepare and verify FARO releases from main into production, with automatic deployment through Vercel's native Git integration. Use when asked to deploy FARO, publish a release, or check its production deployment.
---

# Deploy FARO

The release path is **main -> PR -> production -> Vercel build and deployment**.
The branch is named `production`, without a leading slash. Development fixes land
in `main` through feature PRs. Merging a release PR into `production` is the
publication trigger; opening the PR alone does not deploy.

Read `PROJECT.md` and `docs/vercel-deployment.md` from this repository's root for
current permissions, bootstrap status, credentials and runtime limitations. Those
documents are authoritative; do not assume remote setup is complete from the
presence of this skill or a local branch.

## Target and prerequisites

- Repository: `alvarovegaromero/hackandalus-hackathon`.
- Vercel project: `faro`, team `alvaros-projects-329c5aac`.
- Existing site: `https://faro-lovat-iota.vercel.app`.
- Verify remote `production` exists and is protected, Vercel is connected to the
  repository, and Production branch tracking is `production`.
- `vercel.json` allows Git deployments only for `production`. GitHub Actions is
  not used; the CI/CD build and deployment run on Vercel. Configuration in Git
  does not itself establish the remote connection or branch tracking.
- Production credentials live in Vercel. Do not export them into the repository,
  PR description, logs or browser code. Database migrations are a separate action.

## Prepare the release

Preserve local work. Fetch current refs and review the `production...main` diff.
If there is no new release content, report that instead of creating an empty PR.
Use the repository's `npm run pr:create` entry point, which runs local validation.
Release mode must run from a clean feature checkout at the current remote `main`
revision; it verifies that revision and opens head `main`, base `production`:

```sh
git fetch origin
git switch -c release/descriptive-name origin/main
npm run pr:create -- --release --title "release: publish main" --body-file .data/release-pr.md
```

Choose an unused local branch name and write the reviewed body before invoking
the command. No push of this temporary branch is needed. Use a merge commit for
release PRs to preserve shared ancestry. The owner performs the merge; this
skill grants no additional push, merge, deployment or live-communication permission.
Follow explicit session authorization and project rules without asking again for
actions already authorized.

## Verify delivery

After the human merge, find the Vercel deployment for that exact production commit.
Confirm target Production, status READY and the existing domain's active deployment.
Check `/`, `/dashboard`, `/api/map` and authorized `/api/state`. A successful build
or a 200 HTML response does not prove model execution or database connectivity.
Report UI, backend and agent verification separately; never call a no-op/mock
communication a real action.

If no deployment appears, inspect Git connection, branch tracking and the committed
deployment filter. If the build fails, inspect its logs and fix through `main` and
a new release. Do not force-push `production`, bypass checks or silently deploy via
CLI. Manual deployment or rollback is a separately authorized fallback described
in the release guide. Stop at a missing account authorization, unavailable secret,
or required human merge and state the concrete remaining step.
