import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

export function resolveFrom(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

export function resolveSafeOutputDir(
  projectRoot: string,
  path: string,
  label = "Output directory",
): string {
  const normalizedProjectRoot = resolve(projectRoot);
  const outputDir = resolveFrom(normalizedProjectRoot, path);

  if (outputDir === parse(outputDir).root) {
    throw new Error(`${label} cannot be the filesystem root: ${outputDir}`);
  }
  if (outputDir === resolve(homedir())) {
    throw new Error(`${label} cannot be the home directory: ${outputDir}`);
  }
  if (outputDir === normalizedProjectRoot) {
    throw new Error(`${label} cannot be the project root: ${outputDir}`);
  }

  assertPathInside(normalizedProjectRoot, outputDir, label);
  return outputDir;
}

export function resolveOutputFile(
  outputRoot: string,
  path: string,
  label: string,
): string {
  if (!path.trim()) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be relative to its output directory: ${path}`);
  }
  if (/[\\/]$/.test(path.trim())) {
    throw new Error(`${label} must resolve to a file, not a directory: ${path}`);
  }

  const normalizedOutputRoot = resolve(outputRoot);
  const outputPath = resolve(normalizedOutputRoot, path);
  if (outputPath === normalizedOutputRoot) {
    throw new Error(
      `${label} must resolve to a file inside its output directory.`,
    );
  }

  assertPathInside(normalizedOutputRoot, outputPath, label);
  return outputPath;
}

export async function assertOutputDirFilesystemBoundary(
  projectRoot: string,
  outputDir: string,
  label: string,
): Promise<void> {
  const normalizedProjectRoot = resolve(projectRoot);
  const normalizedOutputDir = resolve(outputDir);
  const realProjectRoot = await realpath(normalizedProjectRoot);
  let existingAncestor = normalizedOutputDir;

  while (true) {
    try {
      const info = await lstat(existingAncestor);
      if (
        existingAncestor === normalizedOutputDir &&
        info.isSymbolicLink()
      ) {
        throw new Error(`${label} must not be a symbolic link: ${outputDir}`);
      }

      const [realAncestor, realAncestorInfo] = await Promise.all([
        realpath(existingAncestor),
        stat(existingAncestor),
      ]);
      if (!realAncestorInfo.isDirectory()) {
        throw new Error(
          `${label} has a non-directory ancestor: ${existingAncestor}`,
        );
      }
      assertPathInside(realProjectRoot, realAncestor, label);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new Error(`${label} has no existing filesystem ancestor: ${outputDir}`);
      }
      existingAncestor = parent;
    }
  }
}

export function toOutputFileName(outputRoot: string, outputPath: string): string {
  assertPathInside(outputRoot, outputPath, "Bundle output file");
  return relative(resolve(outputRoot), resolve(outputPath)).split(sep).join("/");
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeTextFile(path: string, text: string): Promise<number> {
  await ensureDir(dirname(path));
  await writeFile(path, text);
  const info = await stat(path);
  return info.size;
}

export function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new Error(`Invalid remote base URL: ${baseUrl}`, { cause: error });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Remote base URL must use HTTP(S) without credentials, a query, or a fragment: ${baseUrl}`,
    );
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.toString();
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const relativePath = path.replace(/^\//, "");
  if (
    !relativePath ||
    path !== path.trim() ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[?#]/.test(path) ||
    /^[a-z][a-z\d+.-]*:/i.test(relativePath)
  ) {
    throw new Error(`Remote asset path must be a relative URL path: ${path}`);
  }

  const joined = new URL(relativePath, base);
  if (
    joined.origin !== base.origin ||
    !joined.pathname.startsWith(base.pathname)
  ) {
    throw new Error(`Remote asset path must stay inside the base URL: ${path}`);
  }
  return joined.toString();
}

function assertPathInside(root: string, path: string, label: string): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside ${resolve(root)}: ${resolve(path)}`);
  }
}
