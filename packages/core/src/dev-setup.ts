export interface DevSetupPageOptions {
  appName: string;
  debugConsoleUrl?: string;
  debugLauncherBookmarkletUrl?: string;
  launcherBookmarkletUrl: string;
  target?: string;
}

export function createDevSetupPage(options: DevSetupPageOptions): string {
  const debugInstaller = options.debugLauncherBookmarkletUrl
    ? installRow({
        description: "Collect loader, runtime, and error events while you test the target page.",
        href: options.debugLauncherBookmarkletUrl,
        id: "debug-bookmarklet",
        label: "BMKL debug",
        title: "Debug bookmarklet",
      })
    : "";
  const debugConsole = options.debugConsoleUrl
    ? `<a class="text-link" href="${escapeAttribute(options.debugConsoleUrl)}" target="_blank" rel="noopener noreferrer">Open debug console</a>`
    : "";
  const target = options.target
    ? `<p class="target">Target <code>${escapeHtml(options.target)}</code></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.appName)} · BMKL setup</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0d1517;
        color: #edf7f5;
        --accent: #65e6c4;
        --muted: #9bb0ad;
        --line: rgba(221, 255, 248, 0.14);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100svh;
        padding: clamp(24px, 6vw, 72px);
        background:
          radial-gradient(circle at 80% 0%, rgba(49, 138, 119, 0.2), transparent 34rem),
          #0d1517;
      }
      main { width: min(760px, 100%); margin: 0 auto; }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--accent);
        font: 700 12px/1.2 ui-monospace, "SFMono-Regular", Consolas, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        max-width: 14ch;
        font-size: clamp(36px, 8vw, 72px);
        line-height: 0.96;
        letter-spacing: -0.055em;
      }
      .lede { max-width: 58ch; margin: 22px 0 0; color: var(--muted); line-height: 1.65; }
      .installers { margin-top: clamp(40px, 8vw, 72px); border-top: 1px solid var(--line); }
      .installer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px;
        align-items: center;
        padding: 24px 0;
        border-bottom: 1px solid var(--line);
      }
      h2 { margin: 4px 0 6px; font-size: 19px; }
      .installer p { margin: 0; color: var(--muted); line-height: 1.5; }
      .installer-kicker { color: var(--accent); font: 700 11px/1.2 ui-monospace, monospace; text-transform: uppercase; }
      .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .bookmarklet,
      button {
        min-height: 44px;
        border-radius: 999px;
        padding: 0 17px;
        font: 750 14px/1 inherit;
        cursor: grab;
        transition: transform 150ms ease, background 150ms ease, border-color 150ms ease;
      }
      .bookmarklet {
        display: inline-flex;
        align-items: center;
        background: var(--accent);
        color: #07110f;
        text-decoration: none;
      }
      button {
        border: 1px solid var(--line);
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .bookmarklet:hover,
      button:hover { transform: translateY(-1px); }
      button:hover { border-color: rgba(101, 230, 196, 0.55); }
      .bookmarklet:focus-visible,
      button:focus-visible,
      a:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .instructions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 24px;
        align-items: end;
        margin-top: 30px;
      }
      ol { margin: 0; padding-left: 1.25rem; color: var(--muted); line-height: 1.8; }
      code { color: #d9ffef; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
      .target { margin: 18px 0 0; color: var(--muted); }
      .text-link { color: var(--accent); text-underline-offset: 4px; }
      #copy-status { min-height: 1.5em; margin: 24px 0 0; color: var(--accent); }
      @media (max-width: 640px) {
        .installer,
        .instructions { grid-template-columns: 1fr; align-items: start; }
        .actions { justify-content: flex-start; }
      }
      @media (prefers-reduced-motion: reduce) {
        .bookmarklet,
        button { transition: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">BMKL local setup</p>
      <h1>${escapeHtml(options.appName)}</h1>
      <p class="lede">
        Drag an install-once link to your bookmarks bar. Keep this Vite server running;
        each click will load the latest local module without replacing the bookmark.
      </p>
      <section class="installers" aria-label="Bookmarklet installers">
        ${installRow({
          description: "Load the latest development module into the page you are viewing.",
          href: options.launcherBookmarkletUrl,
          id: "dev-bookmarklet",
          label: "BMKL dev",
          title: "Development bookmarklet",
        })}
        ${debugInstaller}
      </section>
      <div class="instructions">
        <ol>
          <li>Drag BMKL dev or BMKL debug to your bookmarks bar.</li>
          <li>Open the page where the bookmarklet should run.</li>
          <li>Click the bookmark whenever you want to reload the current module.</li>
        </ol>
        ${debugConsole}
      </div>
      ${target}
      <p id="copy-status" role="status" aria-live="polite"></p>
    </main>
    <script>
      document.addEventListener("click", async (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest("button[data-copy]");
        if (!button) return;
        const link = document.getElementById(button.dataset.copy);
        const value = link?.getAttribute("href");
        if (!value) return;
        const status = document.getElementById("copy-status");
        try {
          await navigator.clipboard.writeText(value);
          status.textContent = "Bookmarklet URL copied.";
        } catch {
          try {
            const input = document.createElement("textarea");
            input.value = value;
            document.body.appendChild(input);
            input.select();
            const copied = document.execCommand("copy");
            input.remove();
            if (!copied) throw new Error("Copy command was rejected");
            status.textContent = "Bookmarklet URL copied.";
          } catch {
            status.textContent = "Copy failed. Drag the install link instead.";
          }
        }
      });
    </script>
  </body>
</html>`;
}

function installRow(options: {
  description: string;
  href: string;
  id: string;
  label: string;
  title: string;
}): string {
  return `<article class="installer">
    <div>
      <span class="installer-kicker">Install once</span>
      <h2>${escapeHtml(options.title)}</h2>
      <p>${escapeHtml(options.description)}</p>
    </div>
    <div class="actions">
      <a class="bookmarklet" id="${escapeAttribute(options.id)}" href="${escapeAttribute(options.href)}" draggable="true" title="Drag to your bookmarks bar">Drag ${escapeHtml(options.label)}</a>
      <button type="button" data-copy="${escapeAttribute(options.id)}">Copy URL</button>
    </div>
  </article>`;
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
