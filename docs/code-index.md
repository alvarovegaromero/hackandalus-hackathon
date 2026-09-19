# Code index with Graft

Use [Graft](https://github.com/trailhq/Graft) to locate functions, relationships
and files before reading code. Version `0.10.1` is pinned in devDependencies and
the lockfile; use the shared npm commands rather than a global installation.

## Setup

From the repository root, using the Git, Node.js and npm versions in PROJECT.md:

```sh
npm ci
npm run index:build
npm run index:map
```

Each checkout builds its own ignored `graft/` cache. Do not commit it or share it
between branches or machines. Structural indexing needs no model credentials.
No global installation or `graft init` is required. Agent entry points refer to
PROJECT.md; tools that do not load instructions must read it before starting.

Graft navigation is mandatory for contributors and agents. Query the map or a
relevant symbol before exploring or editing code. Report failures or missing
coverage before falling back to scoped searches and direct reads.

Pre-commit is intentionally disabled for the 24-hour hackathon. Pre-push and PR
validation run `npm run index:verify` through `npm run check`; this builds or
refreshes the index and checks freshness. Failures block those checks. These are
local controls, not proof that a contributor consulted the graph; confirm usage
and coverage limitations in the PR checklist.

Indexing is not part of `npm ci`, direct Next.js builds or deployment. Graft is
not installed with `npm ci --omit=dev`. If install scripts are disabled, run
`npm run prepare` to install project hooks as described in CONTRIBUTING.md.

## Queries

```sh
npm run index:map
npm run graft -- ask "event validation"
npm run graft -- skeleton src/lib/domain.ts
npm run graft -- callers simulatePlan
npm run graft -- callers simulatePlan --direction out
npm run graft -- grep "crisisEventSchema"
npm run index:check
npm run index:verify
```

Use `ask` for task-related code, `skeleton` for signatures, `callers` for
relationships and `grep` for text in indexed files. Read the source before editing.
Queries refresh the structural graph by default. Rebuild after changing branches
or when freshness checks fail. An unbuilt deep layer is expected: `--deep` adds
model processing and is not part of the configured workflow.

## Coverage and limitations

- Counts vary as the source changes; use the current index output.
- Hidden directories, dependencies and build output are excluded. Git file
  selection applies; tracked files may remain indexed despite ignore rules.
- SQL, CSS and Markdown are outside the verified structural coverage. Use scoped
  `rg` searches in `supabase/migrations`, `src` or `docs`.
- Some exported values lack symbol nodes. If `callers crisisEventSchema` cannot
  find a symbol, `grep crisisEventSchema` can still find textual references.
  Dynamic relationships are not exhaustive.
- `graft/` is excluded from Git, Prettier and generated secret scans. `.ignore`
  allows searching cards but excludes `.graph/` and `.cache/`. Scope source
  searches explicitly, for example `rg ... src scripts`.
- Graft does not configure MCP, editor hooks, services or global settings.

Build, rebuild, map, search, signatures, references and freshness were verified
on Windows. Commands avoid absolute paths and shell-specific syntax; macOS and
Linux are intended platforms, not verified by those checks.

Update the exact npm version and lockfile together when upgrading Graft, then
verify the relevant queries. Follow PROJECT.md's current hackathon validation
policy; automated tests are not part of `npm run check`.
