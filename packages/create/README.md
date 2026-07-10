# `create-bmkl`

The package-manager create entrypoint for generating BMKL projects from the
maintained Vite templates.

During source development, run the equivalent workspace command:

```bash
pnpm build:packages
pnpm --filter create-bmkl dev -- ./my-bookmarklet --local --template lit-shadow
```

`--local` links the scaffold to the BMKL packages in this checkout. Omit it
after the packages are published.

BMKL is currently a source preview and this package is not published to npm
yet. The familiar `npm create bmkl` interface becomes available only after the
first registry release. See [bookmarklet.and.guide](https://bookmarklet.and.guide)
and the workspace root README for current instructions.
