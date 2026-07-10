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
import { ensureDir, joinUrl, resolveFrom, writeTextFile } from "./path.js";
import { runCommand } from "./process.js";
import { createBuildReport } from "./report.js";
import type {
  BookmarkletArtifact,
  BookmarkletBuildConfig,
  BookmarkletBuildResult,
  BookmarkletInspectResult,
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

  async build(): Promise<BookmarkletBuildResult> {
    const warnings: string[] = [];
    await this.prepareTtsc(warnings);
    await this.typecheck(warnings);

    const paths = this.paths();
    await rm(paths.outDir, { force: true, recursive: true });
    await ensureDir(paths.remoteDir);
    await ensureDir(paths.inlineDir);
    await ensureDir(paths.metaDir);

    await this.bundle();
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
    let devAddress = "";
    const addressFallback = () =>
      `${options.https ? "https" : "http"}://${options.host ?? "127.0.0.1"}:${options.port ?? 5173}/`;
    const currentAddress = () => devAddress || addressFallback();
    const launcherPath = "/__bmkl/launcher.js";
    const httpsOptions = options.https
      ? await this.createDevHttpsOptions()
      : undefined;

    const server = await createServer({
      root: this.config.root,
      configFile: this.config.vite?.configFile || undefined,
      plugins: [
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
              const debugConsoleUrl = new URL("__bmkl/debug", currentAddress()).toString();
              const debugRequested =
                url.searchParams.get("debug") === "1" ||
                url.searchParams.get("mode") === "debug";
              const source =
                debugRequested && options.debug
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
        ...(options.debug
          ? [
              {
                name: "bmkl:debug-console",
                configureServer: (viteServer: ViteDevServer) => {
                  installDebugConsoleMiddleware(viteServer, {
                    appName: this.config.name,
                  });
                },
              },
            ]
          : []),
      ],
      server: {
        cors: createDevCorsOption(options.target),
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
    const debugLauncherUrl = options.debug
      ? new URL(`${launcherPath.replace(/^\//, "")}?debug=1`, address).toString()
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
    const debugConsoleUrl = options.debug
      ? new URL("__bmkl/debug", address).toString()
      : undefined;
    const debugBookmarkletUrl =
      options.debug && debugConsoleUrl
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

    for (const [kind, path] of [
      ["app", paths.remoteApp],
      ["loader", paths.remoteLoader],
      ["bookmarklet", paths.remoteBookmarklet],
      ["bookmarklet", paths.inlineBookmarklet],
      ["install-html", paths.installHtml],
      ["manifest", paths.remoteManifest],
      ["report", paths.report],
    ] as const) {
      try {
        artifacts.push(await this.artifact(kind, path));
      } catch {
        warnings.push(`Missing artifact: ${relative(this.config.root, path)}`);
      }
    }

    try {
      bookmarkletLength = (await readFile(paths.remoteBookmarklet, "utf8")).trim()
        .length;
    } catch {
      warnings.push("Run bmkl build before inspecting bookmarklet length.");
    }

    const manifest = await readManifest(paths.remoteManifest);
    const report = await readJson(paths.report);

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

  private async prepareTtsc(warnings: string[]): Promise<void> {
    if (!this.config.ttsc?.enabled || !this.config.ttsc.prepare) {
      return;
    }

    try {
      await runCommand("ttsc", ["--version"], { cwd: this.config.root });
    } catch (error) {
      warnings.push(toMessage(error));
    }
  }

  private async typecheck(warnings: string[]): Promise<void> {
    if (!this.config.ttsc?.enabled || !this.config.ttsc.typecheck) {
      return;
    }

    const project = this.config.ttsc.project ?? "tsconfig.json";
    try {
      await runCommand("ttsc", ["--noEmit", "--project", project], {
        cwd: this.config.root,
      });
    } catch (error) {
      warnings.push("ttsc typecheck failed.");
      throw error;
    }
  }

  private async bundle(): Promise<void> {
    const paths = this.paths();
    const configFile = this.config.vite?.configFile ?? undefined;
    const entry = resolveFrom(this.config.root, this.config.entry);

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
            build: {
              emptyOutDir: false,
              lib: {
                entry,
                name: this.config.globalName,
                formats: ["iife"],
                fileName: () => basename(paths.remoteApp),
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
    const outDir = resolveFrom(this.config.root, this.config.outDir);
    const remoteDir = join(outDir, "remote");
    const inlineDir = join(outDir, "inline");
    const metaDir = join(outDir, "meta");
    const remoteApp = join(
      remoteDir,
      this.config.remote?.appPath ?? "app.iife.js",
    );
    const remoteLoader = join(
      remoteDir,
      this.config.remote?.loaderPath ?? "loader.js",
    );
    const remoteManifest = join(
      remoteDir,
      this.config.remote?.manifestPath ?? "manifest.json",
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
      remoteBookmarklet: join(remoteDir, bookmarkletFile),
      inlineBookmarklet: join(inlineDir, bookmarkletFile),
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

function createDevCorsOption(target?: string): true | { origin: string } {
  if (!target) {
    return true;
  }

  try {
    return { origin: new URL(target).origin };
  } catch {
    return true;
  }
}

async function readJson(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readManifest(path: string): Promise<any | undefined> {
  try {
    return parseBmklRemoteManifestJson(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
