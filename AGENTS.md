# AGENTS.md

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
