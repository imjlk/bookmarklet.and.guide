# `@bmkl/cli`

The `bmkl` command-line interface (`bmk` is an alias) for project creation,
development, production builds, artifact inspection, diagnostics, contracts,
and strict-CSP companion generation.

During source development, use the workspace wrapper:

```bash
pnpm build:packages
pnpm cli -- --help
pnpm cli -- create ./my-bookmarklet --local --template lit-shadow
pnpm cli -- doctor
```

`--local` links the scaffold to the BMKL packages in this checkout. Omit it
after the packages are published.

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for current instructions.
