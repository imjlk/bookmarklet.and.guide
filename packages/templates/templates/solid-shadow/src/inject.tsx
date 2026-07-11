import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
} from "@bmkl/runtime";
import { render } from "solid-js/web";
import { App } from "./App.jsx";
import styles from "./style.css?inline";

let dispose: (() => void) | undefined;
let destroyHost: (() => void) | undefined;

export function run(): void {
  destroy();
  try {
    const ctx = mountBookmarkletApp({
      id: "__BMKL_PROJECT_ID__",
      mode: "shadow",
    });
    destroyHost = ctx.destroy;
    registration.activate();
    installBookmarkletStyles(ctx, styles);

    dispose = render(() => <App destroy={destroy} />, ctx.root);
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    destroy();
    captureBookmarkletDebugError(error, "solid-mount");
    throw error;
  }
}

export function destroy(): void {
  const stop = dispose;
  dispose = undefined;
  try {
    stop?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-cleanup");
  }

  const destroyCurrentHost = destroyHost;
  destroyHost = undefined;
  try {
    destroyCurrentHost?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-host-cleanup");
  } finally {
    registration.release();
  }
}

const registration = registerBookmarkletApi({
  id: "__BMKL_PROJECT_ID__",
  globalName: "__BMKL_GLOBAL_NAME__",
  run,
  destroy,
});
