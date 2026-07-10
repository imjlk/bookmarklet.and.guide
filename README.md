# BMKL

BMKL is a Vite-first toolkit for building bookmarklets as real in-page apps:
Vite handles preview and IIFE bundling, while `ttsc` supplies type checks,
graph output, and optional compiler-plugin paths.

Project creation follows the JavaScript package-manager convention through
`create-bmkl`. The project CLI is `bmkl` with a short `bmk` alias.

```bash
pnpm install
pnpm build
pnpm --filter create-bmkl dev -- "$PWD/my-agent" --template lit-shadow
cd my-agent
pnpm install
pnpm build
```

After publishing, the same flow is intended to read as:

```bash
npm create bmkl@latest my-agent -- --template lit-shadow
pnpm create bmkl my-agent --template ttsc-shadow
pnpm create bmkl my-agent --template solid-query-shadow
bun create bmkl my-agent --template vanilla-shadow
```

Generated bookmarklet projects emit:

```text
dist/bookmarklet/
  remote/
    app.iife.js
    loader.js
    manifest.json
    bookmarklet.txt
    install.html
  inline/
    bookmarklet.txt
  meta/
    build-report.json
```

## Workspace

```text
packages/core      BookmarkBuilder, config, debug console, companion, loader/install/report generation
packages/contracts typia-backed debug, manifest, action, and bridge contracts
packages/runtime   Shadow DOM, iframe, debug, action, and postMessage bridge helpers
packages/vite      Vite plugin wrapper with optional @ttsc/unplugin/vite integration
packages/templates Vite template metadata and shared scaffold API
packages/create    create-bmkl package-manager starter entrypoint
packages/cli       bmkl/bmk command line for dev, build, inspect, doctor
apps/web           Solid + Vite intro site for Cloudflare Pages
```

## Toolchain

The workspace uses `typescript@7`, `ttsc`, `typia@13`, `@ttsc/lint`,
`@ttsc/strip`, `@ttsc/paths`, `@ttsc/graph`, and `@ttsc/unplugin`.

```bash
pnpm typecheck
pnpm format
pnpm graph
pnpm e2e:debug
```

`lint.config.json` is used instead of a JS/TS lint config so `@ttsc/lint` does
not need to evaluate user code while scaffolds are still being generated.
Templates include `ttsc --noEmit`, `ttsc-graph`, and `@ttsc/*` config so
projects are ready for compiler-aware checks. The Vite integration can opt into
`@ttsc/unplugin`; Solid-based templates disable that transform path for JSX
build compatibility while keeping ttsc checks and graph scripts.
`@bmkl/contracts` uses typia as the generated contract layer for external JSON
payloads, including debug events, remote manifests, action envelopes, and iframe
bridge messages. `bmkl doctor` runs a contract smoke check so the typia
transform path fails early when the local compiler setup drifts.

## Templates

```text
lit-shadow           Default TS-first Lit template with Shadow DOM UI
ttsc-shadow          Compiler-aware TS template using lint, strip, paths, graph
solid-shadow         Compact Solid UI template for fast overlays
solid-query-shadow   Solid + TanStack Query template for cached async data
react-shadow         React template for component reuse and familiar workflows
vanilla-shadow       Minimal TypeScript template with no UI framework
```

`ttsc-shadow` is the template for trying the compiler toolchain seriously:
`@ttsc/lint` runs in the type-check pass, `@ttsc/strip` removes debug-only calls
from bundled output, `@ttsc/paths` rewrites alias imports for emitted
declarations, and `ttsc-graph` is ready for code-graph inspection.

TanStack Query stays in its own template so ordinary bookmarklets do not pay for
server-state tooling unless they need API reads, refetching, cache lifetimes, or
shared async state.

## Commands

```bash
pnpm cli -- create my-agent --template lit-shadow
pnpm cli -- templates --json
pnpm cli -- build --config bookmarklet.config.ts
pnpm cli -- build --print-bookmarklet
pnpm cli -- inspect
pnpm cli -- doctor
pnpm cli -- contracts smoke
pnpm cli -- contracts validate-debug-report report.json
pnpm cli -- install-page
pnpm cli -- dev
pnpm cli -- companion --target https://example.com --port 5173
```

## Runtime bridge

`@bmkl/runtime` includes browser-safe helpers for iframe and window messaging:
`createBookmarkletBridge`, `createBookmarkletActionRegistry`, and
`connectBookmarkletActionBridge`. The runtime layer keeps validation structural
so injected apps do not bundle typia; copied JSON, manifests, reports, and
bridge messages can be checked through `bmkl contracts ...` or the
`@bmkl/contracts` package. Bridges require an explicit `targetOrigin`; if you
send to `"*"`, also provide `expectedOrigin` so inbound action messages are not
accepted from every origin by default.

