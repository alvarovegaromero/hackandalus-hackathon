# CLAUDE.md

@PROJECT.md

**NO CI. This project will not use continuous integration.** We have no GitHub
Actions minutes. No agent or contributor may create, restore or enable CI
workflows, configure an alternative CI service, or require remote CI checks.
This is a project decision, not deferred work. Validate locally with
`npm run check` and create PRs through `npm run pr:create`, which runs the local
validation first and blocks creation on failure. See [PROJECT.md](PROJECT.md).

[PROJECT.md](PROJECT.md) is the single source of truth for project information
and shared rules, including English commits, naming, hooks, secret detection
and protected branches. Keep this file limited to Claude Code-specific notes.
The team also uses Codex, Cursor and other models; use the same PROJECT.md rules
when handing work between tools.
Development spans Linux, macOS and Windows: follow PROJECT.md's portability
rules, use the active shell's syntax, and state which OS was actually tested.

## Claude Code specifics

- Graft is required before exploring or changing code. Use the project-local
  commands and fallback rules in [PROJECT.md](PROJECT.md#code-index-with-graft).

- Read the relevant `.agents/skills/` skill using the explicit paths in
  [PROJECT.md](PROJECT.md#shared-stack-skills); shared snapshots live there.

- Project settings/permissions live in `.claude/settings.json`; they supplement
  PROJECT.md and do not override its push/merge restrictions.
- Put personal overrides in `.claude/settings.local.json` and notes in
  `CLAUDE.local.md`; both are ignored by Git. Never commit credentials.
- No project-specific subagents or slash commands exist yet. Add them under
  `.claude/agents/` and `.claude/commands/` if needed and document their purpose.
