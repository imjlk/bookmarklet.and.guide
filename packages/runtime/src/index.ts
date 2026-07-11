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

export interface BookmarkletGlobalApi {
  run(): void | Promise<void>;
  destroy(): void;
}

export interface BookmarkletApiRegistration {
  readonly api: BookmarkletGlobalApi;
  activate(): void;
  /**
   * Relinquish active ownership while keeping the global API callable for another run.
   */
  release(): void;
}

export interface RegisterBookmarkletApiOptions extends BookmarkletGlobalApi {
  id: string;
  globalName: string;
}

const DEFAULT_ID = "__bmkl_host__";
const HOST_ATTRIBUTE = "data-bmkl-host";
const MODE_ATTRIBUTE = "data-bmkl-mode";
const API_REGISTRY_OWNER = "@bmkl/runtime/bookmarklet-api-registration";
// Fresh cache-busted modules need the same key. This coordinates code already
// sharing the host realm; it is not a security boundary against host scripts.
const API_OWNERSHIP_KEY = Symbol.for(`${API_REGISTRY_OWNER}:api-ownership`);
// These names get an early, specific error. The generic claim preflight below
// also rejects every other global already defined by the host environment.
const RESERVED_GLOBAL_NAMES = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "prototype",
  "toLocaleString",
  "toString",
  "valueOf",
]);

interface BookmarkletApiOwnershipRecord {
  owner: typeof API_REGISTRY_OWNER;
  id: string;
  globalName: string;
}

interface BookmarkletApiRegistryState {
  owner: typeof API_REGISTRY_OWNER;
  id: string;
  globalName: string;
  api: BookmarkletGlobalApi;
}

