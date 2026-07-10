import {
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { LitElement, css, html, unsafeCSS } from "lit";
import styles from "./style.css?inline";

class BmklLitPanel extends LitElement {
  static properties = {
    selection: { state: true },
  };

  static styles = css`${unsafeCSS(styles)}`;

  destroyApp: () => void = () => {};
  private selection = readSelection();

  render() {
    return html`
      <section class="bmkl-panel">
        <header>
          <span>__BMKL_PROJECT_NAME__</span>
          <button type="button" aria-label="Close" @click=${this.destroyApp}>
            ×
          </button>
        </header>
        <p>
          Selection: <strong>${this.selection || "none"}</strong>
        </p>
        <div class="bmkl-actions">
          <button type="button" @click=${this.refreshSelection}>Refresh</button>
          <button type="button" @click=${this.markPage}>Mark page</button>
        </div>
      </section>
    `;
  }

  private refreshSelection = (): void => {
    this.selection = readSelection();
  };

  private markPage = (): void => {
    document.body.toggleAttribute("data-bmkl-active");
  };
}

export function run(): void {
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });

  const tagName = "__BMKL_PROJECT_ID__"
    .toLowerCase()
    .replace(/_+/g, "-")
    .replace(/^-+|-+$/g, "")
    .concat("-panel");
  if (!customElements.get(tagName)) {
    customElements.define(tagName, BmklLitPanel);
  }

  const panel = document.createElement(tagName) as BmklLitPanel;
  panel.destroyApp = ctx.destroy;
  ctx.root.replaceChildren(panel);
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});

function readSelection(): string {
  return String(globalThis.getSelection?.() ?? "").trim();
}
