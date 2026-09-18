@PROJECT.md

The imported file is the single source of truth for shared project conventions.
Keep shared instructions in `PROJECT.md` rather than duplicating them here.

## Gemini CLI notes

- Start Gemini CLI from the repository root so it discovers this context file.
- Use `/memory reload` after changing instructions and `/memory show` to check
  that the shared project instructions are loaded.
- `.claude/settings.json` applies only to Claude Code. Follow the approval and
  Git workflow in `PROJECT.md`; this import does not configure tool permissions.
