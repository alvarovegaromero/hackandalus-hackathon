# AGENTS.md

**NO CI. This project will not use continuous integration.** We have no GitHub
Actions minutes. No agent or contributor may create, restore or enable CI
workflows, configure an alternative CI service, or require remote CI checks.
This is a project decision, not deferred work. Validate locally with
`npm run check` and create PRs through `npm run pr:create`, which runs the local
validation first and blocks creation on failure. See [PROJECT.md](PROJECT.md).

Read and follow [PROJECT.md](PROJECT.md) before working in this repository.
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

The repository holds two trees: the served command center at the root (`app/`,
`lib/`, `tests/`) and the platform base under `src/` (Workflow, Supabase, batch
ingestion), whose routes are not served while the root `app/` exists. Keep the
module-owner line (`// OWNER: …`) in `lib/**`, following PROJECT.md's English-language
rule for its label, and keep the digital-twin
docs and tests in sync. Unifying both trees is tracked in TASKS.md.

The served dashboard is a **SKETCH**, not an approved product design. Preserve
the visible prototype notice and do not infer the target architecture from its
partially connected controls. See PROJECT.md and docs/README.md.
