// Person B worker: consumes reserved missions; never reserves or releases inventory.
import { existsSync, readFileSync } from "node:fs";
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
const { runSubagentCycle } = await import("../src/lib/subagents/execute.ts");
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
do {
  try {
    const result = await runSubagentCycle();
    console.log(JSON.stringify(result));
    if (process.argv.includes("--once") && result.outcome === "SUBAGENT_FAILED")
      process.exitCode = 1;
  } catch {
    console.error(
      "Subagent execution unavailable; persisted missions remain available for recovery.",
    );
    if (process.argv.includes("--once")) process.exitCode = 1;
  }
  if (process.argv.includes("--once")) break;
  if (running) await delay(1000);
} while (running);
