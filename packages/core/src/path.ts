import { mkdir, stat, writeFile } from "node:fs/promises";
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
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), normalizeBaseUrl(baseUrl)).toString();
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
