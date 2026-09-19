// Dedicated process: durable input/state in Supabase, independent of viewers.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
if (existsSync(".env.local"))
  for (const [key, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8"))))
    process.env[key] ??= value;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
      };
    return next(url, context);
  },
});
const { runCoordinatorCycle, proposeCoordinatorState } =
  await import("../src/lib/coordinator/runtime.ts");
if (process.argv.includes("--try")) {
  const { coordinatorStateSchema } = await import("../src/lib/contracts/coordinator.ts");
  const initial = JSON.parse(readFileSync("docs/coordinator-state.example.json", "utf8"));
  const nextId = "10000000-0000-4000-8000-000000000004";
  const additional = {
    eventId: nextId,
    summary: "Flood traps 120 nursing-home residents; immediate evacuation needed.",
    status: "active",
    priority: null,
    rationale: null,
  };
  const newEvent = {
    ...structuredClone(initial),
    revision: 2,
    events: [...initial.events, additional],
  };
  const exhausted = structuredClone(newEvent);
  exhausted.ambulances = {
    total: 10,
    available: 0,
    allocated: 10,
    units: initial.ambulances.units.map((unit) => ({
      ...unit,
      status: "assigned",
      eventId: initial.events[0].eventId,
    })),
  };
  const results = [];
  for (const [name, input, trigger] of [
    ["existing commitment", initial, "timer.tick"],
    ["new critical event", newEvent, "event.received"],
    ["no free ambulances", exhausted, "event.received"],
  ]) {
    const state = coordinatorStateSchema.parse(input);
    try {
      const proposal = await proposeCoordinatorState(
        state,
        [{ note: "Synthetic scenario; facts not independently verified. P3 factors unknown." }],
        trigger,
      );
      results.push({ name, state, proposal, verdict: "PASS" });
      console.log(
        JSON.stringify({
          name,
          verdict: "PASS",
          assigned: proposal.assignments.length,
          priorities: proposal.priorities,
          plan: proposal.plan,
        }),
      );
    } catch {
      results.push({ name, state, verdict: "ERROR" });
      console.error(`${name}: ERROR`);
    }
  }
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/coordinator-smoke-results.json", JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.verdict === "PASS") ? 0 : 1);
}
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
console.log(
  "Coordinator: input checked every second, active situation every five seconds. No release or real dispatch.",
);
do {
  try {
    const result = await runCoordinatorCycle();
    console.log(JSON.stringify({ outcome: result.outcome }));
    if (process.argv.includes("--once") && result.outcome === "COORDINATOR_UNAVAILABLE")
      process.exitCode = 1;
  } catch {
    console.error("Coordinator unavailable; retrying without changing assignments.");
    if (process.argv.includes("--once")) process.exitCode = 1;
  }
  if (process.argv.includes("--once")) break;
  if (running) await delay(1000);
} while (running);
