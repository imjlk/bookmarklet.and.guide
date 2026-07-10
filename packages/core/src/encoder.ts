/**
 * Removes leading and trailing whitespace from JavaScript already emitted by
 * Vite. This is a lightweight bookmarklet post-processing step, not a minifier.
 */
export function compactJavaScript(source: string): string {
  return source.trim();
}

export function toBookmarklet(source: string): string {
  return `javascript:${encodeURIComponent(compactJavaScript(source))}`;
}
