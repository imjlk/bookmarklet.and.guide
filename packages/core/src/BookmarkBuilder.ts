import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import { basename, join, relative } from "node:path";
import {
  parseBmklRemoteManifestJson,
  stringifyBmklRemoteManifest,
} from "@bmkl/contracts";
import {
  createServer,
  build as viteBuild,
  mergeConfig,
  type ViteDevServer,
} from "vite";
import { buildCompanionExtension } from "./companion.js";
import { installDebugConsoleMiddleware } from "./debug-console.js";
import {
  addDebugToken,
  hasValidDebugToken,
  loadOrCreateDebugToken,
} from "./debug-token.js";
import { toBookmarklet } from "./encoder.js";
import { createInstallPage } from "./install-page.js";
import {
  createBookmarkletLoader,
  createDebugDevBookmarkletSource,
  createDevLauncherBookmarkletSource,
  createDevBookmarkletSource,
  createRemoteScriptLoader,
} from "./loader.js";
import { createManifest } from "./manifest.js";
import {
  assertOutputDirFilesystemBoundary,
  ensureDir,
  joinUrl,
  resolveFrom,
  resolveOutputFile,
  resolveSafeOutputDir,
  toOutputFileName,
  writeTextFile,
} from "./path.js";
import { runCommand } from "./process.js";
import { createBuildReport } from "./report.js";
import type {
  BookmarkletArtifact,
  BookmarkletBuildConfig,
  BookmarkletBuildOptions,
  BookmarkletBuildReport,
  BookmarkletBuildResult,
  BookmarkletInspectResult,
  BookmarkletManifest,
  CompanionBuildOptions,
  CompanionBuildResult,
  DevServerResult,
  DevServerOptions,
} from "./types.js";

export class BookmarkBuilder {
  readonly config: BookmarkletBuildConfig;

  constructor(config: BookmarkletBuildConfig) {
    this.config = config;
  }

  async build(
    options: BookmarkletBuildOptions = {},
  ): Promise<BookmarkletBuildResult> {
    const warnings: string[] = [];
    const paths = this.paths();
    await this.prepareTtsc(warnings, options);
    await this.typecheck(warnings, options);

    await assertOutputDirFilesystemBoundary(
      this.config.root,
      paths.outDir,
      "Bookmarklet output directory",
    );
    await rm(paths.outDir, { force: true, recursive: true });
    await ensureDir(paths.remoteDir);
    await ensureDir(paths.inlineDir);
    await ensureDir(paths.metaDir);

    await this.bundle(options);
    const appCode = await readFile(paths.remoteApp, "utf8");
    const loaderSource = this.generateLoader();
    const bookmarkletSource =
      this.config.runtime === "inline"
        ? appCode
        : createBookmarkletLoader(
            `${this.loaderDomId()}__bookmarklet`,
            joinUrl(
              this.config.remote?.baseUrl ?? "",
              this.config.remote?.loaderPath ?? "loader.js",
            ),
          );
    const bookmarkletUrl = toBookmarklet(bookmarkletSource);
    const manifest = createManifest(this.config, appCode);

    const artifacts: BookmarkletArtifact[] = [];
    artifacts.push(await this.artifact("app", paths.remoteApp));
    artifacts.push(
      await this.writeArtifact("loader", paths.remoteLoader, loaderSource, true),
    );

    if (this.config.output?.manifest !== false) {
      artifacts.push(
        await this.writeArtifact(
          "manifest",
          paths.remoteManifest,
          `${stringifyBmklRemoteManifest(manifest)}\n`,
          true,
        ),
      );
    }

    artifacts.push(
      await this.writeArtifact(
        "bookmarklet",
        paths.remoteBookmarklet,
        `${bookmarkletUrl}\n`,
        true,
      ),
    );
    artifacts.push(
      await this.writeArtifact(
        "bookmarklet",
        paths.inlineBookmarklet,
        `${toBookmarklet(appCode)}\n`,
        true,
      ),
    );

    if (this.config.output?.installHtml !== false) {
      artifacts.push(
        await this.writeArtifact(
          "install-html",
          paths.installHtml,
          createInstallPage({ config: this.config, bookmarkletUrl, manifest }),
          true,
        ),
      );
    }

    if (this.config.output?.report !== false) {
      const report = createBuildReport({
        config: this.config,
        artifacts,
        bookmarkletUrl,
        warnings,
      });
      artifacts.push(
        await this.writeArtifact(
          "report",
          paths.report,
          `${JSON.stringify(report, null, 2)}\n`,
          true,
        ),
      );
    }

    return {
      config: this.config,
      artifacts,
      bookmarkletUrl,
      warnings,
    };
  }

