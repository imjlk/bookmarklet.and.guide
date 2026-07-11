# `@bmkl/runtime`

Browser runtime helpers for isolated Shadow DOM and iframe mounts, action
registries, origin-checked `postMessage` bridges, and bookmarklet debug events.

```ts
import { installBookmarkletStyles, mountBookmarkletApp } from "@bmkl/runtime";

const context = mountBookmarkletApp({ id: "my-bookmarklet" });
installBookmarkletStyles(context, ":host { color: CanvasText; }");
context.root.textContent = "BMKL is running";
```

Cache-busted development modules can hand off one project API without leaking
the previous mount. Register the module API once, call `activate()` when a run
becomes current, and call `release()` after teardown. Releasing ownership leaves
the global `run()` API callable so the same loaded module can run again.

```ts
import { mountBookmarkletApp, registerBookmarkletApi } from "@bmkl/runtime";

let destroyCurrent: (() => void) | undefined;

function run() {
  destroy();
  const context = mountBookmarkletApp({ id: "my-bookmarklet" });
  destroyCurrent = context.destroy;
  registration.activate();
  context.root.textContent = "BMKL is running";
}

function destroy() {
  destroyCurrent?.();
  destroyCurrent = undefined;
  registration.release();
}

const registration = registerBookmarkletApi({
  id: "my-bookmarklet",
  globalName: "MyBookmarklet",
  run,
  destroy,
});
```

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
