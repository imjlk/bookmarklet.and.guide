import {
  captureBookmarkletDebugError,
  installBookmarkletStyles,
  logBookmarkletDebugEvent,
  mountBookmarkletApp,
  registerBookmarkletApi,
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
  destroy();
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
    registration.activate();
    installBookmarkletStyles(ctx, styles);

    dispose = render(
      () => (
        <QueryClientProvider client={client}>
          <App destroy={destroy} />
        </QueryClientProvider>
      ),
      ctx.root,
    );
    logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
  } catch (error) {
    destroy();
    captureBookmarkletDebugError(error, "solid-query-mount");
    throw error;
  }
}

export function destroy(): void {
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

  const destroyCurrentHost = destroyHost;
  destroyHost = undefined;
  try {
    destroyCurrentHost?.();
  } catch (error) {
    captureBookmarkletDebugError(error, "solid-query-host-cleanup");
  } finally {
    registration.release();
  }
}

const registration = registerBookmarkletApi({
  id: "__BMKL_PROJECT_ID__",
  globalName: "__BMKL_GLOBAL_NAME__",
  run,
  destroy,
});
