import type {
  BookmarkletBridge,
  BookmarkletBridgeMessage,
} from "./bridge.js";
import type { BmklAction } from "@bmkl/contracts";

export interface BookmarkletActionContext {
  bridge?: BookmarkletBridge;
  event?: MessageEvent;
  signal?: AbortSignal;
}

export type BookmarkletAction<Input = unknown, Output = unknown> = Omit<
  BmklAction<Input, Output>,
  "run"
> & {
  run(
    input: Input,
    context: BookmarkletActionContext,
  ): Output | Promise<Output>;
};

export interface BookmarkletActionRegistry {
  clear(): void;
  has(name: string): boolean;
  list(): BookmarkletAction[];
  register(action: BookmarkletAction): () => void;
  run(
    name: string,
    input: unknown,
    context?: BookmarkletActionContext,
  ): Promise<unknown>;
  unregister(name: string): boolean;
}

export interface BookmarkletActionBridgeOptions {
  signal?: AbortSignal;
}

export function defineBookmarkletAction<const Action extends BookmarkletAction>(
  action: Action,
): Action {
  assertActionName(action.name);
  assertActionValidators(action);
  return action;
}

export function createBookmarkletActionRegistry(
  actions: readonly BookmarkletAction[] = [],
): BookmarkletActionRegistry {
  const registry = new Map<string, BookmarkletAction>();

  const api: BookmarkletActionRegistry = {
    clear() {
      registry.clear();
    },
    has(name) {
      return registry.has(name);
    },
    list() {
      return Array.from(registry.values());
    },
    register(action) {
      const actionName = action.name;
      assertActionName(actionName);
      assertActionValidators(action);
      if (registry.has(actionName)) {
        throw new Error(`BMKL action is already registered: ${actionName}`);
      }
      registry.set(actionName, action);
      return () => {
        if (registry.get(actionName) === action) {
          registry.delete(actionName);
        }
      };
    },
    async run(name, input, context = {}) {
      const action = registry.get(name);
      if (!action) {
        throw new Error(`BMKL action not found: ${name}`);
      }
      const parsedInput = action.assertInput(input);
      const output = await action.run(parsedInput, context);
      const validation = action.validateOutput(output);
      if (!validation.success) {
        const details = validation.errors
          .map((error) => `${error.path}: expected ${error.expected}`)
          .join("; ");
        throw new Error(
          `BMKL action returned invalid output: ${name}${details ? ` (${details})` : ""}`,
        );
      }
      return validation.data;
    },
    unregister(name) {
      return registry.delete(name);
    },
  };

  for (const action of actions) {
    api.register(action);
  }

  return api;
}

export function connectBookmarkletActionBridge(
  bridge: BookmarkletBridge,
  registry: BookmarkletActionRegistry,
  options: BookmarkletActionBridgeOptions = {},
): () => void {
  const disconnect = bridge.onMessage((message, event) => {
    if (message.type !== "bmkl:run-action") {
      return;
    }
    if (options.signal?.aborted) {
      return;
    }

    void runBridgeAction(bridge, registry, message, event, options.signal);
  });

  if (!options.signal) {
    return disconnect;
  }

  const disconnectOnAbort = () => {
    disconnect();
  };

  if (options.signal.aborted) {
    disconnect();
    return disconnect;
  }

  options.signal.addEventListener("abort", disconnectOnAbort, { once: true });
  return () => {
    options.signal?.removeEventListener("abort", disconnectOnAbort);
    disconnect();
  };
}

async function runBridgeAction(
  bridge: BookmarkletBridge,
  registry: BookmarkletActionRegistry,
  message: Extract<BookmarkletBridgeMessage, { type: "bmkl:run-action" }>,
  event: MessageEvent,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const result = await registry.run(message.action, message.input, {
      bridge,
      event,
      signal,
    });
    if (signal?.aborted) {
      return;
    }
    bridge.post({
      type: "bmkl:action-result",
      requestId: message.requestId,
      result,
    });
  } catch (error) {
    safePost(bridge, {
      type: "bmkl:error",
      requestId: message.requestId,
      message: toActionErrorMessage(error),
    });
  }
}

function safePost(bridge: BookmarkletBridge, message: BookmarkletBridgeMessage): void {
  try {
    bridge.post(message);
  } catch {
    // The caller will time out if the target window is already gone.
  }
}

function assertActionName(name: string): void {
  if (!name) {
    throw new Error("BMKL action requires a non-empty name.");
  }
}

function assertActionValidators(action: BookmarkletAction): void {
  if (typeof action.assertInput !== "function") {
    throw new Error(`BMKL action requires assertInput(): ${action.name}`);
  }
  if (typeof action.validateOutput !== "function") {
    throw new Error(`BMKL action requires validateOutput(): ${action.name}`);
  }
}

function toActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
