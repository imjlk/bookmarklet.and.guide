export type PanelPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface PanelConfig {
  eyebrow: string;
  /** Corner used above 520px; compact viewports use a full-width bottom inset. */
  position: PanelPosition;
  title: string;
}

export const panelConfig = {
  eyebrow: "Page utility",
  position: "top-right",
  title: "__BMKL_PROJECT_TITLE__",
} satisfies PanelConfig;

/**
 * Kept in starter source so generated apps can customize keyboard and focus behavior.
 */
export interface PanelController {
  close(): void;
  disconnect(): void;
}

export function connectPanel(
  panel: HTMLElement,
  destroyHost: () => void,
): PanelController {
  const ownerDocument = panel.ownerDocument;
  const previousFocus =
    ownerDocument.activeElement instanceof HTMLElement
      ? ownerDocument.activeElement
      : undefined;
  let connected = true;

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    // Keep sibling document listeners available to independently mounted tools.
    event.stopPropagation();
    close();
  }

  function disconnect(): void {
    if (!connected) {
      return;
    }
    connected = false;
    ownerDocument.removeEventListener("keydown", handleKeydown, true);
  }

  function close(): void {
    if (!connected) {
      return;
    }
    disconnect();
    try {
      destroyHost();
    } finally {
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    }
  }

  ownerDocument.addEventListener("keydown", handleKeydown, true);
  queueMicrotask(() => {
    if (connected && panel.isConnected) {
      panel.focus({ preventScroll: true });
    }
  });

  return { close, disconnect };
}
