# __BMKL_PROJECT_NAME__

A compiler-aware bookmarklet starter using ttsc lint, strip, paths, and graph tooling.

Guide: <https://bookmarklet.and.guide/>

## First run

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the real BMKL development flow. Keep it running, then create a
browser bookmark from the printed **Install-once dev bookmarklet** URL. The same
bookmark reloads the current module on each click.

Use `pnpm preview` for the local fixture page; it mounts the panel automatically.

## Before publishing

Replace `https://example.com/bookmarklet/` in `bookmarklet.config.ts` with the
HTTPS directory that will host the built remote files, then run:

```sh
pnpm doctor
pnpm typecheck
pnpm build
```

Build artifacts are written to `dist/bookmarklet/`. Run `pnpm graph` for the
interactive viewer, `pnpm graph:mcp` for an MCP-capable coding agent, or
`pnpm emit:types` to exercise declaration output.
