import { existsSync } from "node:fs";
import { cwd as processCwd } from "node:process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import type {
  BookmarkletBuildConfig,
  BookmarkletUserConfig,
  LoadConfigOptions,
} from "./types.js";

const DEFAULT_CONFIG_FILES = [
  "bookmarklet.config.ts",
  "bookmarklet.config.mts",
  "bookmarklet.config.js",
  "bookmarklet.config.mjs",
  "bmkl.config.ts",
  "bmkl.config.mts",
  "bmkl.config.js",
  "bmkl.config.mjs",
];

export function defineBookmarkletConfig(
  config: BookmarkletUserConfig,
): BookmarkletUserConfig {
  return config;
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<BookmarkletBuildConfig> {
  const cwd = resolve(options.cwd ?? processCwd());
  const configFile = findConfigFile(cwd, options.configFile);
  const loaded = configFile ? await importConfig(configFile) : {};
  return resolveConfig(
    {
      name: "bookmarklet-app",
      entry: "src/inject.ts",
      ...loaded,
      ...options.overrides,
    },
    configFile ? dirname(configFile) : cwd,
  );
}

export function resolveConfig(
  userConfig: BookmarkletUserConfig,
  configRoot = processCwd(),
): BookmarkletBuildConfig {
  const root = resolve(configRoot, userConfig.root ?? ".");
  const name = userConfig.name;

  return {
    root,
    entry: userConfig.entry,
    outDir: userConfig.outDir ?? "dist/bookmarklet",
    name,
    globalName: userConfig.globalName ?? toGlobalName(name),
    runtime: userConfig.runtime ?? "remote",
    ui: userConfig.ui ?? "shadow",
    channel: userConfig.channel ?? "latest",
    remote: {
      baseUrl: userConfig.remote?.baseUrl ?? "https://example.com/bookmarklet/",
      loaderPath: userConfig.remote?.loaderPath ?? "loader.js",
      appPath: userConfig.remote?.appPath ?? "app.iife.js",
      manifestPath: userConfig.remote?.manifestPath ?? "manifest.json",
      cacheBust: userConfig.remote?.cacheBust ?? true,
    },
    vite: {
      configFile: userConfig.vite?.configFile,
      mode: userConfig.vite?.mode ?? "production",
      sourcemap: userConfig.vite?.sourcemap ?? false,
      minify: userConfig.vite?.minify ?? "esbuild",
    },
    ttsc: {
      enabled: userConfig.ttsc?.enabled ?? true,
      project: userConfig.ttsc?.project ?? "tsconfig.json",
      prepare: userConfig.ttsc?.prepare ?? false,
      typecheck: userConfig.ttsc?.typecheck ?? true,
      plugins: userConfig.ttsc?.plugins ?? false,
    },
    output: {
      bookmarkletFile: userConfig.output?.bookmarkletFile ?? "bookmarklet.txt",
      installHtml: userConfig.output?.installHtml ?? true,
      manifest: userConfig.output?.manifest ?? true,
      report: userConfig.output?.report ?? true,
    },
  };
}

function findConfigFile(cwd: string, configFile?: string): string | undefined {
  if (configFile) {
    const path = resolve(cwd, configFile);
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`);
    }
    return path;
  }

  return DEFAULT_CONFIG_FILES.map((file) => resolve(cwd, file)).find(existsSync);
}

async function importConfig(path: string): Promise<BookmarkletUserConfig> {
  try {
    if (path.endsWith(".json")) {
      const imported = await import(pathToFileURL(path).href, {
        with: { type: "json" },
      });
      return imported.default;
    }

    const jiti = createJiti(pathToFileURL(path).href);
    const imported = await jiti.import(path, { default: true });
    return imported as BookmarkletUserConfig;
  } catch (error) {
    throw new Error(`Failed to load bookmarklet config: ${path}`, {
      cause: error,
    });
  }
}

function toGlobalName(name: string): string {
  const normalized = name
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

  return normalized || "BookmarkletApp";
}
