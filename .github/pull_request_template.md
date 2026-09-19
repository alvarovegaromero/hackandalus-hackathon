## What changes

<!-- Explain the problem and resulting behavior. Keep the scope concrete. -->

## Verification

<!-- List checks actually run and their results. Note failures or skipped checks. -->

## Configuration and migrations

<!-- New environment variable names, migration files, or deployment steps. Never include secret values. Write "None" if not applicable. -->

## Checklist

- [ ] Targets `main` from a feature branch, or promotes `main` to `production` as a release PR.
- [ ] Follows `PROJECT.md`; commit messages are in English.
- [ ] Read `docs/poc.md`, `docs/poc-contracts.md` and `TASKS.md`; identified the
      affected P0–P5 package or explained why this change is outside the POC.
- [ ] Boundary changes update canonical contracts and shared fixtures, preserve
      input/SSE compatibility or document migration, and update task status.
- [ ] Created with `npm run pr:create`; its local `pr:check` validation passed (no GitHub Actions CI).
- [ ] Check results and tested OS are documented above.
- [ ] Used Graft for code navigation and passed `npm run index:verify`; documented any unavailable or unindexed results.
- [ ] No credentials or private interaction data included.
- [ ] Relevant docs and `.env.example` updated if needed.
- [ ] Simulated behavior is clearly identified; live results are not assumed.

<!-- Agents may merge when explicitly instructed by the user, respecting checks and branch protection. -->
