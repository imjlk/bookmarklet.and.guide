import { useState } from "react";

export interface AppProps {
  destroy(): void;
}

export function App(props: AppProps) {
  const [selection, setSelection] = useState(() => readSelection());

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
      <button type="button" onClick={() => setSelection(readSelection())}>
        Refresh selection
      </button>
    </section>
  );
}

function readSelection(): string {
  return String(globalThis.getSelection?.() ?? "").trim();
}
