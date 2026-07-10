import { bmkl } from "@bmkl/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    ...bmkl({
      entry: "src/inject.tsx",
      name: "__BMKL_GLOBAL_NAME__",
    }),
  ],
});
