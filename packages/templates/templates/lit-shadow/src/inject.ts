import {
  captureBookmarkletDebugError,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
} from "@bmkl/runtime";
import { LitElement, css, html, unsafeCSS } from "lit";
import { copyText } from "./copyText.js";
import {
  connectPanel,
  panelConfig,
  type PanelController,
} from "./panel.config.js";
import styles from "./style.css?inline";

class BmklLitPanel extends LitElement {
  static properties = {
    selection: { state: true },
    status: { state: true },
  };

  static styles = css`${unsafeCSS(styles)}`;

  destroyApp: () => void = () => {};
  private controller?: PanelController;
  declare private selection: string;
  declare private status: string;

  constructor() {
    super();
    this.selection = readSelection();
    this.status = "Copy the selection, or the page URL when nothing is selected.";
  }

  protected firstUpdated(): void {
    const panel = this.renderRoot.querySelector<HTMLElement>(".bmkl-panel");
    if (panel) {
      this.controller = connectPanel(panel, this.destroyApp);
    }
  }

  disconnectedCallback(): void {
    this.controller?.disconnect();
    this.controller = undefined;
    super.disconnectedCallback();
  }

  render() {
    return html`
      <section
        class="bmkl-panel"
        data-position=${panelConfig.position}
        role="dialog"
        aria-labelledby="bmkl-panel-title"
        tabindex="-1"
      >
        <header class="bmkl-header">
          <div class="bmkl-heading">
            <p class="bmkl-eyebrow">${panelConfig.eyebrow}</p>
            <h2 class="bmkl-title" id="bmkl-panel-title">
              ${panelConfig.title}
            </h2>
          </div>
          <button
            class="bmkl-icon-button"
            type="button"
            aria-label="Close panel"
            @click=${this.closePanel}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <p class="bmkl-detail">
          <span class="bmkl-label">Selection</span>
          <strong class="bmkl-value">${this.selection || "none"}</strong>
        </p>
        <div class="bmkl-actions">
          <button
            class="bmkl-button bmkl-button-secondary"
            type="button"
            @click=${this.refreshSelection}
          >
            Refresh selection
          </button>
          <button
            class="bmkl-button bmkl-button-primary"
            type="button"
            @click=${this.copySelectionOrUrl}
          >
            Copy selection / URL
          </button>
        </div>
        <p class="bmkl-status" role="status" aria-live="polite">${this.status}</p>
      </section>
    `;
  }

  private closePanel = (): void => {
    if (this.controller) {
      this.controller.close();
    } else {
      this.destroyApp();
    }
  };

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

let destroyHost: (() => void) | undefined;

export function run(): void {
  destroy();
  try {
    const ctx = mountBookmarkletApp({
      id: "__BMKL_PROJECT_ID__",
      mode: "shadow",
    });
    destroyHost = ctx.destroy;
    registration.activate();

    const panel = document.createElement(panelTagName) as BmklLitPanel;
    panel.destroyApp = destroy;
    ctx.root.replaceChildren(panel);
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    destroy();
    captureBookmarkletDebugError(error, "lit-mount");
    throw error;
  }
}

export function destroy(): void {
  const destroyCurrentHost = destroyHost;
  destroyHost = undefined;
  try {
    destroyCurrentHost?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "lit-host-cleanup");
  } finally {
    registration.release();
  }
}

const registration = registerBookmarkletApi({
  id: "__BMKL_PROJECT_ID__",
  globalName: "__BMKL_GLOBAL_NAME__",
  run,
  destroy,
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
