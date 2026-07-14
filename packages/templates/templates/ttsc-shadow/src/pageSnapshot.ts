export interface PageSnapshot {
  href: string;
  selectedText: string;
  title: string;
  wordCount: number;
}

export function readPageSnapshot(doc: Document = document): PageSnapshot {
  const text = doc.body?.innerText ?? "";

  return {
    href: doc.URL,
    selectedText: String(doc.getSelection?.() ?? "").trim(),
    title: doc.title,
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
  };
}
