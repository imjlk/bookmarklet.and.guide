# `@bmkl/templates`

Official BMKL Vite templates plus the scaffold API used by `bmkl create` and
`create-bmkl`.

```ts
import { createProject, listTemplateInfos } from "@bmkl/templates";

const templates = await listTemplateInfos();
await createProject({ destination: "./my-bookmarklet", template: templates[0].name });
```

Pass `local: true` when working from the BMKL source checkout. The generated
project will use absolute `file:` dependencies plus pnpm overrides for the
prebuilt local packages; published package versions remain the default.

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