  async dev(options: DevServerOptions = {}): Promise<DevServerResult> {
    const debugToken = options.debug
      ? await loadOrCreateDebugToken(this.config.root)
      : undefined;
    let devAddress = "";
    const addressFallback = () =>
      `${options.https ? "https" : "http"}://${options.host ?? "127.0.0.1"}:${options.port ?? 5173}/`;
    const currentAddress = () => devAddress || addressFallback();
    const launcherPath = "/__bmkl/launcher.js";
    const devCors = createDevCorsOption(options.target);
    const httpsOptions = options.https
      ? await this.createDevHttpsOptions()
      : undefined;

    const server = await createServer({
      root: this.config.root,
      configFile: this.config.vite?.configFile || undefined,
      plugins: [
        ...(debugToken
          ? [
              {
                name: "bmkl:debug-auth-guard",
                configureServer: (viteServer: ViteDevServer) => {
                  installDebugAuthGuard(viteServer, debugToken, launcherPath);
                },
              },
              {
                name: "bmkl:debug-cors",
                configureServer: (viteServer: ViteDevServer) => {
                  installDevCorsMiddleware(viteServer, devCors);
                },
              },
            ]
          : []),
        {
          name: "bmkl:dev-launcher",
          configureServer: (viteServer: ViteDevServer) => {
            viteServer.middlewares.use((req, res, next) => {
              const url = new URL(req.url ?? "/", currentAddress());
              if (url.pathname !== launcherPath) {
                next();
                return;
              }

              const moduleUrl = new URL(this.config.entry, currentAddress()).toString();
              const debugRequested =
                url.searchParams.get("debug") === "1" ||
                url.searchParams.get("mode") === "debug";
              if (
                debugRequested &&
                debugToken &&
                !hasValidDebugToken(url, debugToken)
              ) {
                res.statusCode = 404;
                res.end();
                return;
              }
              const debugConsoleUrl = debugToken
                ? addDebugToken(
                    new URL("__bmkl/debug", currentAddress()).toString(),
                    debugToken,
                  )
                : new URL("__bmkl/debug", currentAddress()).toString();
              const source =
                debugRequested && debugToken
                  ? createDebugDevBookmarkletSource({
                      id: `${this.loaderDomId()}__debug_dev`,
                      moduleUrl,
                      globalName: this.config.globalName,
                      debugConsoleUrl,
                      target: options.target,
                    })
                  : debugRequested
                    ? 'alert("BMKL debug launcher is unavailable. Restart bmkl dev with --debug.");'
                    : createDevBookmarkletSource(
                        `${this.loaderDomId()}__dev`,
                        moduleUrl,
                        this.config.globalName,
                      );

              res.statusCode = 200;
              res.setHeader("content-type", "application/javascript; charset=utf-8");
              res.setHeader("cache-control", "no-store");
              res.end(`${source}\n`);
            });
          },
        },
        ...(debugToken
          ? [
              {
                name: "bmkl:debug-console",
                configureServer: (viteServer: ViteDevServer) => {
                  installDebugConsoleMiddleware(viteServer, {
                    appName: this.config.name,
                    token: debugToken,
                  });
                },
              },
            ]
          : []),
      ],
      server: {
        cors: debugToken ? false : devCors,
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 5173,
        strictPort: options.strictPort ?? false,
        https: httpsOptions,
        open: options.open ?? false,
      },
    });

    await server.listen();
    const address = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:5173/";
    devAddress = address;
    const moduleUrl = new URL(this.config.entry, address).toString();
    const launcherUrl = new URL(launcherPath.replace(/^\//, ""), address).toString();
    const debugLauncherUrl = debugToken
      ? addDebugToken(
          new URL(`${launcherPath.replace(/^\//, "")}?debug=1`, address).toString(),
          debugToken,
        )
      : undefined;
    const launcherBookmarkletUrl = toBookmarklet(
      createDevLauncherBookmarkletSource(
        `${this.loaderDomId()}__dev_launcher`,
        launcherUrl,
      ),
    );
    const debugLauncherBookmarkletUrl = debugLauncherUrl
      ? toBookmarklet(
          createDevLauncherBookmarkletSource(
            `${this.loaderDomId()}__debug_launcher`,
            debugLauncherUrl,
          ),
        )
      : undefined;
    const bookmarkletUrl = toBookmarklet(
      createDevBookmarkletSource(
        `${this.loaderDomId()}__dev`,
        moduleUrl,
        this.config.globalName,
      ),
    );
    const debugConsoleUrl = debugToken
      ? addDebugToken(new URL("__bmkl/debug", address).toString(), debugToken)
      : undefined;
    const debugBookmarkletUrl =
      debugToken && debugConsoleUrl
        ? toBookmarklet(
            createDebugDevBookmarkletSource({
              id: `${this.loaderDomId()}__debug_dev`,
              moduleUrl,
              globalName: this.config.globalName,
              debugConsoleUrl,
              target: options.target,
            }),
          )
        : undefined;

    return {
      close: () => server.close(),
      bookmarkletUrl,
      launcherBookmarkletUrl,
      launcherUrl,
      debugBookmarkletUrl,
      debugConsoleUrl,
      debugLauncherBookmarkletUrl,
      debugLauncherUrl,
      target: options.target,
      url: address,
    };
  }

  async inspect(): Promise<BookmarkletInspectResult> {
    const paths = this.paths();
    const artifacts: BookmarkletArtifact[] = [];
    const warnings: string[] = [];
    let bookmarkletLength = 0;
    const manifestEnabled = this.config.output?.manifest !== false;
    const installHtmlEnabled = this.config.output?.installHtml !== false;
    const reportEnabled = this.config.output?.report !== false;
    const expectedArtifacts: Array<
      readonly [BookmarkletArtifact["kind"], string]
    > = [
      ["app", paths.remoteApp],
      ["loader", paths.remoteLoader],
    ];

    if (manifestEnabled) {
      expectedArtifacts.push(["manifest", paths.remoteManifest]);
    }
    expectedArtifacts.push(
      ["bookmarklet", paths.remoteBookmarklet],
      ["bookmarklet", paths.inlineBookmarklet],
    );
    if (installHtmlEnabled) {
      expectedArtifacts.push(["install-html", paths.installHtml]);
    }
    if (reportEnabled) {
      expectedArtifacts.push(["report", paths.report]);
    }

    for (const [kind, path] of expectedArtifacts) {
      try {
        artifacts.push(await this.artifact(kind, path));
      } catch {
        warnings.push(`Missing artifact: ${relative(this.config.root, path)}`);
      }
    }

    const primaryBookmarklet =
      this.config.runtime === "inline"
        ? paths.inlineBookmarklet
        : paths.remoteBookmarklet;
    try {
      bookmarkletLength = (await readFile(primaryBookmarklet, "utf8")).trim()
        .length;
    } catch {
      warnings.push("Run bmkl build before inspecting bookmarklet length.");
    }

    const inspectedPaths = new Set(artifacts.map((artifact) => artifact.path));
    const manifest = manifestEnabled
      ? await readManifest(paths.remoteManifest)
      : undefined;
    if (
      manifestEnabled &&
      inspectedPaths.has(paths.remoteManifest) &&
      !manifest
    ) {
      warnings.push(
        `Invalid manifest artifact: ${relative(this.config.root, paths.remoteManifest)}`,
      );
    }

    const report = reportEnabled ? await readBuildReport(paths.report) : undefined;
    if (reportEnabled && inspectedPaths.has(paths.report) && !report) {
      warnings.push(
        `Invalid build report artifact: ${relative(this.config.root, paths.report)}`,
      );
    }

    return {
      bookmarkletLength,
      artifacts,
      manifest,
      report,
      warnings,
    };
  }

  async companion(
    options: CompanionBuildOptions = {},
  ): Promise<CompanionBuildResult> {
    return buildCompanionExtension(this.config, options);
  }

  private async prepareTtsc(
    warnings: string[],
    options: BookmarkletBuildOptions,
  ): Promise<void> {
    if (!this.config.ttsc?.enabled || !this.config.ttsc.prepare) {
      return;
    }

    try {
      await runCommand("ttsc", ["--version"], {
        cwd: this.config.root,
        quiet: options.quiet,
      });
    } catch (error) {
      warnings.push(toMessage(error));
    }
  }

  private async typecheck(
    warnings: string[],
    options: BookmarkletBuildOptions,
  ): Promise<void> {
    if (!this.config.ttsc?.enabled || !this.config.ttsc.typecheck) {
      return;
    }

    const project = this.config.ttsc.project ?? "tsconfig.json";
    try {
      await runCommand("ttsc", ["--noEmit", "--project", project], {
        cwd: this.config.root,
        quiet: options.quiet,
      });
    } catch (error) {
      warnings.push("ttsc typecheck failed.");
      throw error;
    }
  }

  private async bundle(options: BookmarkletBuildOptions): Promise<void> {
    const paths = this.paths();
    const configFile = this.config.vite?.configFile ?? undefined;
    const entry = resolveFrom(this.config.root, this.config.entry);
    const outputFileName = toOutputFileName(paths.remoteDir, paths.remoteApp);

    const previousBuilderFlag = process.env.BMKL_BUILDER;
    process.env.BMKL_BUILDER = "1";
    try {
      await viteBuild(
        mergeConfig(
          {
            root: this.config.root,
            configFile,
          },
          {
            ...(options.quiet ? { logLevel: "silent" as const } : {}),
            build: {
              emptyOutDir: false,
              lib: {
                entry,
                name: this.config.globalName,
                formats: ["iife"],
                fileName: () => outputFileName,
              },
              minify: this.config.vite?.minify ?? "esbuild",
              outDir: paths.remoteDir,
              sourcemap: this.config.vite?.sourcemap ?? false,
            },
          },
        ),
      );
    } finally {
      if (previousBuilderFlag === undefined) {
        delete process.env.BMKL_BUILDER;
      } else {
        process.env.BMKL_BUILDER = previousBuilderFlag;
      }
    }
  }

  private async createDevHttpsOptions(): Promise<HttpsServerOptions> {
    const certDir = resolveFrom(this.config.root, ".bmkl-dev-cert");
    const keyPath = join(certDir, "localhost-key.pem");
    const certPath = join(certDir, "localhost-cert.pem");
    const configPath = join(certDir, "openssl.cnf");

    try {
      await Promise.all([stat(keyPath), stat(certPath)]);
    } catch {
      await ensureDir(certDir);
      await writeTextFile(configPath, DEV_CERT_OPENSSL_CONFIG);
      await execFileAsync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        "365",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-subj",
        "/CN=localhost",
        "-config",
        configPath,
        "-extensions",
        "v3_req",
      ]);
    }

    return {
      key: await readFile(keyPath),
      cert: await readFile(certPath),
    };
  }

