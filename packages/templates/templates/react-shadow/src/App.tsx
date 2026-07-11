import { useEffect, useRef, useState } from "react";
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
  const panelRef = useRef<HTMLElement>(null);
  const controllerRef = useRef<PanelController | undefined>(undefined);
  const [selection, setSelection] = useState(() => readSelection());
  const [status, setStatus] = useState(
    "Copy the selection, or the page URL when nothing is selected.",
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const controller = connectPanel(panel, props.destroy);
    controllerRef.current = controller;
    return () => {
      controller.disconnect();
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
      }
    };
  }, [props.destroy]);

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
      className="bmkl-panel"
      data-position={panelConfig.position}
      role="dialog"
      aria-labelledby="bmkl-panel-title"
      tabIndex={-1}
      ref={panelRef}
    >
      <header className="bmkl-header">
        <div className="bmkl-heading">
          <p className="bmkl-eyebrow">{panelConfig.eyebrow}</p>
          <h2 className="bmkl-title" id="bmkl-panel-title">
            {panelConfig.title}
          </h2>
        </div>
        <button
          className="bmkl-icon-button"
          type="button"
          aria-label="Close panel"
          onClick={() => {
            const controller = controllerRef.current;
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
      <p className="bmkl-detail">
        <span className="bmkl-label">Selection</span>
        <strong className="bmkl-value">{selection || "none"}</strong>
      </p>
      <div className="bmkl-actions">
        <button
          className="bmkl-button bmkl-button-secondary"
          type="button"
          onClick={refreshSelection}
        >
          Refresh selection
        </button>
        <button
          className="bmkl-button bmkl-button-primary"
          type="button"
          onClick={copySelectionOrUrl}
        >
          Copy selection / URL
        </button>
      </div>
      <p className="bmkl-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

function readSelection(): string {
  return String(globalThis.getSelection?.() ?? "").trim();
}
