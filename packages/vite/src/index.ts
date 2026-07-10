import type { TtscUnpluginOptions } from "@ttsc/unplugin";
import * as ttscModule from "@ttsc/unplugin/vite";
import type { Plugin, UserConfig } from "vite";

const ttsc = (ttscModule as unknown as {
  default: (options?: TtscUnpluginOptions) => Plugin;
}).default;

export interface BmklVitePluginOptions {
  entry?: string;
  name?: string;
  outDir?: string;
  appFileName?: string;
  ttsc?: false | TtscUnpluginOptions;
}

export function bmkl(options: BmklVitePluginOptions = {}): Plugin[] {
  const entry = options.entry ?? "src/inject.ts";
  const name = options.name ?? "BookmarkletApp";
  const outDir = options.outDir ?? "dist/bookmarklet/remote";
  const appFileName = options.appFileName ?? "app.iife.js";
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
          moduleUrl = new URL(entry, "http://localhost/").pathname;
        } catch {
          res.statusCode = 400;
          res.end("Invalid BMKL entry path.");
          return;
        }

        const moduleUrlPrefix = JSON.stringify(`${moduleUrl}?t=`);
        const source = `javascript:${encodeURIComponent(
          `(()=>{const d=document,id="__bmkl_dev__";d.getElementById(id)?.remove();const s=d.createElement("script");s.id=id;s.type="module";s.src=${moduleUrlPrefix}+Date.now();d.documentElement.appendChild(s)})()`,
        )}`;

        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(req.method === "HEAD" ? undefined : `${source}\n`);
      });
    },
  });

  return plugins;
}

export default bmkl;
