export async function copyText(value: string, label: string): Promise<string> {
  const text = value.trim();
  if (!text) {
    return `No ${label} is available to copy.`;
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable");
    }
    await navigator.clipboard.writeText(text);
    return `${capitalize(label)} copied.`;
  } catch {
    window.prompt(`Copy ${label}`, text);
    return `Opened the copy fallback for ${label}.`;
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
