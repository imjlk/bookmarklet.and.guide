import type { TtscUnpluginOptions } from "@ttsc/unplugin";
import * as ttscModule from "@ttsc/unplugin/vite";
import type { Plugin, UserConfig, ViteDevServer } from "vite";

const ttsc = (ttscModule as unknown as {
  default: (options?: TtscUnpluginOptions) => Plugin;
}).default;

export interface BmklVitePluginOptions {
  entry?: string;
  name?: string;
  outDir?: string;
  appFileName?: string;
  devOrigin?: string;
  publicOrigin?: string;
  ttsc?: false | TtscUnpluginOptions;
}

export function bmkl(options: BmklVitePluginOptions = {}): Plugin[] {
  const entry = options.entry ?? "src/inject.ts";
  const name = options.name ?? "BookmarkletApp";
  const outDir = options.outDir ?? "dist/bookmarklet/remote";
  const appFileName = options.appFileName ?? "app.iife.js";
  const devOrigin = options.devOrigin
    ? parseHttpUrl("devOrigin", options.devOrigin).origin
    : undefined;
  const publicOrigin = options.publicOrigin
    ? parseHttpUrl("publicOrigin", options.publicOrigin).origin
    : undefined;
  const plugins: Plugin[] = [];

  if (options.ttsc && process.env.BMKL_COMPANION !== "1") {
    plugins.push(ttsc(options.ttsc));
  }

  plugins.push({
    name: "bmkl:vite",
    config(): UserConfig {
      if (process.env.BMKL_BUILDER === "1") {
        return {};
      }

      return {
        build: {
          emptyOutDir: false,
          lib: {
            entry,
            name,
            formats: ["iife"],
            fileName: () => appFileName,
          },
          outDir,
        },
        server: {
          cors: devOrigin ? { origin: devOrigin } : true,
        },
      };
    },
    configureServer(server) {
      server.middlewares.use("/__bmkl/dev-bookmarklet", (req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }

        let moduleUrl: string;
        try {
          const serverUrl = resolveDevServerUrl(
            server,
            req.headers.host,
            publicOrigin,
          );
          moduleUrl = new URL(entry, serverUrl).toString();
        } catch {
          res.statusCode = 400;
          res.end("Invalid BMKL entry path.");
          return;
        }

        const serializedModuleUrl = JSON.stringify(moduleUrl);
        const serializedGlobalName = JSON.stringify(name);
        const source = `javascript:${encodeURIComponent(
          `(()=>{const d=document,id="__bmkl_dev__",u=${serializedModuleUrl};d.getElementById(id)?.remove();const s=d.createElement("script");s.id=id;s.type="module";s.src=u+(u.includes("?")?"&":"?")+"t="+Date.now();s.onload=()=>{const a=globalThis[${serializedGlobalName}];if(a&&typeof a.run==="function")a.run();else alert("BMKL dev module loaded without a run() API.")};s.onerror=()=>alert("BMKL dev module failed to load. Is the Vite server still running?");d.documentElement.appendChild(s)})()`,
        )}`;

        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(req.method === "HEAD" ? undefined : `${source}\n`);
      });
    },
  });

  return plugins;
}

function parseHttpUrl(option: string, value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${url.protocol}`);
    }
    return url;
  } catch (error) {
    throw new Error(
      `Invalid ${option} URL: ${value}. Expected an absolute HTTP(S) URL.`,
      { cause: error },
    );
  }
}

function resolveDevServerUrl(
  server: ViteDevServer,
  hostHeader: string | undefined,
  publicOrigin: string | undefined,
): string {
  if (publicOrigin) {
    return new URL(publicOrigin).toString();
  }

  const protocol = server.config.server.https ? "https" : "http";
  const requestUrl = new URL(
    `${protocol}://${hostHeader?.trim() || "127.0.0.1:5173"}/`,
  );
  const resolvedUrls = [
    ...(server.resolvedUrls?.local ?? []),
    ...(server.resolvedUrls?.network ?? []),
  ];
  return (
    resolvedUrls.find((candidate) => new URL(candidate).host === requestUrl.host) ??
    resolvedUrls[0] ??
    resolveConfiguredServerUrl(server, protocol)
  );
}

function resolveConfiguredServerUrl(
  server: ViteDevServer,
  protocol: "http" | "https",
): string {
  const configuredHost = server.config.server.host;
  const host =
    typeof configuredHost === "string" &&
    configuredHost !== "0.0.0.0" &&
    configuredHost !== "::"
      ? configuredHost
      : "127.0.0.1";
  const address = server.httpServer?.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : (server.config.server.port ?? 5173);
  const authority =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${protocol}://${authority}:${port}/`;
}

export default bmkl;
