import { createSignal, onCleanup, onMount } from "solid-js";
import { copyText } from "./copyText.js";
import {
  connectPanel,
  panelConfig,
  type PanelController,
} from "./panel.config.js";

export interface AppProps {
  destroy(): void;
}

export function App(props: AppProps) {
  let panel!: HTMLElement;
  let controller: PanelController | undefined;
  const [selection, setSelection] = createSignal(readSelection());
  const [status, setStatus] = createSignal(
    "Copy the selection, or the page URL when nothing is selected.",
  );

  onMount(() => {
    controller = connectPanel(panel, props.destroy);
  });
  onCleanup(() => controller?.disconnect());

  const refreshSelection = () => {
    const nextSelection = readSelection();
    setSelection(nextSelection);
    setStatus(
      nextSelection
        ? `Read ${nextSelection.length} selected characters.`
        : "No selection found; copy will use the page URL.",
    );
  };

  const copySelectionOrUrl = async () => {
    const nextSelection = readSelection();
    setSelection(nextSelection);
    const label = nextSelection ? "selection" : "page URL";
    setStatus(await copyText(nextSelection || location.href, label));
  };

  return (
    <section
      class="bmkl-panel"
      data-position={panelConfig.position}
      role="dialog"
      aria-labelledby="bmkl-panel-title"
      tabIndex={-1}
      ref={panel}
    >
      <header class="bmkl-header">
        <div class="bmkl-heading">
          <p class="bmkl-eyebrow">{panelConfig.eyebrow}</p>
          <h2 class="bmkl-title" id="bmkl-panel-title">
            {panelConfig.title}
          </h2>
        </div>
        <button
          class="bmkl-icon-button"
          type="button"
          aria-label="Close panel"
          onClick={() => {
            if (controller) {
              controller.close();
            } else {
              props.destroy();
            }
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <p class="bmkl-detail">
        <span class="bmkl-label">Selection</span>
        <strong class="bmkl-value">{selection() || "none"}</strong>
      </p>
      <div class="bmkl-actions">
        <button
          class="bmkl-button bmkl-button-secondary"
          type="button"
          onClick={refreshSelection}
        >
          Refresh selection
        </button>
        <button
          class="bmkl-button bmkl-button-primary"
          type="button"
          onClick={copySelectionOrUrl}
        >
          Copy selection / URL
        </button>
      </div>
      <p class="bmkl-status" role="status" aria-live="polite">
        {status()}
      </p>
    </section>
  );
}

function readSelection(): string {
  return String(globalThis.getSelection?.() ?? "").trim();
}
