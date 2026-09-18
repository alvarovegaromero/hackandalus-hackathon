import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
// Git hooks export repository variables; never let fixture commands touch the
// real repository/index when these tests execute during a commit.
const fixtureEnv = { ...process.env };
for (const name of Object.keys(fixtureEnv)) {
  if (name.startsWith("GIT_")) delete fixtureEnv[name];
}
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "butterfish-hook-test-"));
execFileSync("git", ["init", "--quiet", fixtureRoot], { env: fixtureEnv });
const emptyBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
  cwd: fixtureRoot,
  env: fixtureEnv,
  input: "",
  encoding: "utf8",
}).trim();

afterAll(() => {
  // Only remove the unique temporary directory created by this test.
  if (path.dirname(fixtureRoot) !== path.resolve(tmpdir())) throw new Error("Invalid fixture path");
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function stagedFileCheck(filename: string) {
  execFileSync("git", ["read-tree", "--empty"], { cwd: fixtureRoot, env: fixtureEnv });
  execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${emptyBlob},${filename}`], {
    cwd: fixtureRoot,
    env: fixtureEnv,
  });
  return spawnSync(process.execPath, [path.join(projectRoot, "scripts/guard-staged-files.mjs")], {
    cwd: fixtureRoot,
    env: fixtureEnv,
    encoding: "utf8",
  });
}

describe("credential guards", () => {
  it("blocks private environment and key files even when empty or nested", () => {
    for (const name of [".env", "config/.env.local", "id_ed25519", "config/client.key"]) {
      expect(stagedFileCheck(name).status).toBe(1);
    }
  });

  it("allows sanitized template filenames to proceed to content scanning", () => {
    expect(stagedFileCheck(".env.example").status).toBe(0);
    expect(stagedFileCheck(".env.production.example").status).toBe(0);
  });

  it("rejects a synthetic token and masks its value", () => {
    const syntheticToken = ["ghp", "A".repeat(36)].join("_");
    const result = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/secretlint/bin/secretlint.js"),
        "--stdinFileName=fixture.txt",
      ],
      { cwd: projectRoot, input: `token=${syntheticToken}`, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(syntheticToken);
  }, 20000);

  it("allows empty credential placeholders", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, "node_modules/secretlint/bin/secretlint.js"),
        "--stdinFileName=.env.example",
      ],
      { cwd: projectRoot, input: "AI_GATEWAY_API_KEY=\nSUPABASE_SECRET_KEY=\n", encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  }, 20000);
});
