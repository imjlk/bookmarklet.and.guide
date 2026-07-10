import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App.js";
import styles from "./style.css?inline";

let root: Root | undefined;

export function run(): void {
  root?.unmount();
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  installBookmarkletStyles(ctx, styles);

  root = createRoot(ctx.root);
  root.render(<App destroy={ctx.destroy} />);
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
