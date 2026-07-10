import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { renderPanel } from "./renderPanel.js";
import styles from "./style.css?inline";

export function run(): void {
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  installBookmarkletStyles(ctx, styles);
  renderPanel(ctx.root, ctx.destroy);
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
