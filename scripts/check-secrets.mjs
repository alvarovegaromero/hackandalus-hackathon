import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve("secretlint/package.json")), "bin/secretlint.js");
const files = execFileSync("git", ["ls-files", "--cached", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && existsSync(file));

// Scan tracked files only, including force-added ignored files. Feed content on
// stdin so paths with glob characters (Next.js route params) remain literal.
// Secretlint masks detected values by default.
for (const file of files) {
  const result = spawnSync(process.execPath, [cli, "--stdinFileName", file], {
    input: readFileSync(file),
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
