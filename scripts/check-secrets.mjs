import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
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

// Scan tracked files only, including force-added ignored files. Feed content on
// stdin so paths with glob characters (Next.js route params) remain literal.
// Secretlint masks detected values by default.
function scanFile(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "--stdinFileName", file], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0) resolve();
      else reject(new Error(`Secretlint failed for ${file} (exit ${status ?? "unknown"}).`));
    });
    child.stdin.end(readFileSync(file));
  });
}

const workers = Math.min(8, files.length);
let nextFile = 0;
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (nextFile < files.length) {
      const file = files[nextFile++];
      await scanFile(file);
    }
  }),
);
