import { bmkl } from "@bmkl/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: bmkl({
    entry: "src/inject.ts",
    name: "__BMKL_GLOBAL_NAME__",
  }),
});
