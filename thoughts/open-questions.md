# Confirmed product decisions

- **Product:** FARO, a command center for the 112 Andalucía control room.
- **Scenario:** a changing wildfire around Sierra Bermeja.
- **Stack:** Next.js, TypeScript, Zod, Vercel AI SDK, Supabase, Jev and HappyRobot.
  The active runtime uses Next.js background processing.
- **Decision boundary:** the model proposes; application and database validation
  enforce resource and state constraints.
- **Evidence:** relevance is separate from truthfulness and impact. Unknowns
  remain explicit; receiving a report or starting a call does not prove success.
- **Learning:** reviewed lessons are reused in matching local drills. Connecting
  them to the live coordinator is outside the current implementation.
- **License:** MIT.

Current limitations and follow-up work live in [TASKS.md](../TASKS.md).
The [product vision](<../HackSpain 2026 · Project Source of Truth.md>) contains
longer-term ideas; it does not add implementation requirements to the prototype.
