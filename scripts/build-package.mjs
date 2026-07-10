import { chmod, rm } from "node:fs/promises";
import { build } from "esbuild";

const platform = process.argv[2] ?? "node";
const shebang = process.argv.includes("--shebang");

await rm("dist", { force: true, recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform,
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,
  packages: "external",
  banner: shebang ? { js: "#!/usr/bin/env node" } : undefined,
  tsconfigRaw: {
    compilerOptions: {
      paths: {},
    },
  },
});

if (shebang) {
  await chmod("dist/index.js", 0o755);
}
