import { createSignal } from "solid-js";

export interface AppProps {
  destroy(): void;
}

export function App(props: AppProps) {
  const [selection, setSelection] = createSignal(readSelection());

  return (
    <section class="bmkl-panel">
      <header>
        <span>__BMKL_PROJECT_NAME__</span>
        <button type="button" aria-label="Close" onClick={props.destroy}>
          ×
        </button>
      </header>
      <p>
        Selection: <strong>{selection() || "none"}</strong>
      </p>
      <div class="bmkl-actions">
        <button type="button" onClick={() => setSelection(readSelection())}>
          Refresh
        </button>
        <button type="button" onClick={() => document.body.toggleAttribute("data-bmkl-active")}>
          Mark page
        </button>
      </div>
    </section>
  );
}

function readSelection(): string {
  return String(globalThis.getSelection?.() ?? "").trim();
}
