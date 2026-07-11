import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
} from "@bmkl/runtime";
import { copyText } from "./copyText.js";
import {
  connectPanel,
  panelConfig,
  type PanelController,
} from "./panel.config.js";
import styles from "./style.css?inline";

let destroyMountedPanel: (() => void) | undefined;

export function run(): void {
  destroy();
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  let controller: PanelController | undefined;
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

  ctx.root.innerHTML = `
    <section
      class="bmkl-panel"
      data-position="${panelConfig.position}"
      role="dialog"
      aria-labelledby="bmkl-panel-title"
      tabindex="-1"
    >
      <header class="bmkl-header">
        <div class="bmkl-heading">
          <p class="bmkl-eyebrow">${escapeHtml(panelConfig.eyebrow)}</p>
          <h2 class="bmkl-title" id="bmkl-panel-title">${escapeHtml(panelConfig.title)}</h2>
        </div>
        <button class="bmkl-icon-button" type="button" data-action="close" aria-label="Close panel">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <p class="bmkl-detail">
        <span class="bmkl-label">Selection</span>
        <strong class="bmkl-value" data-selection></strong>
      </p>
      <div class="bmkl-actions">
        <button class="bmkl-button bmkl-button-secondary" type="button" data-action="refresh">
          Refresh selection
        </button>
        <button class="bmkl-button bmkl-button-primary" type="button" data-action="copy">
          Copy selection / URL
        </button>
      </div>
      <p class="bmkl-status" data-status role="status" aria-live="polite">
        Copy the selection, or the page URL when nothing is selected.
      </p>
    </section>
  `;

  const panel = ctx.root.querySelector<HTMLElement>(".bmkl-panel");
  if (!panel) {
    destroyCurrentPanel();
    return;
  }
  controller = connectPanel(panel, destroyCurrentPanel);
  const selection = ctx.root.querySelector<HTMLElement>("[data-selection]");
  const status = ctx.root.querySelector<HTMLElement>("[data-status]");
  const refreshSelection = (): string => {
    const selectedText = String(globalThis.getSelection?.() ?? "").trim();
    if (selection) {
      selection.textContent = selectedText || "none";
    }
    return selectedText;
  };
  refreshSelection();

  ctx.root
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", controller.close);

  ctx.root
    .querySelector('[data-action="refresh"]')
    ?.addEventListener("click", () => {
      const selectedText = refreshSelection();
      if (status) {
        status.textContent = selectedText
          ? `Read ${selectedText.length} selected characters.`
          : "No selection found; copy will use the page URL.";
      }
    });

  ctx.root
    .querySelector('[data-action="copy"]')
    ?.addEventListener("click", async () => {
      const selectedText = refreshSelection();
      const label = selectedText ? "selection" : "page URL";
      const message = await copyText(selectedText || location.href, label);
      if (status) {
        status.textContent = message;
      }
    });

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
