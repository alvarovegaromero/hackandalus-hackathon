# CLAUDE.md

@AGENTS.md

The imported file is the single source of truth for shared project conventions.
Keep this file limited to Claude Code-specific notes.

## Claude Code specifics

- Project settings/permissions live in `.claude/settings.json`.
- Put personal overrides in `.claude/settings.local.json` and personal notes
  in `CLAUDE.local.md`; both are ignored by Git. Never put secrets in shared
  settings.
- Shared permissions allow reading and selected Git inspection commands, ask
  before direct pushes, and deny direct PR merge commands. They are a baseline,
  not an exhaustive enforcement of the workflow: follow `AGENTS.md` for all
  tools, wrappers, and external integrations too.
- No project-specific subagents or slash commands exist yet. Add them under
  `.claude/agents/` and `.claude/commands/` as the project grows, and mention
  them here so future sessions know they exist.
