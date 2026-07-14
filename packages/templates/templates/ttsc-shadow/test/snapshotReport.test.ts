import assert from "node:assert/strict";
import test from "node:test";

import type { PageSnapshot } from "@app/pageSnapshot";
import { formatSnapshotReport, summarizeSnapshot } from "@app/snapshotReport";

const snapshot = {
  href: "https://example.com/guide",
  selectedText: "compiler-aware bookmarklets",
  title: "BMKL Guide",
  wordCount: 42,
} satisfies PageSnapshot;

void test("summarizes a typed page snapshot", () => {
  assert.equal(summarizeSnapshot(snapshot), "42 words on BMKL Guide");
});

void test("formats a copy-ready report with an optional selection", () => {
  assert.equal(
    formatSnapshotReport(snapshot),
    [
      "BMKL Guide",
      "https://example.com/guide",
      "42 words",
      "Selection: compiler-aware bookmarklets",
    ].join("\n"),
  );
  assert.doesNotMatch(formatSnapshotReport({ ...snapshot, selectedText: "" }), /Selection:/);
});
