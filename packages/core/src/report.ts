import type {
  BookmarkletArtifact,
  BookmarkletBuildConfig,
  BookmarkletBuildReport,
} from "./types.js";

export function createBuildReport(options: {
  config: BookmarkletBuildConfig;
  artifacts: BookmarkletArtifact[];
  bookmarkletUrl: string;
  warnings: string[];
}): BookmarkletBuildReport {
  const { config, artifacts, bookmarkletUrl, warnings } = options;

  return {
    name: config.name,
    runtime: config.runtime,
    channel: config.channel,
    buildTime: new Date().toISOString(),
    bookmarkletLength: bookmarkletUrl.length,
    cspRisk: config.runtime === "inline" ? "low" : "medium",
    artifacts: artifacts.map(({ kind, fileName, size }) => ({
      kind,
      fileName,
      size,
    })),
    warnings,
  };
}
