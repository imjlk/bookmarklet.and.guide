import { fileURLToPath } from "node:url";

import { bmkl } from "@bmkl/vite";
import { defineConfig } from "vite";

const lintConfig = fileURLToPath(new URL("./lint.config.ts", import.meta.url));
const stripConfig = fileURLToPath(new URL("./strip.config.js", import.meta.url));

export default defineConfig({
  plugins: bmkl({
    entry: "src/inject.ts",
    name: "__BMKL_GLOBAL_NAME__",
    ttsc: {
      plugins: [
        { transform: "@ttsc/lint", configFile: lintConfig },
        { transform: "@ttsc/strip", configFile: stripConfig },
        { transform: "@ttsc/paths" },
      ],
    },
  }),
  resolve: {
    alias: [
      {
        find: /^@app\/(.+)$/,
        replacement: fileURLToPath(new URL("./src/$1.ts", import.meta.url)),
      },
    ],
  },
});
