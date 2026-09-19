# thoughts/

Design context for the people and agents working on FARO. There is no code
here: this is what was thought through, what was measured and what was
decided, so nobody has to rediscover it.

It is written against the platform base under `src/`: Next.js, Supabase with
RLS, Vercel Workflow, AI SDK and Zod. Much of the content comes from the
command center first built on `feat/crisis-command-center` with in-memory
state and now merged at the repository root (`app/`, `lib/`, `tests/`); these
documents transfer that work to the definitive base.

## What is here

| Document                               | What it is for                                                                                                                                      | Read it if…                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [data-model.md](data-model.md)         | Full data model on Supabase: 29 tables with DDL and per-field rationale, the Zod contract, flows, RLS, Realtime, scalability and the migration plan | You are going to touch the schema, a repository or a Zod schema |
| [features.md](features.md)             | What was built, module by module: functions, formulas, verification and what is still unwired                                                       | You are going to reimplement or port a module                   |
| [open-questions.md](open-questions.md) | What nobody has decided yet, ordered by the phase it blocks                                                                                         | You want to know what still needs agreement                     |

The project's source-of-truth document is at the repository root:
`HackSpain 2026 · Project Source of Truth.md`. These documents build on
it; if they disagree, the source of truth wins and this folder gets updated.

## How to use it if you are an agent

1. Read `AGENTS.md` and `CHALLENGE.md` first, as always.
2. Before touching the schema, read section 2 of `data-model.md`
   (principles) and your module's table. Each module writes only its own
   tables.
3. If your task is to port a module, `features.md` has its functions, its
   formulas and its reference figures, so you can check the port did not
   change behavior.
4. If something here looks wrong to you, change it, but write the new
   rationale in the same file.

## How to maintain it

- One document per topic. Do not duplicate what `README.md`, `AGENTS.md` or
  `TASKS.md` already say.
- When something here gets implemented, update its status in `features.md`
  and tick it off in `open-questions.md`. Do not delete: the rationale still
  holds.
- Figures only if they were measured. If it is an estimate, say so.
- Prose in English. Code and SQL identifiers in English. Product-facing copy
  (what the operator reads on screen) stays in Spanish, because the product is
  in Spanish; quote it as such.
