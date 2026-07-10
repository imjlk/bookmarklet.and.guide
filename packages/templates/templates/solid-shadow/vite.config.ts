import { bmkl } from "@bmkl/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    solid(),
    ...bmkl({
      entry: "src/inject.tsx",
      name: "__BMKL_GLOBAL_NAME__",
      ttsc: false,
    }),
  ],
});
