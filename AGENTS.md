# AGENTS.md

**Production delivery uses Vercel's native Git integration.** Feature PRs target
`main`; release PRs go from `main` to `production`. Only `production` triggers
automatic deployment. GitHub Actions remains disabled (no Actions minutes).
Validate locally with `npm run check` and create PRs through `npm run pr:create`.
See [PROJECT.md](PROJECT.md) and [the release guide](docs/vercel-deployment.md).

Read and follow [PROJECT.md](PROJECT.md) before working in this repository.
For POC work, also read [the active scope](docs/poc.md),
[module contracts v1](docs/poc-contracts.md) and [TASKS.md](TASKS.md) before
planning or editing. Follow PROJECT.md's mandatory reading and contract-change
rules; broader architecture drafts do not supersede these POC references.
It is the single source of truth for project context, stack, commands, naming,
English commit messages, Git permissions, branch protection and secret checks.
These shared instructions apply to Codex, Claude Code, Cursor, Gemini,
Antigravity and every other coding agent, regardless of the selected model.
The team develops on Linux, macOS and Windows. Follow PROJECT.md's portability
rules and distinguish tested platforms from intended support.

Read [CHALLENGE.md](CHALLENGE.md) before designing features and check
[TASKS.md](TASKS.md) for completed and deferred work. Read nested agent files
before editing their directories. Update shared rules in PROJECT.md rather
than duplicating them here.

Keep documentation updated as you work. When a change alters setup,
architecture, data contracts, workflows, API behavior, operational limits or
project decisions, update the relevant shared docs in the same change
(`README.md`, `TASKS.md`, `docs/`, `thoughts/`, `PROJECT.md` or this file).
Do not leave stale instructions for the next agent to rediscover.

For stack-specific work, use the shared skill paths listed in
[PROJECT.md](PROJECT.md#shared-stack-skills).
Graft is required for code navigation: follow
[the Graft workflow](PROJECT.md#code-index-with-graft) before exploring or
changing code, and report any fallback caused by failures or missing coverage.

The repository uses the standard Next.js `src/` directory layout: the served
command center lives in `src/app/`, `src/components/`, `src/lib/`, .
The landing at `/` and dashboard at `/dashboard` use separate root layouts;
see PROJECT.md and docs/landing-integration.md before changing their routing or CSS.
Keep the module-owner line (`// OWNER: …`) in `src/lib/**`, following PROJECT.md's
English-language rule for its label, and keep the digital-twin docs and tests in sync.

The served dashboard is the functional hackathon prototype used for the demo.
Preserve its working behavior. See docs/architecture.md for the current runtime
and docs/README.md for implementation references.
