# CLAUDE.md

@AGENTS.md

The imported file is the single source of truth for shared project conventions.
Keep this file limited to Claude Code-specific notes.

## Claude Code specifics

- Write commit subjects and bodies in English, even when the user communicates
  in Spanish. Follow the shared commit convention in `AGENTS.md`.
- Repository: `alvarovegaromero/hackandalus-hackathon`; the local app is named
  `butterfish`. Read `AGENTS.md` for branch rules and the owner's explicit
  `main` target exception for the scaffolding PR (#2).
- Never commit or push directly to `main` (including `HEAD:main` or API writes).
  Changes to `main` must go through a PR; the user performs the merge. Previous
  setup push permission was one-off and is revoked. Never disable or bypass
  branch protection, and never merge PRs even when asked. See `AGENTS.md` for
  the shared policy and configured GitHub protection.
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
