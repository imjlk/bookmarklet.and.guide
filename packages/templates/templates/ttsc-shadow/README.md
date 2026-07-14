# __BMKL_PROJECT_TITLE__

A reference-stack bookmarklet starter that connects a typed DOM adapter, pure
use case, Shadow DOM UI, BMKL runtime lifecycle, and the complete ttsc toolchain.

Guide: <https://bookmarklet.and.guide/>

## First run

```sh
pnpm install
pnpm dev
```

`pnpm dev` prints a local **Setup** URL. Open it, then drag **BMKL dev** to your
bookmarks bar. That install-once bookmark reloads the current module on each
click while the server is running.

Use `pnpm preview` for the local fixture page. It opens the panel automatically,
and **Open bookmarklet panel** brings it back after you close it.

## Customize

- `src/panel.config.ts`: visible title, eyebrow, and desktop corner placement;
  compact viewports use a full-width bottom inset
- `src/pageSnapshot.ts`: browser-facing adapter that captures typed page data
- `src/snapshotReport.ts`: pure summary and copy-report use case
- `src/renderPanel.ts`: typed presentation and user-action orchestration
- `src/inject.ts`: mount ownership and cache-busted reload cleanup
- `src/style.css`: color, spacing, size, and motion tokens
- `src/copyText.ts`: clipboard behavior and status messages
- `test/snapshotReport.test.ts`: `ttsx`-executed unit tests for the pure use case

## Compiler workflow

```sh
pnpm fix
pnpm format
pnpm test
pnpm emit:types
pnpm graph
```

`typecheck` gates both types and formatting, `fix` applies available ttsc lint
fixes, `format` rewrites the project, `test` executes TypeScript through `ttsx`,
`emit:types` verifies declaration output and path rewriting, and `graph` opens
the dependency graph. Use `pnpm graph:mcp` as the server command for an
MCP-capable coding agent.

The production-reachable modules use `@app/*` imports, so path rewriting is part
of the real build instead of an isolated configuration example. Lint and strip
configuration files are checked against their plugin contracts, and production
smoke tests verify that aliases and debug-only calls do not leak into output.

## Before publishing

Replace `https://example.com/bookmarklet/` in `bookmarklet.config.ts` with the
HTTPS directory that will host the built remote files, then run:

```sh
pnpm verify
```

`verify` runs typecheck, tests, declaration emission, production build, and
`bmkl doctor` in release order. Build artifacts are written to
`dist/bookmarklet/`.
