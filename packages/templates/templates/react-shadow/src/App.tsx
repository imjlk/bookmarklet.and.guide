import { useState } from "react";
import { copyText } from "./copyText.js";

export interface AppProps {
  destroy(): void;
}

export function App(props: AppProps) {
  const [selection, setSelection] = useState(() => readSelection());
  const [status, setStatus] = useState(
    "Copy the selection, or the page URL when nothing is selected.",
  );

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
    <section className="bmkl-panel">
      <header>
        <span>__BMKL_PROJECT_NAME__</span>
        <button type="button" aria-label="Close" onClick={props.destroy}>
          ×
        </button>
      </header>
      <p>
        Selection: <strong>{selection || "none"}</strong>
      </p>
      <div className="bmkl-actions">
        <button type="button" onClick={refreshSelection}>
          Refresh selection
        </button>
        <button type="button" onClick={copySelectionOrUrl}>
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
