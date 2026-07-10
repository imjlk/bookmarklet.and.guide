# Releasing BMKL

BMKL packages are not published yet. This checklist keeps the first release
explicit and prevents the website or repository from implying npm availability
before the artifacts exist.

## One-time decisions

- Choose the project license, add the license file, and add the matching SPDX
  identifier to every public package. This is a legal and product decision; do
  not infer it from dependencies or neighboring projects.
- Configure the canonical Git remote. Only then add verified `repository` and
  `bugs` URLs to the public package manifests.
- Confirm npm ownership and availability for `create-bmkl` and every `@bmkl/*`
  package name.
- Route `bookmarklet.and.guide` to the intended Pages deployment and verify that
  it serves the production site with a publicly trusted TLS certificate.
- Decide whether the initial `0.1.0` release should use the `latest` or a
  prerelease dist-tag.

## Release candidate verification

BMKL packages use synchronized versions. Update all public package versions in
one change, then run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm test:templates
pnpm e2e:debug
```

The CI package-tarball smoke job additionally packs the public packages,
installs them into a clean project, runs the public binaries, and scaffolds a
project through the installed `create-bmkl` package:

```bash
./node_modules/.bin/bmkl --version
./node_modules/.bin/bmk --version
./node_modules/.bin/create-bmkl --version
```

Before publishing, inspect each tarball with `pnpm pack --dry-run` or an actual
`pnpm pack --out <path>` run. Confirm that it contains only the declared public
surface, generated `dist` files, package metadata, and the intended templates.

## Publishing order

Internal dependencies must exist in the registry before their dependants are
installed by consumers. Publish a release candidate in dependency order:

1. `@bmkl/contracts`
2. `@bmkl/runtime`
3. `@bmkl/core`
4. `@bmkl/templates`
5. `@bmkl/vite`
6. `@bmkl/cli`
7. `create-bmkl`

Use an explicit dist-tag for the first candidate. After publishing, install
from the registry in an empty directory and repeat the bin and template smoke
checks without workspace overrides.

## Making availability public

Only after registry installation succeeds:

- replace the website's source-checkout commands with npm, pnpm, and bun create
  commands;
- remove the source-preview notice from the website and README;
- verify package pages link back to `https://bookmarklet.and.guide`;
- publish release notes that list supported Node and package-manager versions.

Do not automate `npm publish` until provenance, npm authentication, protected
environments, and rollback ownership have been agreed.
