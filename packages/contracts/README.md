# `@bmkl/contracts`

Runtime-validated BMKL contracts for bridge messages, manifests, actions, and
debug reports. The validators are generated with typia and are intended for
external JSON boundaries.

```ts
import { assertBmklBridgeMessage } from "@bmkl/contracts";

export function parseBridgeMessage(input: string) {
  return assertBmklBridgeMessage(JSON.parse(input));
}
```

BMKL is currently a source preview and this package is not published to npm
yet. See [bookmarklet.and.guide](https://bookmarklet.and.guide) and the
workspace root README for the supported local workflow.
