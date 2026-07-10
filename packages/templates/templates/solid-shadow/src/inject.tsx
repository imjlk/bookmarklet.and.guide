import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { render } from "solid-js/web";
import { App } from "./App.jsx";
import styles from "./style.css?inline";

let dispose: (() => void) | undefined;

export function run(): void {
  dispose?.();
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  installBookmarkletStyles(ctx, styles);

  dispose = render(() => <App destroy={ctx.destroy} />, ctx.root);
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
