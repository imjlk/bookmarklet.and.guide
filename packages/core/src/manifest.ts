import { createHash } from "node:crypto";
import type {
  BookmarkletBuildConfig,
  BookmarkletManifest,
} from "./types.js";

export function createManifest(
  config: BookmarkletBuildConfig,
  appCode: string,
): BookmarkletManifest {
  return {
    name: config.name,
    version: "0.1.0",
    channel: config.channel,
    runtime: config.runtime,
    ui: config.ui,
    entry: config.remote?.appPath ?? "app.iife.js",
    loader: config.remote?.loaderPath ?? "loader.js",
    sha256: createHash("sha256").update(appCode).digest("hex"),
    releaseDate: new Date().toISOString(),
    compat: {
      runtime: "bmkl@0.1",
      minBrowser: "chrome>=120, firefox>=120, safari>=17",
    },
  };
}