  private generateLoader(): string {
    return createRemoteScriptLoader({
      id: this.loaderDomId(),
      globalName: this.config.globalName,
      src: joinUrl(
        this.config.remote?.baseUrl ?? "",
        this.config.remote?.appPath ?? "app.iife.js",
      ),
      cacheBust: this.config.remote?.cacheBust,
    });
  }

  private paths() {
    const outDir = resolveSafeOutputDir(
      this.config.root,
      this.config.outDir,
      "Bookmarklet output directory",
    );
    const remoteDir = join(outDir, "remote");
    const inlineDir = join(outDir, "inline");
    const metaDir = join(outDir, "meta");
    const remoteApp = resolveOutputFile(
      remoteDir,
      this.config.remote?.appPath ?? "app.iife.js",
      "remote.appPath",
    );
    const remoteLoader = resolveOutputFile(
      remoteDir,
      this.config.remote?.loaderPath ?? "loader.js",
      "remote.loaderPath",
    );
    const remoteManifest = resolveOutputFile(
      remoteDir,
      this.config.remote?.manifestPath ?? "manifest.json",
      "remote.manifestPath",
    );
    const bookmarkletFile = this.config.output?.bookmarkletFile ?? "bookmarklet.txt";

    return {
      outDir,
      remoteDir,
      inlineDir,
      metaDir,
      remoteApp,
      remoteLoader,
      remoteManifest,
      remoteBookmarklet: resolveOutputFile(
        remoteDir,
        bookmarkletFile,
        "output.bookmarkletFile",
      ),
      inlineBookmarklet: resolveOutputFile(
        inlineDir,
        bookmarkletFile,
        "output.bookmarkletFile",
      ),
      installHtml: join(remoteDir, "install.html"),
      report: join(metaDir, "build-report.json"),
    };
  }

