// Explicit, on-demand schema installation. No credentials are printed or passed as CLI arguments.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

if (!process.argv.includes("--apply") && !process.argv.includes("--smoke")) {
  console.log(
    "Review supabase/migrations/202609190004_resource_inventory.sql, then run this script with --apply. Requires psql on PATH.",
  );
  process.exit(0);
}
const env = {
  ...parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8")),
  ...process.env,
};
const connection = process.argv.includes("--pooler")
  ? env.SUPABASE_POOLER_DB_URL
  : env.SUPABASE_DIRECT_DB_URL || env.SUPABASE_POOLER_DB_URL;
if (!connection) throw new Error("A Supabase database connection URL is required.");
const url = new URL(connection);
const result = spawnSync(
  "psql",
  [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "--single-transaction",
    "-f",
    process.argv.includes("--smoke")
      ? "scripts/try-resource-inventory.sql"
      : process.argv.includes("--reset")
        ? "supabase/migrations/202609190006_coordinator_reset.sql"
        : "supabase/migrations/202609190004_resource_inventory.sql",
  ],
  {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: process.argv.includes("--session") ? "5432" : url.port || "5432",
      PGDATABASE: url.pathname.slice(1),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: "require",
      PGCONNECT_TIMEOUT: "10",
    },
    encoding: "utf8",
  },
);
// Redact connection details while preserving actionable SQL/network diagnostics.
if (result.status !== 0) {
  let detail = result.error?.message ?? result.stderr ?? "Unknown psql failure";
  for (const value of [
    connection,
    url.hostname,
    decodeURIComponent(url.username),
    decodeURIComponent(url.password),
  ]) {
    if (value) detail = detail.split(value).join("[REDACTED]");
  }
  console.error(detail.slice(0, 2000));
}
console.log(
  result.status === 0
    ? process.argv.includes("--smoke")
      ? "Resource smoke exercise passed: eight scenarios; all writes rolled back."
      : "Resource migration applied atomically."
    : "Resource migration failed; transaction rolled back. Check connectivity and migration status.",
);
process.exit(result.status === 0 ? 0 : 1);
