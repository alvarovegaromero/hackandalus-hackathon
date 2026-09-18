import { constants, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const template = fileURLToPath(new URL("../.env.example", import.meta.url));
const target = fileURLToPath(new URL("../.env.local", import.meta.url));

try {
  copyFileSync(template, target, constants.COPYFILE_EXCL);
  console.log("Created .env.local with empty placeholders. Fill values locally; never commit it.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env.local already exists; preserved without reading or modifying it.");
}
