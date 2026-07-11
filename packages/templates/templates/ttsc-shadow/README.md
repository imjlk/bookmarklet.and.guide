# __BMKL_PROJECT_TITLE__

A compiler-aware bookmarklet starter using ttsc lint, strip, paths, and graph tooling.

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
- `src/renderPanel.ts`: typed panel markup and page-snapshot actions
- `src/inject.ts`: mount ownership and cache-busted reload cleanup
- `src/style.css`: color, spacing, size, and motion tokens
- `src/copyText.ts`: clipboard behavior and status messages

## Compiler workflow

```sh
pnpm fix
pnpm format
pnpm emit:types
pnpm graph
```

`fix` applies available ttsc lint fixes, `format` formats the project,
`emit:types` verifies declaration output and path rewriting, and `graph` opens
the dependency graph. Use `pnpm graph:mcp` with an MCP-capable coding agent.

## Before publishing

Replace `https://example.com/bookmarklet/` in `bookmarklet.config.ts` with the
HTTPS directory that will host the built remote files, then run:

```sh
pnpm doctor
pnpm typecheck
pnpm build
```

Build artifacts are written to `dist/bookmarklet/`.
