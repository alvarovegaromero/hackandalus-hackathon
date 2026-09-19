# Context7 for this repository

Context7 supplies library documentation to coding agents. Shared configurations
use the remote HTTPS endpoint, so no npm dependency or local MCP process is
needed. Application runtime, credentials and deployment are unaffected.

## Activate your client

Open the repository root and restart your agent session after pulling:

| Client      | Shared configuration    | Verification                                                                       |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Codex       | `.codex/config.toml`    | Trust the project, then run `codex mcp get context7`; use `/mcp` in a new session. |
| Claude Code | `.mcp.json`             | Accept the project server when prompted, then use `/mcp`.                          |
| Cursor      | `.cursor/mcp.json`      | Check Context7 in Settings > Tools & MCP.                                          |
| Gemini CLI  | `.gemini/settings.json` | Trust the folder, then use `/mcp`.                                                 |
| VS Code     | `.vscode/mcp.json`      | Run MCP: List Servers and start Context7.                                          |

Client trust or organization policy can prevent activation. Listing a configured
server alone does not prove documentation retrieval works. Antigravity and other
clients can register `https://mcp.context7.com/mcp` in their own MCP settings;
no shared configuration for those clients is installed here.

The default connection has no API key. Anonymous requests have limited quotas.
If authentication or a higher quota is needed, obtain a personal key from the
[Context7 dashboard](https://context7.com/dashboard) and configure it privately
using the [client instructions](https://context7.com/docs/resources/all-clients).
Never put keys in these tracked files or in the application's public environment.
For Codex, a private `~/.codex/config.toml` setting can reference a process
environment variable without storing the value:

```toml
[mcp_servers.context7]
bearer_token_env_var = "CONTEXT7_API_KEY"
```

Set that variable before launching Codex. The Next.js `.env.local` file is not
automatically loaded by MCP clients. Keep personal authentication in the client's
private configuration or credential store, not in Git.

## Stack lookup guide

Use the exact installed version from `package-lock.json`. These major versions
describe the current stack, not a promise that Context7 indexes every release.
Resolve each library by name and inspect the source and available versions before
using its returned ID; IDs are not hardcoded or invented for missing libraries.

| Technology    | Search name             | Scope / version guard                                                                                       |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Next.js       | Next.js                 | App Router, route handlers, Next.js 16                                                                      |
| React         | React                   | Components and hooks, React 19                                                                              |
| TypeScript    | TypeScript              | Type checking and configuration, TypeScript 6                                                               |
| AI SDK        | Vercel AI SDK           | `ai` 7; tools, agents, structured output                                                                    |
| Workflow      | Vercel Workflow DevKit  | `workflow` 4; durable steps and hooks; avoid v5-only APIs                                                   |
| Supabase      | Supabase JavaScript     | `@supabase/supabase-js` 2; clients, auth, Realtime                                                          |
| PostgreSQL    | PostgreSQL / Supabase   | Match the actual database server version; follow the database skill                                         |
| Zod           | Zod                     | Validation and schemas, Zod 4                                                                               |
| Tailwind CSS  | Tailwind CSS            | CSS-first configuration, Tailwind 4                                                                         |
| Maps          | Leaflet / React Leaflet | Leaflet 1.9 and React Leaflet 5                                                                             |
| UI primitives | shadcn/ui               | Reference only; current primitives are local, not an installed shadcn package                               |
| Tests         | Vitest                  | Match installed Vitest 5 APIs                                                                               |
| TypeSafe/Jev  | TypeSafe                | Optional integration; not an installed SDK or selected production model                                     |
| HappyRobot    | HappyRobot              | Official docs are access-gated; the adapter follows the public SDK contract in `docs/happyDocumentation.md` |

If a library or installed version is missing, use its bundled documentation or
official website and state the coverage gap. The TypeSafe skill provides its
official documentation workflow. Context7 results do not establish a verified
HappyRobot contract or authorize live communications.

Example: resolve `Vercel Workflow DevKit` with the question "How do durable steps
and retries work in workflow 4?", then pass the returned matching `libraryId`
to `query-docs` with the installed version and a focused API question. Do not
send private application data. Follow the shared rules in
[PROJECT.md](../PROJECT.md#library-documentation-with-context7).

## Verification and sources

Verify a fresh session exposes `resolve-library-id` and `query-docs`, then resolve
Next.js and request an App Router example. Report authentication, quota or version
coverage errors instead of claiming the lookup succeeded.

Configuration follows the official [Context7 client guide](https://context7.com/docs/resources/all-clients)
and [Codex MCP documentation](https://developers.openai.com/codex/mcp).
The files use portable HTTPS configuration. Verification on Windows does not
establish client discovery on macOS/Linux or in every editor.

Verified on Windows on 2026-09-19: Codex 0.155.0 loaded the project server;
anonymous HTTP initialization, tool listing, Next.js resolution and a documentation
query succeeded. The resolver did not list the installed Next.js 16.3.5 release,
and the generic library query returned canary documentation, so retrieval success
does not prove exact version coverage. Other editor sessions were not exercised.
