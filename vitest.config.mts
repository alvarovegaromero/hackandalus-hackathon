import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// "@/x" resolves to ./src/x, mirroring "paths" in tsconfig.json.
const root = fileURLToPath(new URL(".", import.meta.url));
const bases = [path.join(root, "src")];
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
  plugins: [
    {
      name: "root-then-src-alias",
      enforce: "pre",
      resolveId: (source) => (source.startsWith("@/") ? resolveAlias(source.slice(2)) : null),
    },
  ],
});
