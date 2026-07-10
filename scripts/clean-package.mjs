import { lstat, realpath, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const cwd = process.cwd();
const realCwd = await realpath(cwd);
const targets = process.argv.length > 2 ? process.argv.slice(2) : ["dist"];

for (const target of targets) {
  const path = resolve(cwd, target);
  const relativePath = relative(cwd, path);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to clean outside the package: ${target}`);
  }
  await assertExistingAncestorInsidePackage(path, target);
  await rm(path, { force: true, recursive: true });
}

async function assertExistingAncestorInsidePackage(path, target) {
  let existingAncestor = path;
  while (true) {
    try {
      const info = await lstat(existingAncestor);
      if (existingAncestor === path && info.isSymbolicLink()) {
        throw new Error(`Refusing to clean a symbolic link: ${target}`);
      }
      const [realAncestor, realAncestorInfo] = await Promise.all([
        realpath(existingAncestor),
        stat(existingAncestor),
      ]);
      const relativePath = relative(realCwd, realAncestor);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        throw new Error(`Refusing to clean outside the package: ${target}`);
      }
      if (!realAncestorInfo.isDirectory()) {
        throw new Error(`Refusing to clean through a file: ${target}`);
      }
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new Error(`Cannot resolve a safe clean path: ${target}`);
      }
      existingAncestor = parent;
    }
  }
}
