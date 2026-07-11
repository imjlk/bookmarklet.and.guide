import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
} from "@bmkl/runtime";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App.js";
import styles from "./style.css?inline";

let root: Root | undefined;
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

    root = createRoot(ctx.root, {
      onCaughtError: (error) => {
        captureBookmarkletDebugError(error, "react-render");
      },
      onUncaughtError: (error) => {
        captureBookmarkletDebugError(error, "react-render");
      },
    });
    root.render(<App destroy={destroy} />);
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    destroy();
    captureBookmarkletDebugError(error, "react-mount");
    throw error;
  }
}

export function destroy(): void {
  const currentRoot = root;
  root = undefined;
  try {
    currentRoot?.unmount();
  } catch (error) {
    captureBookmarkletDebugError(error, "react-cleanup");
  }

  const destroyCurrentHost = destroyHost;
  destroyHost = undefined;
  try {
    destroyCurrentHost?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "react-host-cleanup");
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
