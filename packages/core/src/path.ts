import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export function resolveFrom(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
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
