import { execFileSync, spawnSync } from "node:child_process";

// npm run pr:create runs pr:check first and stops if any local check fails.
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (!branch || ["main", "master", "develop"].includes(branch)) {
  console.error("PR blocked: use a feature branch.");
  process.exit(1);
}
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
  console.error(
    "PR blocked: commit your reviewed changes and push the branch before creating a PR.",
  );
  process.exit(1);
}

// Explicit --head prevents gh from offering to push unpublished commits.
const result = spawnSync(
  "gh",
  ["pr", "create", "--base", "main", "--head", branch, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(`Could not start GitHub CLI: ${result.error.message}`);
}
process.exit(result.status ?? 1);
