import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const protectedBranches = new Set(["main", "master", "develop"]);
const mode = process.argv[2];

if (mode === "commit") {
  const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  if (!branch || protectedBranches.has(branch)) {
    console.error("Commit blocked: use a feature branch, not a protected branch or detached HEAD.");
    process.exit(1);
  }
} else if (mode === "push") {
  // Git sends: local-ref local-sha remote-ref remote-sha. Check the destination,
  // so HEAD:main, branch deletion and differently named local branches are covered.
  for (const line of readFileSync(0, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const remoteRef = line.trim().split(/\s+/)[2];
    if (!remoteRef) throw new Error("Invalid pre-push ref data.");
    if ([...protectedBranches].some((branch) => remoteRef === `refs/heads/${branch}`)) {
      console.error(`Push blocked: ${remoteRef} may only change through a pull request.`);
      process.exit(1);
    }
  }
} else {
  throw new Error("Expected hook mode: commit or push.");
}
