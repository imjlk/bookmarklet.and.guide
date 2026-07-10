import { useQuery } from "@tanstack/solid-query";
import { createSignal, Match, Switch } from "solid-js";
import { copyText } from "./copyText.js";

export interface AppProps {
  destroy(): void;
}

interface PageSnapshot {
  href: string;
  selectedText: string;
  title: string;
  wordCount: number;
}

export function App(props: AppProps) {
  const [copyStatus, setCopyStatus] = createSignal(
    "Refetch the snapshot after the page changes, then copy its summary.",
  );
  const snapshot = useQuery(() => ({
    queryKey: ["page-snapshot", location.href],
    queryFn: readPageSnapshot,
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 30_000,
  }));

  const copySnapshot = async () => {
    const data = snapshot.data;
    if (!data) {
      setCopyStatus("Wait for the page snapshot before copying.");
      return;
    }

    const summary = [
      data.title || "Untitled page",
      data.href,
      `${data.wordCount} words`,
      data.selectedText ? `Selection: ${data.selectedText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    setCopyStatus(await copyText(summary, "page snapshot"));
  };

  return (
    <section class="bmkl-panel">
      <header>
        <span>__BMKL_PROJECT_NAME__</span>
        <button type="button" aria-label="Close" onClick={props.destroy}>
          ×
        </button>
      </header>
      <Switch>
        <Match when={snapshot.isPending}>
          <p>Reading page...</p>
        </Match>
        <Match when={snapshot.isError}>
          <p>Could not read the page snapshot.</p>
        </Match>
        <Match when={snapshot.isSuccess && snapshot.data}>
          {(data) => (
            <dl>
              <div>
                <dt>Title</dt>
                <dd>{data().title || "Untitled page"}</dd>
              </div>
              <div>
                <dt>Selection</dt>
                <dd>{data().selectedText || "none"}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{data().wordCount}</dd>
              </div>
            </dl>
          )}
        </Match>
      </Switch>
      <div class="bmkl-actions">
        <button type="button" onClick={() => snapshot.refetch()}>
          Refetch
        </button>
        <button type="button" onClick={copySnapshot}>
          Copy snapshot
        </button>
      </div>
      <p class="bmkl-status" role="status" aria-live="polite">
        {copyStatus()}
      </p>
    </section>
  );
}

async function readPageSnapshot(): Promise<PageSnapshot> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const text = document.body.innerText ?? "";

  return {
    href: location.href,
    selectedText: String(globalThis.getSelection?.() ?? "").trim(),
    title: document.title,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
  };
}
