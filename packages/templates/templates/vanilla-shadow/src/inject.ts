import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { copyText } from "./copyText.js";
import styles from "./style.css?inline";

export function run(): void {
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });
  installBookmarkletStyles(ctx, styles);

  ctx.root.innerHTML = `
    <section class="bmkl-panel">
      <header>
        <span>__BMKL_PROJECT_NAME__</span>
        <button type="button" data-action="close" aria-label="Close">×</button>
      </header>
      <p>Selection: <strong data-selection></strong></p>
      <div class="bmkl-actions">
        <button type="button" data-action="refresh">Refresh selection</button>
        <button type="button" data-action="copy">Copy selection / URL</button>
      </div>
      <p class="bmkl-status" data-status role="status" aria-live="polite">
        Copy the selection, or the page URL when nothing is selected.
      </p>
    </section>
  `;

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
    ?.addEventListener("click", ctx.destroy);

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

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
