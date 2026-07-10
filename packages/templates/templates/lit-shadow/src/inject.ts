import {
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import { LitElement, css, html, unsafeCSS } from "lit";
import { copyText } from "./copyText.js";
import styles from "./style.css?inline";

class BmklLitPanel extends LitElement {
  static properties = {
    selection: { state: true },
    status: { state: true },
  };

  static styles = css`${unsafeCSS(styles)}`;

  destroyApp: () => void = () => {};
  declare private selection: string;
  declare private status: string;

  constructor() {
    super();
    this.selection = readSelection();
    this.status = "Copy the selection, or the page URL when nothing is selected.";
  }

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
          <button type="button" @click=${this.copySelectionOrUrl}>
            Copy selection / URL
          </button>
        </div>
        <p class="bmkl-status" role="status" aria-live="polite">${this.status}</p>
      </section>
    `;
  }

  private refreshSelection = (): void => {
    this.selection = readSelection();
    this.status = this.selection
      ? `Read ${this.selection.length} selected characters.`
      : "No selection found; copy will use the page URL.";
  };

  private copySelectionOrUrl = async (): Promise<void> => {
    this.selection = readSelection();
    const label = this.selection ? "selection" : "page URL";
    this.status = await copyText(this.selection || location.href, label);
  };
}

const panelTagName = createPanelTagName();
customElements.define(panelTagName, BmklLitPanel);

export function run(): void {
  const ctx = mountBookmarkletApp({
    id: "__BMKL_PROJECT_ID__",
    mode: "shadow",
  });

  const panel = document.createElement(panelTagName) as BmklLitPanel;
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

function createPanelTagName(): string {
  const baseName = "__BMKL_PROJECT_ID__"
    .toLowerCase()
    .replace(/_+/g, "-")
    .replace(/^-+|-+$/g, "");
  const versionKey = Symbol.for(`${baseName}:lit-panel-version`);
  const versions = globalThis as unknown as Record<PropertyKey, unknown>;
  const previousVersion = versions[versionKey];
  let version = typeof previousVersion === "number" ? previousVersion + 1 : 1;
  while (customElements.get(`${baseName}-panel-v${version}`)) {
    version += 1;
  }
  versions[versionKey] = version;
  return `${baseName}-panel-v${version}`;
}
