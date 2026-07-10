import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { render } from "solid-js/web";
import { App } from "./App.jsx";
import styles from "./style.css?inline";

let dispose: (() => void) | undefined;
let destroyHost: (() => void) | undefined;

export function run(): void {
  cleanup();
  try {
    const ctx = mountBookmarkletApp({
      id: "__BMKL_PROJECT_ID__",
      mode: "shadow",
    });
    destroyHost = ctx.destroy;
    installBookmarkletStyles(ctx, styles);

    dispose = render(() => <App destroy={cleanup} />, ctx.root);
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    cleanup();
    captureBookmarkletDebugError(error, "solid-mount");
    throw error;
  }
}

function cleanup(): void {
  const stop = dispose;
  dispose = undefined;
  try {
    stop?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-cleanup");
  }

  const destroy = destroyHost;
  destroyHost = undefined;
  try {
    destroy?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-host-cleanup");
  }
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
