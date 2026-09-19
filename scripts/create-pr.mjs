import { execFileSync, spawnSync } from "node:child_process";

// npm run pr:create runs pr:check first and stops if any local check fails.
const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (!branch || ["main", "master", "develop", "production"].includes(branch)) {
  console.error("PR blocked: use a feature branch.");
  process.exit(1);
}
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
  console.error(
    "PR blocked: commit your reviewed changes and push the branch before creating a PR.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const release = args.includes("--release");
const forwarded = args.filter((arg) => arg !== "--release");
if (forwarded.some((arg) => /^(--base|--head|--repo)(=|$)|^-[BHR]/.test(arg))) {
  console.error("PR blocked: branch and repository selection are controlled by this script.");
  process.exit(1);
}
if (release) {
  // Run the local gate from a clean feature checkout of the exact remote main.
  // Creating a PR must not change or push either protected branch.
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const remoteMain = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/)[0];
  if (!remoteMain || head !== remoteMain) {
    console.error(
      "Release PR blocked: validate a clean feature checkout at the current origin/main.",
    );
    process.exit(1);
  }
}

// Explicit --head prevents gh from offering to push unpublished commits.
const result = spawnSync(
  "gh",
  [
    "pr",
    "create",
    "--repo",
    "alvarovegaromero/hackandalus-hackathon",
    "--base",
    release ? "production" : "main",
    "--head",
    release ? "main" : branch,
    ...forwarded,
  ],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(`Could not start GitHub CLI: ${result.error.message}`);
}
process.exit(result.status ?? 1);
