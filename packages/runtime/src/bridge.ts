import type { BmklBridgeMessage } from "@bmkl/contracts";

export type BookmarkletBridgeMessage = BmklBridgeMessage;

export type BookmarkletBridgeOriginRule =
  | string
  | readonly string[]
  | ((origin: string) => boolean);

export interface BookmarkletBridgeOptions {
  targetWindow: Window;
  targetOrigin: string;
  receiveWindow?: Window;
  expectedOrigin?: BookmarkletBridgeOriginRule;
  /** Pass null only to explicitly accept messages from any source window. */
  expectedSource?: MessageEventSource | null;
  timeoutMs?: number;
}

export interface BookmarkletBridgeRequestOptions {
  requestId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type BookmarkletBridgeMessageListener = (
  message: BookmarkletBridgeMessage,
  event: MessageEvent,
) => void;

export interface BookmarkletBridge {
  readonly targetOrigin: string;
  close(): void;
  onMessage(listener: BookmarkletBridgeMessageListener): () => void;
  post(message: BookmarkletBridgeMessage): void;
  request(
    action: string,
    input: unknown,
    options?: BookmarkletBridgeRequestOptions,
  ): Promise<unknown>;
}

export function createBookmarkletBridge(
  options: BookmarkletBridgeOptions,
): BookmarkletBridge {
  const targetOrigin = normalizeTargetOrigin(options.targetOrigin);
  const receiveWindow = options.receiveWindow ?? window;
  const expectedOrigin =
    options.expectedOrigin ??
    (targetOrigin === "*" ? undefined : targetOrigin);
  const expectedSource =
    options.expectedSource === undefined
      ? options.targetWindow
      : options.expectedSource;

  if (targetOrigin === "*" && !expectedOrigin) {
    throw new Error(
      'BMKL bridge requires expectedOrigin when targetOrigin is "*". Pass an explicit rule to opt into wildcard delivery.',
    );
  }

  const cleanups = new Set<() => void>();

  const bridge: BookmarkletBridge = {
    targetOrigin,
    close() {
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.clear();
    },
    onMessage(listener) {
      const handler = (event: MessageEvent) => {
        if (expectedSource && event.source !== expectedSource) {
          return;
        }
        if (!isAllowedOrigin(event.origin, expectedOrigin)) {
          return;
        }
        if (!isBookmarkletBridgeMessage(event.data)) {
          return;
        }
        listener(event.data, event);
      };

      receiveWindow.addEventListener("message", handler);
      const cleanup = () => {
        receiveWindow.removeEventListener("message", handler);
        cleanups.delete(cleanup);
      };
      cleanups.add(cleanup);
      return cleanup;
    },
    post(message) {
      assertBookmarkletBridgeMessage(message);
      options.targetWindow.postMessage(message, targetOrigin);
    },
    request(action, input, requestOptions = {}) {
      const requestId = requestOptions.requestId ?? createBridgeRequestId();
      const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs ?? 8000;

      return new Promise((resolve, reject) => {
        if (requestOptions.signal?.aborted) {
          reject(createAbortError());
          return;
        }

        let settled = false;
        let cleanup = () => {};
        const settle = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          callback();
        };
        const timer = receiveWindow.setTimeout(() => {
          settle(() => {
            reject(new Error(`BMKL bridge request timed out: ${action}`));
          });
        }, timeoutMs);
        const abort = () => {
          settle(() => {
            reject(createAbortError());
          });
        };
        const removeListener = bridge.onMessage((message) => {
          if (message.type === "bmkl:action-result" && message.requestId === requestId) {
            settle(() => {
              resolve(message.result);
            });
          }
          if (message.type === "bmkl:error" && message.requestId === requestId) {
            settle(() => {
              reject(new Error(message.message));
            });
          }
        });
        cleanup = () => {
          receiveWindow.clearTimeout(timer);
          requestOptions.signal?.removeEventListener("abort", abort);
          removeListener();
        };

        requestOptions.signal?.addEventListener("abort", abort, { once: true });
        try {
          bridge.post({
            type: "bmkl:run-action",
            requestId,
            action,
            input,
          });
        } catch (error) {
          settle(() => {
            reject(toError(error));
          });
        }
      });
    },
  };

  return bridge;
}

export function assertBookmarkletBridgeMessage(
  input: unknown,
): asserts input is BookmarkletBridgeMessage {
  if (!isBookmarkletBridgeMessage(input)) {
    throw new Error("Invalid BMKL bridge message.");
  }
}

export function isBookmarkletBridgeMessage(
  input: unknown,
): input is BookmarkletBridgeMessage {
  if (!isRecord(input) || typeof input.type !== "string") {
    return false;
  }

  switch (input.type) {
    case "bmkl:ready":
      return (
        hasOnlyKeys(input, ["type", "appId", "frameId", "capabilities"]) &&
        typeof input.appId === "string" &&
        input.appId.length > 0 &&
        optionalString(input.frameId) &&
        optionalStringArray(input.capabilities)
      );
    case "bmkl:run-action":
      return (
        hasOnlyKeys(input, ["type", "requestId", "action", "input"]) &&
        typeof input.requestId === "string" &&
        input.requestId.length > 0 &&
        typeof input.action === "string" &&
        input.action.length > 0 &&
        hasOwn(input, "input")
      );
    case "bmkl:action-result":
      return (
        hasOnlyKeys(input, ["type", "requestId", "result"]) &&
        typeof input.requestId === "string" &&
        input.requestId.length > 0 &&
        hasOwn(input, "result")
      );
    case "bmkl:error":
      return (
        hasOnlyKeys(input, ["type", "requestId", "message"]) &&
        optionalString(input.requestId) &&
        typeof input.message === "string" &&
        input.message.length > 0
      );
    default:
      return false;
  }
}

export function createBridgeRequestId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `bmkl-${globalThis.crypto.randomUUID()}`;
  }

  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return `bmkl-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  return `bmkl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTargetOrigin(targetOrigin: string | undefined): string {
  if (!targetOrigin) {
    throw new Error(
      'BMKL bridge requires an explicit targetOrigin. Pass "*" only when paired with expectedOrigin.',
    );
  }
  return targetOrigin;
}

function isAllowedOrigin(
  origin: string,
  rule: BookmarkletBridgeOriginRule | undefined,
): boolean {
  if (!rule) {
    return true;
  }
  if (typeof rule === "function") {
    return rule(origin);
  }
  if (typeof rule === "string") {
    return origin === rule;
  }
  return rule.includes(origin);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function hasOwn(input: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function hasOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(input).every((key) => allowed.has(key));
}

function optionalString(input: unknown): boolean {
  return input === undefined || typeof input === "string";
}

function optionalStringArray(input: unknown): boolean {
  return (
    input === undefined ||
    (Array.isArray(input) && input.every((item) => typeof item === "string"))
  );
}

function createAbortError(): Error {
  const error = new Error("BMKL bridge request aborted.");
  error.name = "AbortError";
  return error;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
