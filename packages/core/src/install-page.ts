import type { BookmarkletBuildConfig, BookmarkletManifest } from "./types.js";

export interface InstallPageOptions {
  config: BookmarkletBuildConfig;
  bookmarkletUrl: string;
  manifest: BookmarkletManifest;
}

export function createInstallPage(options: InstallPageOptions): string {
  const { config, bookmarkletUrl, manifest } = options;
  const title = escapeHtml(`Install ${config.name}`);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        background: #101418;
        color: #f4f7f9;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px;
      }
      main {
        width: min(720px, 100%);
      }
      a.bookmarklet {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 8px;
        background: #f1c75b;
        color: #121212;
        font-weight: 760;
        text-decoration: none;
      }
      code, pre {
        font-family: "SFMono-Regular", Consolas, monospace;
      }
      pre {
        overflow-x: auto;
        padding: 16px;
        border: 1px solid #2a343c;
        border-radius: 8px;
        background: #151b20;
      }
      .meta {
        margin-top: 24px;
        color: #a9b6bf;
      }
    </style>
  </head>
  <body>
    <main>
      <p>Drag this link to your bookmarks bar.</p>
      <h1>${escapeHtml(config.name)}</h1>
      <p>
        <a class="bookmarklet" href="${escapeAttribute(bookmarkletUrl)}">${escapeHtml(config.name)}</a>
      </p>
      <div class="meta">
        <p>Runtime: <code>${config.runtime}</code> / Channel: <code>${config.channel}</code></p>
        <p>App: <code>${escapeHtml(manifest.entry)}</code></p>
      </div>
      <pre>${escapeHtml(bookmarkletUrl)}</pre>
    </main>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
