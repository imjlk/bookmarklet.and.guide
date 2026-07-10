import {
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
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
      <button type="button" data-action="highlight">Highlight selection</button>
    </section>
  `;

  const selectedText = String(globalThis.getSelection?.() ?? "").trim() || "none";
  const selection = ctx.root.querySelector<HTMLElement>("[data-selection]");
  if (selection) {
    selection.textContent = selectedText;
  }

  ctx.root
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", ctx.destroy);

  ctx.root
    .querySelector('[data-action="highlight"]')
    ?.addEventListener("click", () => {
      document.body.dataset.bmklLastAction = "highlight";
    });

  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
