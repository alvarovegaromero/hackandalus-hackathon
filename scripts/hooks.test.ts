import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("local PR gate", () => {
  it("blocks PR creation from protected branches", () => {
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], {
      cwd: fixtureRoot,
      env: fixtureEnv,
    });
    const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts/create-pr.mjs")], {
      cwd: fixtureRoot,
      env: fixtureEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("use a feature branch");
  });

  it("blocks PR creation with uncommitted changes", () => {
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/feat/pr-gate"], {
      cwd: fixtureRoot,
      env: fixtureEnv,
    });
    writeFileSync(path.join(fixtureRoot, "uncommitted.txt"), "local change\n");
    const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts/create-pr.mjs")], {
      cwd: fixtureRoot,
      env: fixtureEnv,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("commit your reviewed changes");
  });

  it("blocks PR creation on failed validation even with npm lifecycle hooks disabled", () => {
    execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/feat/pr-gate"], {
      cwd: fixtureRoot,
      env: fixtureEnv,
    });
    const { scripts } = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
    copyFileSync(
      path.join(projectRoot, "scripts/guard-protected-branches.mjs"),
      path.join(fixtureRoot, "scripts/guard-protected-branches.mjs"),
    );
    writeFileSync(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        private: true,
        scripts: {
          "pr:check": scripts["pr:check"],
          check: 'node -e "process.exit(23)"',
          "pr:create": scripts["pr:create"],
        },
      }),
    );
    writeFileSync(
      path.join(fixtureRoot, "scripts/create-pr.mjs"),
      'console.log("PR_CREATION_REACHED");',
    );
    const npmCli = process.env.npm_execpath;
    expect(npmCli, "Run this suite via npm test").toBeTruthy();
    const result = spawnSync(process.execPath, [npmCli!, "run", "pr:create"], {
      cwd: fixtureRoot,
      env: { ...fixtureEnv, npm_config_ignore_scripts: "true" },
      encoding: "utf8",
    });
    expect(result.status).toBe(23);
    expect(result.stdout + result.stderr).not.toContain("PR_CREATION_REACHED");
  });
});

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
