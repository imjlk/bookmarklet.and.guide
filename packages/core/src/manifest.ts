import { createHash } from "node:crypto";
import type {
  BookmarkletBuildConfig,
  BookmarkletManifest,
} from "./types.js";
import {
  getCorePackageVersion,
  toBmklManifestVersion,
  toBmklRuntimeCompatibility,
} from "./version.js";

export function createManifest(
  config: BookmarkletBuildConfig,
  appCode: string,
): BookmarkletManifest {
  const packageVersion = getCorePackageVersion();
  return {
    name: config.name,
    version: toBmklManifestVersion(packageVersion),
    channel: config.channel,
    runtime: config.runtime,
    ui: config.ui,
    entry: config.remote?.appPath ?? "app.iife.js",
    loader: config.remote?.loaderPath ?? "loader.js",
    sha256: createHash("sha256").update(appCode).digest("hex"),
    releaseDate: new Date().toISOString(),
    compat: {
      runtime: toBmklRuntimeCompatibility(packageVersion),
      minBrowser: "chrome>=120, firefox>=120, safari>=17",
    },
  };
}
