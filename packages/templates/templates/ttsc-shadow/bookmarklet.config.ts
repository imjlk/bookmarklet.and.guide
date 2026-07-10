import { defineBookmarkletConfig } from "@bmkl/core";

export default defineBookmarkletConfig({
  name: "__BMKL_PROJECT_NAME__",
  globalName: "__BMKL_GLOBAL_NAME__",
  entry: "src/inject.ts",
  outDir: "dist/bookmarklet",
  runtime: "remote",
  ui: "shadow",
  channel: "latest",
  remote: {
    baseUrl: "https://example.com/bookmarklet/",
    cacheBust: true,
  },
  ttsc: {
    enabled: true,
    project: "tsconfig.json",
    prepare: true,
    typecheck: true,
  },
  output: {
    installHtml: true,
    manifest: true,
    report: true,
  },
});
