import { execFileSync } from "node:child_process";
import path from "node:path";

const files = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const blocked = files.filter((file) => {
  const name = path.posix.basename(file);
  const isEnv = name === ".env" || name.startsWith(".env.");
  const isTemplate = name.endsWith(".example");
  return (
    (isEnv && !isTemplate) ||
    /^(id_rsa|id_ed25519|id_ecdsa)$/.test(name) ||
    /\.(p12|pfx|key)$/i.test(name)
  );
});

if (blocked.length) {
  console.error(
    `Commit blocked: private credential files must not be staged:\n${blocked.join("\n")}`,
  );
  console.error("Use a sanitized .env.example for configuration templates.");
  process.exit(1);
}
