import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App.js";
import styles from "./style.css?inline";

let root: Root | undefined;
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

    root = createRoot(ctx.root, {
      onCaughtError: (error) => {
        captureBookmarkletDebugError(error, "react-render");
      },
      onUncaughtError: (error) => {
        captureBookmarkletDebugError(error, "react-render");
      },
    });
    root.render(<App destroy={cleanup} />);
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    cleanup();
    captureBookmarkletDebugError(error, "react-mount");
    throw error;
  }
}

function cleanup(): void {
  const currentRoot = root;
  root = undefined;
  try {
    currentRoot?.unmount();
  } catch (error) {
    captureBookmarkletDebugError(error, "react-cleanup");
  }

  const destroy = destroyHost;
  destroyHost = undefined;
  try {
    destroy?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "react-host-cleanup");
  }
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
