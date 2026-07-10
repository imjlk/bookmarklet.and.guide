# `@bmkl/core`

The BMKL build and development API. It provides `BookmarkBuilder`, typed config
resolution, bookmarklet encoders and loaders, artifact reports, install pages,
debug middleware, and companion-extension generation.

```ts
import {
  BookmarkBuilder,
  defineBookmarkletConfig,
  resolveConfig,
} from "@bmkl/core";

const config = resolveConfig(
  defineBookmarkletConfig({
    name: "my-bookmarklet",
    entry: "src/inject.ts",
    runtime: "inline",
  }),
);

const result = await new BookmarkBuilder(config).build();
```

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
