// Removes a root `app/` folder that holds only Workflow output.
// Next.js prefers a root `app/` over `src/app/`, so a leftover one makes every route 404.
import { existsSync, readdirSync, rmSync } from "node:fs";

if (existsSync("src/app") && existsSync("app")) {
  const entries = readdirSync("app");
  if (entries.every((entry) => entry === ".well-known")) {
    rmSync("app", { recursive: true, force: true });
    console.log("Removed stray root app/ (Workflow output only); routes live in src/app.");
  } else {
    console.warn("Root app/ contains real files and shadows src/app; move or delete it.");
  }
}