## Target-site debugging

Development can run against the real target site, not only the local Vite
preview page.

```bash
bmkl dev --debug --target https://example.com
```

The command prints both a normal dev bookmarklet and a debug bookmarklet. Use
the debug bookmarklet when the bug only appears on the real site.

It also prints install-once launcher bookmarklets. Prefer those during active
development: the bookmark stays the same while the dev host and port stay the
same, and each click fetches the latest launcher script from the local dev
server.

Exact test flow:

```text
1. Run bmkl dev --debug --target <site>.
2. Open the real target site in your browser.
3. Create a bookmark named BMKL debug with the printed install-once debug bookmarklet URL.
4. Click BMKL debug while the target site tab is active.
5. Keep the localhost debug console window open when the popup is available.
6. Reproduce the issue on the target site.
7. Read loader/runtime/error events in the terminal, console, and in-page overlay.
8. If CSP, popup policy, or bridge delivery fails, click Copy report in the overlay.
```

The debug bridge uses multiple best-effort paths. It posts events directly to
the localhost dev server, mirrors them to the localhost console window with
`postMessage`, and de-duplicates events by ID when both paths arrive. The local
collector validates incoming debug payloads through `@bmkl/contracts` before
logging them. The overlay remains as the fallback report channel when CSP,
popup policy, or a site-specific browser rule blocks delivery.

### Companion mode for strict CSP

Some sites block the bookmarklet path before the BMKL dev module can run. The
common case is `script-src` blocking `http://127.0.0.1:*`, which the debug
bookmarklet can report as `module-load-error`. A stricter site can also block
`javascript:` bookmark execution or inline bootstrap code altogether; in that
case the bookmarklet cannot install the overlay at all.

`bmkl companion` builds an unpacked Chrome Manifest V3 extension that bundles
the current BMKL entry as a content script. The local debug collector still
runs through `bmkl dev --debug`, but the app code is delivered by the extension
instead of by a page-injected localhost script.

Exact companion test flow:

```text
1. Run bmkl dev --debug --target <site> --port 5173.
2. In another terminal, run bmkl companion --target <site> --port 5173.
3. Open chrome://extensions in Chromium or Chrome and enable Developer mode.
4. Load dist/bookmarklet/companion-extension as an unpacked extension.
5. Open or reload the strict CSP target page.
6. The companion content script runs automatically when the page matches the target pattern.
7. Click the extension action to rerun the companion on the active tab.
8. Watch terminal events, the localhost debug console, and the BMKL companion overlay.
9. After source changes, rerun bmkl companion and reload the unpacked extension.
```

This does not turn every production page into a safe bookmarklet target. It is
a development companion for the cases where a page policy blocks the
bookmarklet delivery mechanism. The final install strategy still depends on the
target site's browser policy, CSP, and user workflow.

Automated coverage is available through:

```bash
pnpm e2e:debug
```

The E2E runner creates a temporary `vanilla-shadow` app, starts `bmkl dev
--debug`, serves target pages from a different local origin, clicks a real
`javascript:` bookmarklet link in Chromium, builds the companion extension, and
loads it through a persistent Chromium context for the strict `script-src`
fixture. It then removes the temporary app.

## CSP compatibility

```text
Policy shape                         Expected debug behavior
No CSP                               module-loaded, app-mounted, app-run reach the terminal and overlay
connect-src blocks localhost         app can run if script-src allows dev origin; overlay reports collector-blocked-likely
script-src blocks localhost module   debug bookmarklet reports module-load-error; companion can run the bundled content script
strict inline/javascript policy      bookmarklet bootstrap may not run; use the companion extension path for development
```

The automated matrix currently covers `no-csp`, `connect-src-self`,
`script-src-self`, and `companion-script-src-self`. It intentionally treats CSP
as a first-class compatibility surface instead of assuming all target sites
behave like the Vite preview page.

## Cloudflare Pages site

`apps/web` is a Solid + Vite product site. Cloudflare Pages advanced mode is
enabled by shipping `public/_worker.js`, which Vite copies to `dist/_worker.js`.
Static assets are served by `env.ASSETS`, while `/api/project` returns project
metadata.

```bash
pnpm --filter @bmkl/web build
pnpm --filter @bmkl/web pages:dev
pnpm --filter @bmkl/web deploy
```

Advanced mode requires `_worker.js` in the Pages output directory. A TypeScript
worker must be compiled to that filename before deploy.
