# Shared development skills

The repository includes four upstream skill snapshots in `.agents/skills/`.
They help coding agents work on our React/Next.js frontend and Supabase/Postgres
database. They are development guidance, not application dependencies.

## Using the skills

Clone or pull the branch containing the skills. There is no additional install,
API key, global configuration or filesystem symlink to set up. Start a new agent
session after pulling if its skill catalog was already loaded.

[PROJECT.md](../PROJECT.md#shared-stack-skills) lists the task-to-skill mapping
and exact paths. All our agent entry points refer to PROJECT.md. Automatic
discovery depends on the tool and version; if a skill is not discovered, ask:

> Read PROJECT.md and .agents/skills/vercel-react-best-practices/SKILL.md, then
> apply the relevant guidance to this React task.

Substitute the appropriate skill path for database work, UI review or visual
design. Claude Code can read these same paths without a `.claude/skills` copy.
Cursor, Gemini, Antigravity and other agents can use this explicit-read workflow
even when their native skill discovery uses a different directory.

Only load skills relevant to the current task. Follow PROJECT.md for project
rules and permissions. UI design should support crisis visibility and operator
intervention; performance guidance should match the installed library versions.

## Included sources

| Local skill                        | Upstream source                                                                                                                            | Purpose                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `vercel-react-best-practices`      | [Vercel](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices)            | React/Next.js fetching, rendering and performance |
| `web-design-guidelines`            | [Vercel](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines)           | UI accessibility and interaction review           |
| `supabase-postgres-best-practices` | [Supabase](https://github.com/supabase/agent-skills/tree/8331f910845103c08d51f6ca1d86ebb7d1f745e3/skills/supabase-postgres-best-practices) | Schema, SQL, indexes and RLS                      |
| `frontend-design`                  | [Anthropic](https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design)                     | Visual direction and presentation                 |

[skills-sources.json](../skills-sources.json) records exact revisions, upstream
paths and SHA-256 file hashes. Supporting references are included alongside
each skill. Supabase's repository license and Anthropic's skill license are
included; Vercel's upstream license declarations remain in the snapshot and
source repository. These upstream terms apply to the vendored material and do
not select a license for the application.

The web-design skill fetches its checklist from Vercel's live guidelines URL
before each review. That review needs network access, and its checklist can
change independently of our pinned skill. Report when it cannot be fetched.
The snapshots do not add browser automation, database access or deployment tools.

AI SDK, Workflow, Zod and HappyRobot are not covered by these four skills. Use
official documentation matching the installed versions and our integration
contracts for those tasks. [Graft](code-index.md) is installed with development
dependencies and provides a local code index alongside these skills.

## Updating

1. Choose a specific upstream commit and review changes to the selected skill,
   its references, license and any executable files before adopting it.
2. Download that skill directory into a temporary location. Compare it with the
   corresponding `.agents/skills/` directory, then replace the reviewed snapshot.
   Keep the local directory names above and preserve all required references
   and licenses, including Supabase's repository-level `LICENSE`.
3. Update the revision, paths and file hashes in `skills-sources.json`, and the
   source links in this guide. Keep upstream contents intact; put local policy
   in PROJECT.md. Do not run an unreviewed bulk update of unrelated skills.
4. Check the diff, local links, source hashes, formatting and secret scan.
   Submit the snapshots and documentation together through the normal PR flow.

Prettier excludes only the upstream skill directory to preserve its contents.
Secret scanning still includes these files. No runtime install hook downloads or
updates skills. Plain files are intended to work on Windows, macOS and Linux;
file integrity and repository checks were verified on Windows. Discovery in
each editor and behavior on macOS/Linux have not been tested.
