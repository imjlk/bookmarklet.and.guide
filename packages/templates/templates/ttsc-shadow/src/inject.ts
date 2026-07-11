import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
} from "@bmkl/runtime";
import { renderPanel } from "./renderPanel.js";
import styles from "./style.css?inline";

let destroyMountedPanel: (() => void) | undefined;

export function run(): void {
  destroy();
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  let controller: ReturnType<typeof renderPanel>;
  const destroyCurrentPanel = (): void => {
    controller?.disconnect();
    controller = undefined;
    try {
      ctx.destroy();
    } finally {
      if (destroyMountedPanel === destroyCurrentPanel) {
        destroyMountedPanel = undefined;
      }
      registration.release();
    }
  };
  destroyMountedPanel = destroyCurrentPanel;
  registration.activate();
  installBookmarkletStyles(ctx, styles);
  controller = renderPanel(ctx.root, destroyCurrentPanel);
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

function destroy(): void {
  if (destroyMountedPanel) {
    destroyMountedPanel();
  } else {
    registration.release();
  }
}

const registration = registerBookmarkletApi({
  destroy,
  globalName: "__BMKL_GLOBAL_NAME__",
  id: "__BMKL_PROJECT_ID__",
  run,
});
