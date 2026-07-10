export const BOOKMARKLET_RUNTIME_CHOICES = ["inline", "remote"] as const;
export const BOOKMARKLET_UI_MODE_CHOICES = [
  "shadow",
  "iframe",
  "none",
] as const;
export const BOOKMARKLET_UPDATE_CHANNEL_CHOICES = [
  "dev",
  "canary",
  "latest",
  "pinned",
] as const;

export type BookmarkletRuntime = (typeof BOOKMARKLET_RUNTIME_CHOICES)[number];
export type BookmarkletUiMode = (typeof BOOKMARKLET_UI_MODE_CHOICES)[number];
export type UpdateChannel = (typeof BOOKMARKLET_UPDATE_CHANNEL_CHOICES)[number];

export interface BookmarkletRemoteConfig {
  baseUrl: string;
  loaderPath?: string;
  appPath?: string;
  manifestPath?: string;
  cacheBust?: boolean;
}

export interface BookmarkletViteConfig {
  configFile?: string | false;
  mode?: string;
  sourcemap?: boolean;
  minify?: boolean | "esbuild" | "terser";
}

export interface BookmarkletTtscPluginConfig {
  transform?: string;
  name?: string;
  [key: string]: unknown;
}

export interface BookmarkletTtscConfig {
  enabled?: boolean;
  project?: string;
  prepare?: boolean;
  typecheck?: boolean;
  plugins?: false | BookmarkletTtscPluginConfig[];
}

export interface BookmarkletOutputConfig {
  bookmarkletFile?: string;
  installHtml?: boolean;
  manifest?: boolean;
  report?: boolean;
}

export interface BookmarkletBuildConfig {
  root: string;
  entry: string;
  outDir: string;
  name: string;
  globalName: string;
  runtime: BookmarkletRuntime;
  ui: BookmarkletUiMode;
  channel: UpdateChannel;
  remote?: BookmarkletRemoteConfig;
  vite?: BookmarkletViteConfig;
  ttsc?: BookmarkletTtscConfig;
  output?: BookmarkletOutputConfig;
}

export type BookmarkletUserConfig = Partial<BookmarkletBuildConfig> &
  Pick<BookmarkletBuildConfig, "entry" | "name">;

export type BookmarkletConfigOverrides = Omit<
  Partial<BookmarkletBuildConfig>,
  "output" | "remote" | "ttsc" | "vite"
> & {
  output?: Partial<BookmarkletOutputConfig>;
  remote?: Partial<BookmarkletRemoteConfig>;
  ttsc?: Partial<BookmarkletTtscConfig>;
  vite?: Partial<BookmarkletViteConfig>;
};

export interface LoadConfigOptions {
  cwd?: string;
  configFile?: string;
  overrides?: BookmarkletConfigOverrides;
}

export interface DevServerOptions {
  debug?: boolean;
  host?: string;
  port?: number;
  strictPort?: boolean;
  https?: boolean;
  open?: boolean;
  target?: string;
}

export interface DevServerResult {
  bookmarkletUrl: string;
  close: () => Promise<void>;
  debugBookmarkletUrl?: string;
  debugConsoleUrl?: string;
  debugLauncherBookmarkletUrl?: string;
  debugLauncherUrl?: string;
  launcherBookmarkletUrl: string;
  launcherUrl: string;
  target?: string;
  url: string;
}

export interface CompanionBuildOptions {
  debugConsoleUrl?: string;
  host?: string;
  outDir?: string;
  port?: number;
  quiet?: boolean;
  target?: string;
}

export interface CompanionBuildResult {
  contentScriptPath: string;
  debugConsoleUrl: string;
  manifestPath: string;
  outDir: string;
  targetMatch: string;
}

export interface BookmarkletArtifact {
  kind:
    | "app"
    | "loader"
    | "bookmarklet"
    | "install-html"
    | "manifest"
    | "report";
  fileName: string;
  path: string;
  size: number;
  text?: string;
}

export interface BookmarkletBuildResult {
  config: BookmarkletBuildConfig;
  artifacts: BookmarkletArtifact[];
  bookmarkletUrl: string;
  warnings: string[];
}

export interface BookmarkletBuildOptions {
  quiet?: boolean;
}

export interface BookmarkletInspectResult {
  bookmarkletLength: number;
  artifacts: BookmarkletArtifact[];
  manifest?: BookmarkletManifest;
  report?: BookmarkletBuildReport;
  warnings: string[];
}

export interface BookmarkletManifest {
  name: string;
  version: string;
  channel: UpdateChannel;
  runtime: BookmarkletRuntime;
  ui: BookmarkletUiMode;
  entry: string;
  loader: string;
  sha256: string;
  releaseDate: string;
  compat: {
    runtime: string;
    minBrowser: string;
  };
}

export interface BookmarkletBuildReport {
  name: string;
  runtime: BookmarkletRuntime;
  channel: UpdateChannel;
  buildTime: string;
  bookmarkletLength: number;
  cspRisk: "low" | "medium" | "high";
  artifacts: Array<Pick<BookmarkletArtifact, "kind" | "fileName" | "size">>;
  warnings: string[];
}

export interface RemoteLoaderOptions {
  id: string;
  globalName: string;
  src: string;
  cacheBust?: boolean;
  onErrorMessage?: string;
}
