import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const cwd = process.cwd();
const targets = process.argv.length > 2 ? process.argv.slice(2) : ["dist"];

for (const target of targets) {
  const path = resolve(cwd, target);
  if (path === cwd || !path.startsWith(`${cwd}${sep}`)) {
    throw new Error(`Refusing to clean outside the package: ${target}`);
  }
  await rm(path, { force: true, recursive: true });
}
