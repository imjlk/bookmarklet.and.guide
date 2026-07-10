export * from "./actions.js";
export * from "./bridge.js";

export interface MountOptions {
  id?: string;
  mode?: "shadow" | "iframe";
  zIndex?: number;
  reset?: boolean;
  title?: string;
}

export interface BookmarkletAppContext {
  host: HTMLElement;
  root: HTMLElement;
  shadowRoot?: ShadowRoot;
  iframe?: HTMLIFrameElement;
  destroy(): void;
}

export interface BookmarkletDebugPageSnapshot {
  url: string;
  title?: string;
  target?: string;
  mode?: "bookmarklet" | "companion";
}

export interface BookmarkletDebugEvent {
  source: "bmkl-debug";
  eventId: string;
  sessionId: string;
  startedAt: string;
  time: string;
  type: string;
  message: string;
  data?: unknown;
  page: BookmarkletDebugPageSnapshot;
}

export interface BookmarkletDebugReport {
  sessionId: string;
  startedAt: string;
  page: BookmarkletDebugPageSnapshot;
  events: BookmarkletDebugEvent[];
}

export interface BookmarkletDebugSession {
  event(type: BookmarkletDebugEvent["type"], message: string, data?: unknown): void;
  error(error: unknown, phase?: string): void;
  openConsole?(): boolean;
  report?(): BookmarkletDebugReport;
}

const DEFAULT_ID = "__bmkl_host__";

export function installBookmarkletStyles(
  context: BookmarkletAppContext,
  css: string,
  id = "bmkl-app-styles",
): HTMLStyleElement {
  const container = context.shadowRoot ?? context.root.ownerDocument.head;
  const existing = container.querySelector<HTMLStyleElement>(
    `style[data-bmkl-style="${id}"]`,
  );

  if (existing) {
    existing.textContent = css;
    return existing;
  }

  const style = context.root.ownerDocument.createElement("style");
  style.setAttribute("data-bmkl-style", id);
  style.textContent = css;
  container.appendChild(style);
  return style;
}

export function mountBookmarkletApp(
  options: MountOptions = {},
): BookmarkletAppContext {
  const id = options.id ?? DEFAULT_ID;
  const existing = document.getElementById(id);

  if (existing) {
    if (options.reset === false) {
      const root = existing.querySelector<HTMLElement>("[data-bmkl-root]");
      if (root) {
        return {
          host: existing,
          root,
          destroy: () => existing.remove(),
        };
      }
    }

    existing.remove();
  }

  return options.mode === "iframe" ? mountIframe(id, options) : mountShadow(id, options);
}

export function toggleBookmarkletApp(options: MountOptions = {}): boolean {
  const id = options.id ?? DEFAULT_ID;
  const existing = document.getElementById(id);
  if (existing) {
    existing.remove();
    return false;
  }

  mountBookmarkletApp(options);
  return true;
}

export function getBookmarkletDebugSession(): BookmarkletDebugSession | undefined {
  const session = (globalThis as { __BMKL_DEBUG_SESSION__?: unknown })
    .__BMKL_DEBUG_SESSION__;
  return isDebugSession(session) ? session : undefined;
}

export function logBookmarkletDebugEvent(
  type: BookmarkletDebugEvent["type"],
  message: string,
  data?: unknown,
): void {
  getBookmarkletDebugSession()?.event(type, message, data);
}

export function captureBookmarkletDebugError(
  error: unknown,
  phase = "app-error",
): void {
  getBookmarkletDebugSession()?.error(error, phase);
}

export function getBookmarkletDebugReport(): BookmarkletDebugReport | undefined {
  return getBookmarkletDebugSession()?.report?.();
}

function mountShadow(id: string, options: MountOptions): BookmarkletAppContext {
  const host = document.createElement("div");
  host.id = id;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = String(options.zIndex ?? 2147483647);
  host.style.pointerEvents = "none";

  const shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    [data-bmkl-root] {
      all: initial;
      box-sizing: border-box;
      font-family: inherit;
      pointer-events: auto;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
  `;

  const root = document.createElement("div");
  root.setAttribute("data-bmkl-root", "");
  shadowRoot.append(style, root);
  document.documentElement.appendChild(host);

  return {
    host,
    root,
    shadowRoot,
    destroy: () => host.remove(),
  };
}

function isDebugSession(value: unknown): value is BookmarkletDebugSession {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BookmarkletDebugSession).event === "function" &&
    typeof (value as BookmarkletDebugSession).error === "function"
  );
}

function mountIframe(id: string, options: MountOptions): BookmarkletAppContext {
  const host = document.createElement("div");
  host.id = id;
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = String(options.zIndex ?? 2147483647);
  host.style.pointerEvents = "none";

  const iframe = document.createElement("iframe");
  iframe.title = options.title ?? "BMKL panel";
  iframe.style.position = "absolute";
  iframe.style.inset = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  iframe.style.pointerEvents = "auto";
  iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
  host.appendChild(iframe);
  document.documentElement.appendChild(host);

  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error("Unable to access BMKL iframe document.");
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8" /></head><body><div data-bmkl-root></div></body></html>`);
  doc.close();

  const root = doc.querySelector<HTMLElement>("[data-bmkl-root]");
  if (!root) {
    throw new Error("BMKL iframe root was not created.");
  }

  return {
    host,
    iframe,
    root,
    destroy: () => host.remove(),
  };
}
