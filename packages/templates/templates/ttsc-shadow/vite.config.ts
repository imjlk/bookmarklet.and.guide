import { bmkl } from "@bmkl/vite";
import { defineConfig } from "vite";

const lintConfig = new URL("./lint.config.json", import.meta.url).pathname;
const stripConfig = new URL("./strip.config.json", import.meta.url).pathname;

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
      "@app": new URL("./src", import.meta.url).pathname,
    },
  },
});
