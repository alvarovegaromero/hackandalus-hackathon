# CLAUDE.md

@PROJECT.md

[PROJECT.md](PROJECT.md) is the single source of truth for project information
and shared rules, including English commits, naming, hooks, secret detection
and protected branches. Keep this file limited to Claude Code-specific notes.
The team also uses Codex, Cursor and other models; use the same PROJECT.md rules
when handing work between tools.
Development spans Linux, macOS and Windows: follow PROJECT.md's portability
rules, use the active shell's syntax, and state which OS was actually tested.

## Claude Code specifics

- Read the relevant `.agents/skills/` skill using the explicit paths in
  [PROJECT.md](PROJECT.md#shared-stack-skills); shared snapshots live there.

- Project settings/permissions live in `.claude/settings.json`; they supplement
  PROJECT.md and do not override its push/merge restrictions.
- Put personal overrides in `.claude/settings.local.json` and notes in
  `CLAUDE.local.md`; both are ignored by Git. Never commit credentials.
- No project-specific subagents or slash commands exist yet. Add them under
  `.claude/agents/` and `.claude/commands/` if needed and document their purpose.
