# `@bmkl/vite`

Vite plugin defaults for building a BMKL entry as an IIFE bundle, with an
optional ttsc transform bridge and a development-bookmarklet endpoint.

```ts
import { defineConfig } from "vite";
import { bmkl } from "@bmkl/vite";

export default defineConfig({
  plugins: bmkl({
    entry: "src/inject.ts",
    name: "MyBookmarklet",
    devOrigin: "https://target.example",
    // Set this when a proxy or LAN hostname should appear in the dev bookmarklet.
    publicOrigin: "http://192.168.1.20:5173",
  }),
});
```

`devOrigin` limits the development server's CORS response to the target page
origin. Without it, development CORS is open while Vite remains bound to its
configured host. Generated projects normally use `bmkl dev --target <url>`,
which applies the same target-origin policy through the CLI.

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
