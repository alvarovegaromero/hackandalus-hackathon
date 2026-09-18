import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cli = path.join(
  path.dirname(require.resolve("secretlint/package.json")),
  "bin/secretlint.js",
);
const files = execFileSync("git", ["ls-files", "--cached", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && existsSync(file));

// Keep command lines below Windows limits and scan tracked files only, including
// force-added ignored files. Secretlint masks detected values by default.
for (let offset = 0; offset < files.length; offset += 20) {
  const result = spawnSync(
    process.execPath,
    [cli, "--no-glob", "--no-gitignore", ...files.slice(offset, offset + 20)],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
