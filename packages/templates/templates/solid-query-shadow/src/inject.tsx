import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
} from "@bmkl/runtime";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { App } from "./App.jsx";
import styles from "./style.css?inline";

let dispose: (() => void) | undefined;
let destroyHost: (() => void) | undefined;
let queryClient: QueryClient | undefined;

export function run(): void {
  cleanup();
  try {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: 30_000,
        },
      },
    });
    queryClient = client;

    const ctx = mountBookmarkletApp({
      id: "__BMKL_PROJECT_ID__",
      mode: "shadow",
    });
    destroyHost = ctx.destroy;
    installBookmarkletStyles(ctx, styles);

    dispose = render(
      () => (
        <QueryClientProvider client={client}>
          <App destroy={cleanup} />
        </QueryClientProvider>
      ),
      ctx.root,
    );
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    cleanup();
    captureBookmarkletDebugError(error, "solid-query-mount");
    throw error;
  }
}

function cleanup(): void {
  const stop = dispose;
  dispose = undefined;
  try {
    stop?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-query-cleanup");
  }

  const client = queryClient;
  queryClient = undefined;
  try {
    client?.clear();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-query-cache-cleanup");
  }

  const destroy = destroyHost;
  destroyHost = undefined;
  try {
    destroy?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-query-host-cleanup");
  }
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
