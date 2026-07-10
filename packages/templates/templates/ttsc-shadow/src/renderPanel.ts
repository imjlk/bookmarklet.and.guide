import { copyText } from "./copyText.js";
import { devAssert } from "./devAssert.js";
import {
  readPageSnapshot,
  summarizeSnapshot,
  type PageSnapshot,
} from "./pageSnapshot.js";

export function renderPanel(root: HTMLElement, destroy: () => void): void {
  devAssert.present(root, "BMKL root");

  const snapshot = readPageSnapshot();
  if (import.meta.env.DEV) {
    console.debug("[bmkl] page snapshot", snapshot);
  }

  root.innerHTML = panelMarkup(snapshot);
  root
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", destroy);
  root
    .querySelector('[data-action="copy"]')
    ?.addEventListener("click", () => {
      void copySnapshot(root, snapshot);
    });
}

async function copySnapshot(root: HTMLElement, snapshot: PageSnapshot): Promise<void> {
  const text = [
    snapshot.title || "Untitled page",
    snapshot.href,
    `${snapshot.wordCount} words`,
    snapshot.selectedText ? `Selection: ${snapshot.selectedText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const message = await copyText(text, "page snapshot");
  const status = root.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.textContent = message;
  }
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
      <button type="button" data-action="copy">Copy snapshot</button>
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
      case "\"":
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
