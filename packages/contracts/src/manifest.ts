import typia, { type IValidation, type tags } from "typia";

export type BmklRuntime = "inline" | "remote";
export type BmklUiMode = "shadow" | "iframe" | "none";
export type BmklUpdateChannel = "dev" | "canary" | "latest" | "pinned";

export interface BmklRemoteManifest {
  name: string & tags.MinLength<1> & tags.MaxLength<80>;
  version: string & tags.Pattern<"^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.-]+)?$">;
  channel: BmklUpdateChannel;
  runtime: BmklRuntime;
  ui: BmklUiMode;
  entry: string & tags.MinLength<1>;
  loader: string & tags.MinLength<1>;
  sha256: string & tags.Pattern<"^[a-f0-9]{64}$">;
  releaseDate: string & tags.Format<"date-time">;
  compat: {
    runtime: string & tags.MinLength<1>;
    minBrowser: string & tags.MinLength<1>;
  };
}

export function assertBmklRemoteManifest(
  input: unknown,
): BmklRemoteManifest {
  return typia.assertEquals<BmklRemoteManifest>(input);
}

export function validateBmklRemoteManifest(
  input: unknown,
): IValidation<BmklRemoteManifest> {
  return typia.validateEquals<BmklRemoteManifest>(input);
}

export function parseBmklRemoteManifestJson(
  input: string,
): BmklRemoteManifest {
  return assertBmklRemoteManifest(JSON.parse(input));
}

export function stringifyBmklRemoteManifest(
  input: BmklRemoteManifest,
): string {
  return typia.json.stringify<BmklRemoteManifest>(input);
}
