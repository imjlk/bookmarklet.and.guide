import type { PageSnapshot } from "@app/pageSnapshot";

export function formatSnapshotReport(snapshot: PageSnapshot): string {
  return [
    snapshot.title || "Untitled page",
    snapshot.href,
    `${snapshot.wordCount} words`,
    snapshot.selectedText ? `Selection: ${snapshot.selectedText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function summarizeSnapshot(snapshot: PageSnapshot): string {
  return `${snapshot.wordCount} words on ${snapshot.title || "untitled page"}`;
}
