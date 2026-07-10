import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join, resolve } from "node:path";

export const DEBUG_TOKEN_QUERY_PARAM = "token";

const DEBUG_TOKEN_BYTES = 32;
const DEBUG_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export async function loadOrCreateDebugToken(projectRoot: string): Promise<string> {
  const tokenDir = resolve(projectRoot, ".bmkl-dev-cert");
  const tokenPath = join(tokenDir, "debug-token");

  await mkdir(tokenDir, { mode: 0o700, recursive: true });
  await chmod(tokenDir, 0o700);

  try {
    return await readDebugToken(tokenPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  const token = randomBytes(DEBUG_TOKEN_BYTES).toString("hex");
  const tempPath = join(
    tokenDir,
    `.debug-token-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );

  try {
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(tempPath, tokenPath);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  } finally {
    await rm(tempPath, { force: true });
  }

  return readDebugToken(tokenPath);
}

export function addDebugToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(DEBUG_TOKEN_QUERY_PARAM, token);
  return parsed.toString();
}

export function hasValidDebugToken(url: URL, expectedToken: string): boolean {
  const providedToken = url.searchParams.get(DEBUG_TOKEN_QUERY_PARAM);
  if (!providedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readDebugToken(path: string): Promise<string> {
  const token = (await readFile(path, "utf8")).trim();
  if (!DEBUG_TOKEN_PATTERN.test(token)) {
    throw new Error(
      `Invalid BMKL debug token file: ${path}. Delete it and restart the debug command.`,
    );
  }

  await chmod(path, 0o600);
  return token;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
