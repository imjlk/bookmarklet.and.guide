import {
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
let queryClient: QueryClient | undefined;

export function run(): void {
  dispose?.();
  queryClient?.clear();
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
  installBookmarkletStyles(ctx, styles);

  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <App destroy={ctx.destroy} />
      </QueryClientProvider>
    ),
    ctx.root,
  );
  logBookmarkletDebugEvent("app-mounted", "__BMKL_PROJECT_NAME__ mounted");
}

Object.assign(globalThis, {
  __BMKL_GLOBAL_NAME__: { run },
});
