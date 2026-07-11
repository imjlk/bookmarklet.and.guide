import { fileURLToPath } from "node:url";

import { bmkl } from "@bmkl/vite";
import { defineConfig } from "vite";

const lintConfig = fileURLToPath(new URL("./lint.config.json", import.meta.url));
const stripConfig = fileURLToPath(new URL("./strip.config.json", import.meta.url));

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
    alias: {
      "@app": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
