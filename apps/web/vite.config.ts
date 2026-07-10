import solid from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [solid()],
  build: {
    target: "es2022",
  },
});
