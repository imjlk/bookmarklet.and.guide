import { copyText } from "@app/copyText";
import { devAssert } from "@app/devAssert";
import { readPageSnapshot, type PageSnapshot } from "@app/pageSnapshot";
import { connectPanel, panelConfig, type PanelController } from "@app/panel.config";
import { formatSnapshotReport, summarizeSnapshot } from "@app/snapshotReport";

export function renderPanel(
  root: HTMLElement,
  destroy: () => void,
): PanelController | undefined {
  devAssert.present(root, "BMKL root");

  const snapshot = readPageSnapshot();
  if (import.meta.env.DEV) {
    console.debug("[bmkl] page snapshot", snapshot);
  }

  root.innerHTML = panelMarkup(snapshot);
  const panel = root.querySelector<HTMLElement>(".bmkl-panel");
  if (!panel) {
    destroy();
    return undefined;
  }
  const controller = connectPanel(panel, destroy);
  root
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", controller.close);
  root
    .querySelector('[data-action="copy"]')
    ?.addEventListener("click", () => {
      void copySnapshot(root, snapshot);
    });
  return controller;
}

async function copySnapshot(root: HTMLElement, snapshot: PageSnapshot): Promise<void> {
  const message = await copyText(formatSnapshotReport(snapshot), "page snapshot");
  const status = root.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.textContent = message;
  }
}

function panelMarkup(snapshot: PageSnapshot): string {
  return `
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
      <dl>
        <div>
          <dt>Summary</dt>
          <dd class="bmkl-value">${escapeHtml(summarizeSnapshot(snapshot))}</dd>
        </div>
        <div>
          <dt>Selection</dt>
          <dd class="bmkl-value">${escapeHtml(snapshot.selectedText || "none")}</dd>
        </div>
        <div>
          <dt>URL</dt>
          <dd class="bmkl-value">${escapeHtml(snapshot.href)}</dd>
        </div>
      </dl>
      <button class="bmkl-button bmkl-button-primary" type="button" data-action="copy">
        Copy snapshot
      </button>
      <p class="bmkl-status" data-status role="status" aria-live="polite">
        Copy this typed page snapshot to verify the starter action.
      </p>
    </section>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
