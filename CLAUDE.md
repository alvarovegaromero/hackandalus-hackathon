# CLAUDE.md

@PROJECT.md

[PROJECT.md](PROJECT.md) is the single source of truth for project information
and shared rules, including English commits, naming, hooks, secret detection
and protected branches. Keep this file limited to Claude Code-specific notes.

## Claude Code specifics

- Project settings/permissions live in `.claude/settings.json`; they supplement
  PROJECT.md and do not override its push/merge restrictions.
- Put personal overrides in `.claude/settings.local.json` and notes in
  `CLAUDE.local.md`; both are ignored by Git. Never commit credentials.
- No project-specific subagents or slash commands exist yet. Add them under
  `.claude/agents/` and `.claude/commands/` if needed and document their purpose.
