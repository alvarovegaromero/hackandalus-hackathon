# Contributing to Butterfish

Read [PROJECT.md](PROJECT.md) for shared conventions and permissions,
[README.md](README.md) for setup and [TASKS.md](TASKS.md) for current work.

## Environment setup

Use Git, Node.js 24.x and npm. Corepack users can enable npm 11.6.1 through
`corepack enable`. Windows needs Git for Windows for the hook shell.

```sh
git clone https://github.com/alvarovegaromero/hackandalus-hackathon.git
cd hackandalus-hackathon
npm ci
npm run dev
```

Open http://localhost:3000. Geography and the simulation UI can load without
credentials; persisted coordinator state requires configured Supabase access.
`npm ci` installs local hooks. Use `npm run prepare` if installation skipped scripts.

## Feature contributions

Start from a clean checkout of the latest integration branch:

```sh
git fetch origin
git switch -c feat/short-description origin/main
npm run check
git add <reviewed-files>
git commit -m "feat: describe the change in English"
```

Use `feat/`, `fix/` or `chore/` branches. Preserve uncommitted work before switching.
After explicit permission to push the feature branch, create its PR into `main`:

```sh
npm run pr:create -- --title "chore: describe the change" --body-file .data/pr-body.md
```

Write the body first, following `.github/pull_request_template.md`. The helper
requires authenticated GitHub CLI, a clean working tree and a published feature
branch. It runs `npm run check` and never pushes. All contributors and agents
must use it; GitHub's UI or direct `gh pr create` bypasses the local gate.
Record checks and the tested OS. A passing Windows check does not prove Linux
or macOS validation. Failed checks must be fixed, not bypassed.

Pre-commit is intentionally disabled during the hackathon. Pre-push and PR
validation run checks, build and Graft verification, excluding tests. Do not add
or run automated tests by default; existing tests are available on explicit request.
Direct pushes to `main`, `master`, `develop` and `production` are blocked.

## Releases

`main` is the integration branch; `production` is the publishing branch. Release
PRs use head `main`, base `production`. The owner merges releases, and Vercel's
native Git integration builds and deploys only `production`. GitHub Actions is
disabled because the team has no Actions minutes. The Vercel delivery exception
supersedes the former blanket NO CI rule; local validation remains mandatory.

Use `npm run pr:create -- --release --title "release: publish main" --body-file .data/release-pr.md`
from a clean feature checkout at the current remote `main` commit. The helper
validates that exact source revision without changing either protected branch.
Follow [the release guide](docs/vercel-deployment.md) for initial branch
protection/Git connection setup and regular releases. Never commit fixes directly
to `production`; land them in `main` and release again.

Agents require explicit permission to push or publish. Local commits are allowed.
Follow PROJECT.md and the current user's merge instructions; no command grants
permission to bypass branch protection.

## Coding agents and navigation

Codex uses AGENTS.md, Claude uses CLAUDE.md, and the other editor instructions
reference PROJECT.md. Shared rules apply regardless of the selected model.
Coordinate edits to avoid overwriting another contributor's work. Keep personal
model preferences and tool credentials out of Git.

Graft is required for code navigation. Run `npm run index:build` once per checkout,
then `npm run index:map` or `npm run graft -- ask "event validation"`. Report
missing coverage or failures before using scoped searches. `graft/` is local,
ignored and needs no model key. Pre-push/PR checks run `index:verify`; pre-commit
does not. See [the navigation guide](docs/code-index.md).

Shared skills are versioned under `.agents/skills/`; no global installation or
copying is necessary. Follow [the skill guide](docs/agent-skills.md) and the paths
in PROJECT.md. Skills do not grant permission to deploy or send communications.

## Credentials and services

`npm run env:setup` creates `.env.local` from the empty template only if absent.
Fill values locally as needed. Commit only sanitized `.env.example` templates.
Share development credentials through a password manager or an expiring private
link, never repository issues, PRs, agent chats or screenshots. Keep Vercel values
separate for Production, Preview and Development. GitHub Actions Secrets are not
a team credential-sharing mechanism and are unused by this delivery flow.

Only public data belongs in `NEXT_PUBLIC_*`. Supabase server keys, model keys,
API tokens and HappyRobot credentials must remain server-only. Rotate exposed
credentials at their provider; deleting a copy does not revoke it.

Use `.env.example` for current variable names and [the deployment guide](docs/vercel-deployment.md)
for the hosting checklist. Setting keys does not prove migrations are installed,
authenticate an operator or enable real HappyRobot communications. Real calls
require the agreed integration and approved demo recipients. Repository access
and Vercel/Supabase/HappyRobot access are granted separately by their owners.
