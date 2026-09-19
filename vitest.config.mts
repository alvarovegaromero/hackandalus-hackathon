import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// "@/x" resolves to ./x first and ./src/x second, mirroring "paths" in tsconfig.json.
const root = fileURLToPath(new URL(".", import.meta.url));
const bases = [root, path.join(root, "src")];
const suffixes = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function resolveAlias(source: string): string | null {
  for (const base of bases) {
    for (const suffix of suffixes) {
      const candidate = path.join(base, source + suffix);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: "$1", customResolver: (source) => resolveAlias(source) },
    ],
  },
});
