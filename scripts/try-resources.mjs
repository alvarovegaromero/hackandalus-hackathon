// On-demand P4 scarcity scenarios. Synthetic inventories; no live dispatch or DB allocations.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const flags = process.argv.slice(2);
if (flags.some((flag) => !["--dry-run", "--db"].includes(flag))) {
  console.error("Usage: npm run resources:try -- [--dry-run] [--db]");
  process.exit(2);
}
if (flags.includes("--db")) {
  if (flags.includes("--dry-run")) {
    console.log(
      "DB mode: eight allocation/retry/shortage/release/reassignment cases inside ROLLBACK. No LLM calls.",
    );
    process.exit(0);
  }
  const run = spawnSync(process.execPath, ["scripts/apply-resource-migration.mjs", "--smoke"], {
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}
let failed = false;
for (const [available, assumption] of [
  [10, "All ambulances available"],
  [2, "Eight already committed to another incident"],
  [0, "All committed; no automatic preemption"],
]) {
  console.log(`\nScenario: ${assumption}; ${available}/10 available.`);
  const run = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "scripts/try-llm.mjs",
      "--limit",
      "1",
      "--available",
      String(available),
      ...(flags.includes("--dry-run") ? ["--dry-run"] : []),
    ],
    { stdio: "inherit" },
  );
  failed ||= run.status !== 0;
  if (
    run.status === 0 &&
    !flags.includes("--dry-run") &&
    existsSync(".data/llm-smoke-results.json")
  )
    copyFileSync(".data/llm-smoke-results.json", `.data/resources-${available}-available.json`);
}
process.exit(failed ? 1 : 0);