  private loaderDomId(): string {
    return `__bmkl_${this.config.name.replace(/[^a-zA-Z0-9_-]/g, "_")}__`;
  }

  private async artifact(
    kind: BookmarkletArtifact["kind"],
    path: string,
    includeText = false,
  ): Promise<BookmarkletArtifact> {
    const info = await stat(path);
    if (!info.isFile()) {
      throw new Error(`Artifact is not a file: ${path}`);
    }
    return {
      kind,
      fileName: basename(path),
      path,
      size: info.size,
      text: includeText ? await readFile(path, "utf8") : undefined,
    };
  }

  private async writeArtifact(
    kind: BookmarkletArtifact["kind"],
    path: string,
    text: string,
    includeText = false,
  ): Promise<BookmarkletArtifact> {
    const size = await writeTextFile(path, text);
    return {
      kind,
      fileName: basename(path),
      path,
      size,
      text: includeText ? text : undefined,
    };
  }
}

async function execFileAsync(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to run ${command}. Install OpenSSL or run bmkl dev without --https.`,
          { cause: error },
        ),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

const DEV_CERT_OPENSSL_CONFIG = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`;

type DevCorsOption = true | { origin: string };

function createDevCorsOption(target?: string): DevCorsOption {
  if (!target) {
    return true;
  }

  try {
    return { origin: new URL(target).origin };
  } catch {
    return true;
  }
}

function installDebugAuthGuard(
  server: ViteDevServer,
  token: string,
  launcherPath: string,
): void {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? "/", "http://bmkl.local");
    const debugLauncherRequested =
      url.pathname === launcherPath &&
      (url.searchParams.get("debug") === "1" ||
        url.searchParams.get("mode") === "debug");
    const protectedEndpoint =
      url.pathname === "/__bmkl/debug" ||
      url.pathname === "/__bmkl/debug/events" ||
      debugLauncherRequested;

    if (!protectedEndpoint) {
      next();
      return;
    }
    if (!hasValidDebugToken(url, token)) {
      res.statusCode = 404;
      res.end();
      return;
    }

    next();
  });
}

