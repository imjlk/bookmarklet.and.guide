import { devAssert } from "./devAssert.js";
import {
  readPageSnapshot,
  summarizeSnapshot,
  type PageSnapshot,
} from "./pageSnapshot.js";

export function renderPanel(root: HTMLElement, destroy: () => void): void {
  devAssert.present(root, "BMKL root");

  const snapshot = readPageSnapshot();
  console.debug("[bmkl] page snapshot", snapshot);
  debugger;

  root.innerHTML = panelMarkup(snapshot);
  root
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", destroy);
  root
    .querySelector('[data-action="mark"]')
    ?.addEventListener("click", () => {
      document.body.dataset.bmklTtscTemplate = "active";
    });
}

function panelMarkup(snapshot: PageSnapshot): string {
  return `
    <section class="bmkl-panel">
      <header>
        <span>__BMKL_PROJECT_NAME__</span>
        <button type="button" data-action="close" aria-label="Close">×</button>
      </header>
      <dl>
        <div>
          <dt>Summary</dt>
          <dd>${escapeHtml(summarizeSnapshot(snapshot))}</dd>
        </div>
        <div>
          <dt>Selection</dt>
          <dd>${escapeHtml(snapshot.selectedText || "none")}</dd>
        </div>
        <div>
          <dt>URL</dt>
          <dd>${escapeHtml(snapshot.href)}</dd>
        </div>
      </dl>
      <button type="button" data-action="mark">Mark page</button>
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
      case "\"":
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
