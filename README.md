# BMKL

BMKL is a Vite-first toolkit for building bookmarklets as real in-page apps:
Vite handles preview and IIFE bundling, while `ttsc` supplies type checks,
graph output, and optional compiler-plugin paths.

Project site: [bookmarklet.and.guide](https://bookmarklet.and.guide)

> **Release status:** BMKL is currently a source preview. `create-bmkl` and the
> `@bmkl/*` packages have not been published to npm, so use the workspace
> commands below. Package-manager create commands are documented as the planned
> post-release interface, not as commands that work today.

Project creation follows the JavaScript package-manager convention through
`create-bmkl`. The project CLI is `bmkl` with a short `bmk` alias.

## Requirements

BMKL development and generated projects require Node.js 22.12 or newer. The
workspace pins pnpm 11.7 through `packageManager`; enable Corepack or install the
matching pnpm release before running workspace commands.

```bash
pnpm install
pnpm build:packages
pnpm cli -- create "$PWD/my-agent" --local --template lit-shadow
cd my-agent
pnpm install
pnpm build
```

`--local` rewrites the generated `@bmkl/*` dependencies and pnpm overrides to
the packages in this checkout. Omit it after the packages are published.

After the first npm release, the same flow is intended to read as:

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
pnpm test
pnpm test:templates
pnpm format
pnpm graph
pnpm graph:mcp
pnpm e2e:debug
```

`pnpm test:templates` packages the local BMKL workspace, creates all six
templates outside the monorepo, verifies that no `workspace:` dependency leaked
into a scaffold, installs the packed packages, and runs each template's
typecheck and production build. Set `BMKL_TEMPLATE_SMOKE_KEEP=1` to retain the
temporary projects after a failure. Individual subprocesses time out after ten
minutes by default; override that limit with
`BMKL_TEMPLATE_SMOKE_STEP_TIMEOUT_MS` when diagnosing slower environments.

Templates include `ttsc --noEmit`, an interactive graph viewer, and a separate
MCP graph-server script. The dedicated `ttsc-shadow` reference stack connects a
typed DOM adapter, pure report use case, `ttsx` tests, Shadow DOM presentation,
BMKL runtime lifecycle, and lint, strip, and path transforms. Ordinary framework
templates do not install those unused compiler plugins. The Vite integration can
opt into `@ttsc/unplugin`, while Solid-based templates leave that transform path
disabled for JSX build compatibility.
`@bmkl/contracts` uses typia as the generated contract layer for external JSON
payloads, including debug events, remote manifests, action envelopes, and iframe
bridge messages. `bmkl doctor` runs a contract smoke check so the typia
transform path fails early when the local compiler setup drifts.

## Templates

```text
lit-shadow           Default TS-first Lit template with Shadow DOM UI
ttsc-shadow          Reference stack from typed DOM input through tests and graph
solid-shadow         Compact Solid UI template for fast overlays
solid-query-shadow   Solid + TanStack Query template for cached async data
react-shadow         React template for component reuse and familiar workflows
vanilla-shadow       Minimal TypeScript template with no UI framework
```

`ttsc-shadow` is the template for trying the complete compiler toolchain
seriously: `@ttsc/lint` gates types and formatting, `ttsx` executes a focused
unit test, `@ttsc/strip` removes debug-only calls from bundled output, and
`@ttsc/paths` rewrites production-reachable aliases and emitted declarations.
Run `pnpm graph` for the interactive viewer or `pnpm graph:mcp` for an
MCP-capable coding agent. It is a bookmarklet reference stack, not a bundled
server or database starter; add remote services only when the product needs them.

TanStack Query stays in its own template so ordinary bookmarklets do not pay for
async cache tooling unless they need refetched page snapshots, API reads, cache
lifetimes, or shared async state.

Generated manifests pin `@bmkl/*` dependencies to the published
`@bmkl/templates` version. BMKL packages therefore use synchronized versions;
the template smoke test fails before scaffolding if workspace package versions
drift. Scaffolds also pin pnpm 11.7.0 so Corepack selects the package-manager
version used by the workspace and CI.

## Commands

```bash
pnpm cli -- create my-agent --local --template lit-shadow
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
preview page. Run these commands from a generated project root:

```bash
pnpm exec bmkl dev --debug --target https://example.com
```

The command prints a local **Setup** URL. Open it and drag the normal or debug
install-once link to your bookmarks bar; a Copy URL action is available when
dragging is inconvenient. The bookmark stays the same while the dev host and
port stay the same, and each click fetches the latest launcher script from the
local dev server. Pass `--print-bookmarklets` only when a script or advanced
workflow needs the raw URLs in the terminal.

Exact test flow:

```text
1. Run pnpm exec bmkl dev --debug --target <site>.
2. Open the printed Setup URL and drag BMKL debug to your bookmarks bar.
3. Open the real target site in your browser.
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

`pnpm exec bmkl companion` builds an unpacked Chrome Manifest V3 extension that bundles
the current BMKL entry as a content script. The local debug collector still
runs through `pnpm exec bmkl dev --debug`, but the app code is delivered by the extension
instead of by a page-injected localhost script.

Exact companion test flow:

```text
1. Run pnpm exec bmkl dev --debug --target <site> --port 5173.
2. In another terminal, run pnpm exec bmkl companion --target <site> --port 5173.
3. Open chrome://extensions in Chromium or Chrome and enable Developer mode.
4. Load dist/bookmarklet/companion-extension as an unpacked extension.
5. Open or reload the strict CSP target page.
6. The companion content script runs automatically when the page matches the target pattern.
7. Click the extension action to rerun the companion on the active tab.
8. Watch terminal events, the localhost debug console, and the BMKL companion overlay.
9. After source changes, rerun pnpm exec bmkl companion and reload the unpacked extension.
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

The deploy command always rebuilds `apps/web/dist` before invoking Wrangler, so
a direct upload cannot accidentally reuse a stale local bundle.

Advanced mode requires `_worker.js` in the Pages output directory. A TypeScript
worker must be compiled to that filename before deploy.

### Production deployment

`.github/workflows/deploy-web.yml` deploys the site after a web-related change
lands on `main`. It also supports a manual run from `main`. The workflow
typechecks and builds the web app, verifies the Pages advanced-mode files, and
then uploads `apps/web/dist` to the `bmkl` Pages project at
`https://bmkl.pages.dev`.
Pull requests use the regular CI build and never receive production credentials.

Complete these one-time setup steps before enabling production deployment:

1. Create the Direct Upload project with `main` as its production branch:

   ```bash
   pnpm --filter @bmkl/web exec wrangler pages project create bmkl \
     --production-branch main
   ```

2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets for the
   repository or its `production` environment. Limit the token to **Account /
   Cloudflare Pages / Edit** for the account that owns the project.
3. In Pages, attach `bookmarklet.and.guide` as a custom domain and finish the
   requested DNS change. The Actions workflow publishes Pages assets; it does
   not move the existing domain automatically.

The workflow pins every action to an immutable commit. Keep the version comments
and SHAs together when updating them. Inspect deploy history before selecting a
prior deployment for rollback in the Cloudflare dashboard:

```bash
pnpm --filter @bmkl/web exec wrangler pages deployment list \
  --project-name bmkl
```

## Package release safeguards

Public packages declare their Node requirement and public scoped-package
access. Their `prepack` lifecycle rebuilds ignored `dist`
artifacts for the package and its workspace dependencies, while the template
matrix installs local tarballs to exercise the
same package boundaries consumers receive. Run `pnpm test`,
`pnpm test:templates`, and `pnpm build` before publishing synchronized package
versions. CI also installs the packed CLI and creator into a clean consumer
directory and executes all three public bins (`bmkl`, `bmk`, and
`create-bmkl`).

Publishing is intentionally not automated yet. A maintainer must first choose
and add the project license, configure the canonical Git remote so repository
and issue URLs are known, confirm npm ownership for every package name, and
complete the checklist in [docs/releasing.md](docs/releasing.md).