export function installBookmarkletStyles(
  context: BookmarkletAppContext,
  css: string,
  id = "bmkl-app-styles",
): HTMLStyleElement {
  const container = context.shadowRoot ?? context.root.ownerDocument.head;
  const existing = Array.from(
    container.querySelectorAll<HTMLStyleElement>("style[data-bmkl-style]"),
  ).find((style) => style.getAttribute("data-bmkl-style") === id);

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
    assertOwnedHost(existing, id);
    if (options.reset === false) {
      const context = restoreBookmarkletContext(existing);
      if (context) {
        return context;
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
    assertOwnedHost(existing, id);
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

export function registerBookmarkletApi(
  options: RegisterBookmarkletApiOptions,
): BookmarkletApiRegistration {
  assertNonEmptyString(options?.id, "project id");
  assertNonEmptyString(options?.globalName, "global name");
  assertSafeBookmarkletGlobalName(options.globalName);
  assertBookmarkletApiFunction(options?.run, "run");
  assertBookmarkletApiFunction(options?.destroy, "destroy");

  const api: BookmarkletGlobalApi = {
    run: options.run,
    destroy: options.destroy,
  };
  markBookmarkletGlobalApi(api, options.id, options.globalName);
  const state: BookmarkletApiRegistryState = {
    owner: API_REGISTRY_OWNER,
    id: options.id,
    globalName: options.globalName,
    api,
  };
  const registryKey = getBookmarkletApiRegistryKey(options.id);

  const registration: BookmarkletApiRegistration = {
    api,
    activate() {
      claimBookmarkletApi(registryKey, state);
    },
    release() {
      const runtimeGlobal = getRuntimeGlobal();
      if (runtimeGlobal[registryKey] === state) {
        Reflect.deleteProperty(runtimeGlobal, registryKey);
      }
      // The public global intentionally remains callable after the panel closes;
      // its ownership marker lets a future module replace it without a collision.
    },
  };

  registration.activate();
  return registration;
}

export function getBookmarkletDebugReport(): BookmarkletDebugReport | undefined {
  return getBookmarkletDebugSession()?.report?.();
}

function claimBookmarkletApi(
  registryKey: symbol,
  state: BookmarkletApiRegistryState,
): void {
  const runtimeGlobal = getRuntimeGlobal();
  const registryDescriptor = Object.getOwnPropertyDescriptor(
    runtimeGlobal,
    registryKey,
  );
  const previous = readBookmarkletApiRegistryState(
    registryDescriptor?.value,
    state.id,
  );
  assertBookmarkletApiClaimable(runtimeGlobal, registryKey, state, previous);

  if (previous && previous !== state) {
    destroyPriorBookmarkletApi(previous);
    removeBookmarkletGlobalIfOwned(previous.globalName, previous.api);
  }

  // Cleanup may synchronously claim the registry or expose another host value,
  // so check both again before installing the incoming API.
  assertBookmarkletApiClaimable(runtimeGlobal, registryKey, state, previous);
  Object.defineProperty(runtimeGlobal, registryKey, {
    value: state,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  Object.defineProperty(runtimeGlobal, state.globalName, {
    value: state.api,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function assertBookmarkletApiClaimable(
  runtimeGlobal: Record<PropertyKey, unknown>,
  registryKey: symbol,
  state: BookmarkletApiRegistryState,
  previous: BookmarkletApiRegistryState | undefined,
): void {
  assertBookmarkletRegistryClaimable(
    runtimeGlobal,
    registryKey,
    state,
    previous,
  );
  assertBookmarkletGlobalClaimable(runtimeGlobal, state, previous);
}

function assertBookmarkletRegistryClaimable(
  runtimeGlobal: Record<PropertyKey, unknown>,
  registryKey: symbol,
  state: BookmarkletApiRegistryState,
  previous: BookmarkletApiRegistryState | undefined,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(runtimeGlobal, registryKey);
  if (!descriptor) {
    if (!Object.isExtensible(runtimeGlobal)) {
      throw new Error(
        `BMKL cannot create the API registry for project "${state.id}".`,
      );
    }
    return;
  }

  const ownsState = "value" in descriptor && descriptor.value === state;
  const ownsPrevious =
    previous !== undefined &&
    "value" in descriptor &&
    descriptor.value === previous;
  if (!ownsState && !ownsPrevious) {
    throw new Error(
      `BMKL cannot claim the API registry for project "${state.id}" because another owner is active.`,
    );
  }
  if (descriptor.configurable === false) {
    throw new Error(
      `BMKL cannot claim the API registry for project "${state.id}" because the existing entry is not configurable.`,
    );
  }
}

function assertBookmarkletGlobalClaimable(
  runtimeGlobal: Record<PropertyKey, unknown>,
  state: BookmarkletApiRegistryState,
  previous: BookmarkletApiRegistryState | undefined,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    runtimeGlobal,
    state.globalName,
  );
  if (!descriptor) {
    if (Reflect.has(runtimeGlobal, state.globalName)) {
      throwBookmarkletGlobalCollision(state.globalName);
    }
    if (!Object.isExtensible(runtimeGlobal)) {
      throw new Error(
        `BMKL cannot create global "${state.globalName}" because the host global is not extensible.`,
      );
    }
    return;
  }

  if (!("value" in descriptor)) {
    throwBookmarkletGlobalCollision(state.globalName);
  }
  const existing = descriptor.value;
  const ownership = readBookmarkletApiOwnership(existing);
  const canReplace =
    existing === state.api ||
    (previous !== undefined && existing === previous.api) ||
    (ownership?.id === state.id && ownership.globalName === state.globalName);
  if (!canReplace) {
    throwBookmarkletGlobalCollision(state.globalName);
  }

  if (descriptor.configurable === false) {
    throw new Error(
      `BMKL cannot replace global "${state.globalName}" because it is not configurable.`,
    );
  }
}

function throwBookmarkletGlobalCollision(globalName: string): never {
  throw new Error(
    `BMKL cannot expose global "${globalName}" because it is already defined by the host page or another project. Choose a different globalName.`,
  );
}

function markBookmarkletGlobalApi(
  api: BookmarkletGlobalApi,
  id: string,
  globalName: string,
): void {
  const ownership: BookmarkletApiOwnershipRecord = Object.freeze({
    owner: API_REGISTRY_OWNER,
    id,
    globalName,
  });
  Object.defineProperty(api, API_OWNERSHIP_KEY, {
    value: ownership,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function readBookmarkletApiOwnership(
  value: unknown,
): BookmarkletApiOwnershipRecord | undefined {
  if (!isBookmarkletGlobalApi(value)) {
    return undefined;
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, API_OWNERSHIP_KEY);
  } catch {
    return undefined;
  }
  const ownership = descriptor?.value as
    | Partial<BookmarkletApiOwnershipRecord>
    | undefined;
  return descriptor?.enumerable === false &&
    ownership?.owner === API_REGISTRY_OWNER &&
    typeof ownership.id === "string" &&
    typeof ownership.globalName === "string"
    ? (ownership as BookmarkletApiOwnershipRecord)
    : undefined;
}

function destroyPriorBookmarkletApi(state: BookmarkletApiRegistryState): void {
  try {
    state.api.destroy();
  } catch (error) {
    reportBookmarkletApiCleanupError(error);
  }
}

function reportBookmarkletApiCleanupError(error: unknown): void {
  try {
    captureBookmarkletDebugError(error, "api-handoff-cleanup");
  } catch {
    // A broken debug session must not block the incoming registration.
  }

  try {
    console.error("BMKL failed to clean up the prior bookmarklet API.", error);
  } catch {
    // Console implementations can be replaced by the host page.
  }
}

function removeBookmarkletGlobalIfOwned(
  globalName: string,
  api: BookmarkletGlobalApi,
): void {
  const runtimeGlobal = getRuntimeGlobal();
  if (runtimeGlobal[globalName] === api) {
    Reflect.deleteProperty(runtimeGlobal, globalName);
  }
}

function readBookmarkletApiRegistryState(
  value: unknown,
  expectedId: string,
): BookmarkletApiRegistryState | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { owner?: unknown }).owner !== API_REGISTRY_OWNER
  ) {
    return undefined;
  }

  const state = value as Partial<BookmarkletApiRegistryState>;
  return state.id === expectedId &&
    typeof state.globalName === "string" &&
    isBookmarkletGlobalApi(state.api)
    ? (state as BookmarkletApiRegistryState)
    : undefined;
}

function isBookmarkletGlobalApi(value: unknown): value is BookmarkletGlobalApi {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  try {
    return (
      typeof (value as Partial<BookmarkletGlobalApi>).run === "function" &&
      typeof (value as Partial<BookmarkletGlobalApi>).destroy === "function"
    );
  } catch {
    return false;
  }
}

function assertNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`BMKL ${label} must be a non-empty string.`);
  }
}

function assertSafeBookmarkletGlobalName(globalName: string): void {
  if (RESERVED_GLOBAL_NAMES.has(globalName)) {
    throw new TypeError(
      `BMKL global name "${globalName}" is unsafe or reserved. Choose a different globalName.`,
    );
  }
}

function assertBookmarkletApiFunction(
  value: unknown,
  name: "run" | "destroy",
): asserts value is BookmarkletGlobalApi[typeof name] {
  if (typeof value !== "function") {
    throw new TypeError(`BMKL bookmarklet API ${name} must be a function.`);
  }
}

function getBookmarkletApiRegistryKey(id: string): symbol {
  return Symbol.for(`${API_REGISTRY_OWNER}:${id}`);
}

function getRuntimeGlobal(): Record<PropertyKey, unknown> {
  return globalThis as unknown as Record<PropertyKey, unknown>;
}

function mountShadow(id: string, options: MountOptions): BookmarkletAppContext {
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.setAttribute(MODE_ATTRIBUTE, "shadow");
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
  host.setAttribute(HOST_ATTRIBUTE, "");
  host.setAttribute(MODE_ATTRIBUTE, "iframe");
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
  // The app is rendered by the parent runtime, so frame scripts stay disabled.
  // `allow-same-origin` is required for the parent to access the about:blank
  // document while forms and explicit popups remain available to app UI.
  iframe.setAttribute("sandbox", "allow-same-origin allow-forms allow-popups");
  host.appendChild(iframe);
  document.documentElement.appendChild(host);

  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error("Unable to access BMKL iframe document.");
    }

    doc.open();
    doc.write(
      '<!doctype html><html><head><meta charset="utf-8" /></head><body><div data-bmkl-root></div></body></html>',
    );
    doc.close();

    const root = doc.querySelector<HTMLElement>("[data-bmkl-root]");
    if (!root) {
      throw new Error("BMKL iframe root was not created.");
    }

    return createBookmarkletContext(host, root, { iframe });
  } catch (error) {
    host.remove();
    throw error;
  }
}

function assertOwnedHost(host: HTMLElement, id: string): void {
  if (!host.hasAttribute(HOST_ATTRIBUTE)) {
    throw new Error(
      `BMKL cannot replace #${id} because that element is not owned by BMKL. Choose a different mount id.`,
    );
  }
}

function restoreBookmarkletContext(
  host: HTMLElement,
): BookmarkletAppContext | undefined {
  const shadowRoot = host.shadowRoot;
  const shadowAppRoot = shadowRoot?.querySelector<HTMLElement>("[data-bmkl-root]");
  if (shadowRoot && shadowAppRoot) {
    return createBookmarkletContext(host, shadowAppRoot, { shadowRoot });
  }

  const iframe = host.querySelector<HTMLIFrameElement>("iframe");
  const iframeRoot = iframe?.contentDocument?.querySelector<HTMLElement>(
    "[data-bmkl-root]",
  );
  if (iframe && iframeRoot) {
    return createBookmarkletContext(host, iframeRoot, { iframe });
  }

  return undefined;
}

function createBookmarkletContext(
  host: HTMLElement,
  root: HTMLElement,
  mode: Pick<BookmarkletAppContext, "shadowRoot" | "iframe">,
): BookmarkletAppContext {
  return {
    host,
    root,
    ...mode,
    destroy: () => host.remove(),
  };
}
