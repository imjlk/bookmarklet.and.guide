import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBmklRemoteManifest,
  validateBmklRemoteManifest,
} from "../dist/index.js";

const validManifest = {
  name: "Example",
  version: "1.0.0",
  channel: "latest",
  runtime: "remote",
  ui: "shadow",
  entry: "app.iife.js",
  loader: "loader.js",
  sha256: "0".repeat(64),
  releaseDate: "2026-07-10T00:00:00.000Z",
  compat: {
    runtime: "bmkl@0.1",
    minBrowser: "chrome>=120",
  },
};

test("manifest accepts implemented runtimes", () => {
  assert.equal(assertBmklRemoteManifest(validManifest).runtime, "remote");
  assert.equal(
    assertBmklRemoteManifest({ ...validManifest, runtime: "inline" }).runtime,
    "inline",
  );
});

test("manifest rejects the unimplemented hybrid runtime", () => {
  const result = validateBmklRemoteManifest({
    ...validManifest,
    runtime: "hybrid",
  });

  assert.equal(result.success, false);
  assert.throws(
    () => assertBmklRemoteManifest({ ...validManifest, runtime: "hybrid" }),
    /runtime/,
  );
});