function installDevCorsMiddleware(
  server: ViteDevServer,
  rule: DevCorsOption,
): void {
  server.middlewares.use((req, res, next) => {
    const requestOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin;
    const allowed =
      rule === true || !requestOrigin || requestOrigin === rule.origin;

    if (allowed) {
      res.setHeader(
        "access-control-allow-origin",
        rule === true ? "*" : rule.origin,
      );
      res.setHeader("vary", "Origin");
    }

    if (req.method !== "OPTIONS") {
      next();
      return;
    }
    if (!allowed) {
      res.statusCode = 403;
      res.end();
      return;
    }

    const requestedHeaders = req.headers["access-control-request-headers"];
    res.statusCode = 204;
    res.setHeader(
      "access-control-allow-methods",
      "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "access-control-allow-headers",
      Array.isArray(requestedHeaders)
        ? requestedHeaders.join(", ")
        : requestedHeaders || "content-type",
    );
    res.end();
  });
}

async function readBuildReport(
  path: string,
): Promise<BookmarkletBuildReport | undefined> {
  try {
    const input: unknown = JSON.parse(await readFile(path, "utf8"));
    return isBookmarkletBuildReport(input) ? input : undefined;
  } catch {
    return undefined;
  }
}

async function readManifest(
  path: string,
): Promise<BookmarkletManifest | undefined> {
  try {
    return parseBmklRemoteManifestJson(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isBookmarkletBuildReport(
  input: unknown,
): input is BookmarkletBuildReport {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input.name === "string" &&
    (input.runtime === "inline" || input.runtime === "remote") &&
    ["dev", "canary", "latest", "pinned"].includes(String(input.channel)) &&
    typeof input.buildTime === "string" &&
    !Number.isNaN(Date.parse(input.buildTime)) &&
    Number.isSafeInteger(input.bookmarkletLength) &&
    Number(input.bookmarkletLength) >= 0 &&
    ["low", "medium", "high"].includes(String(input.cspRisk)) &&
    Array.isArray(input.artifacts) &&
    input.artifacts.every(isBuildReportArtifact) &&
    Array.isArray(input.warnings) &&
    input.warnings.every((warning) => typeof warning === "string")
  );
}

function isBuildReportArtifact(input: unknown): boolean {
  return (
    isRecord(input) &&
    [
      "app",
      "loader",
      "bookmarklet",
      "install-html",
      "manifest",
      "report",
    ].includes(String(input.kind)) &&
    typeof input.fileName === "string" &&
    input.fileName.length > 0 &&
    Number.isSafeInteger(input.size) &&
    Number(input.size) >= 0
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
