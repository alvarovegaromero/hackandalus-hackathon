import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [".next/**", ".next.*/**", "node_modules/**", "next-env.d.ts"]
  },
  ...compat.extends("next/core-web-vitals").map((config) => ({
    ...config,
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"]
  }))
];
