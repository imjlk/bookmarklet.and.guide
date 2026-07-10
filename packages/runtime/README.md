# `@bmkl/runtime`

Browser runtime helpers for isolated Shadow DOM and iframe mounts, action
registries, origin-checked `postMessage` bridges, and bookmarklet debug events.

```ts
import { installBookmarkletStyles, mountBookmarkletApp } from "@bmkl/runtime";

const context = mountBookmarkletApp({ id: "my-bookmarklet" });
installBookmarkletStyles(context, ":host { color: CanvasText; }");
context.root.textContent = "BMKL is running";
```

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
