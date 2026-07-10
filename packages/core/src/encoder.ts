export function compactJavaScript(source: string): string {
  return source.trim();
}

export function toBookmarklet(source: string): string {
  return `javascript:${encodeURIComponent(compactJavaScript(source))}`;
}
