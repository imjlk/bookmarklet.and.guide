import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { build as viteBuild, mergeConfig } from "vite";
import type {
  BookmarkletBuildConfig,
  CompanionBuildOptions,
  CompanionBuildResult,
} from "./types.js";
import { addDebugToken, loadOrCreateDebugToken } from "./debug-token.js";
import {
  assertOutputDirFilesystemBoundary,
  ensureDir,
  resolveFrom,
  resolveOutputFile,
  resolveSafeOutputDir,
  writeTextFile,
} from "./path.js";

const COMPANION_CONTENT_FILE = "companion-content.js";
const COMPANION_SERVICE_WORKER_FILE = "service-worker.js";

export async function buildCompanionExtension(
  config: BookmarkletBuildConfig,
  options: CompanionBuildOptions = {},
): Promise<CompanionBuildResult> {
  const outDir = resolveSafeOutputDir(
    config.root,
    options.outDir ?? join(config.outDir, "companion-extension"),
    "Companion output directory",
  );
  const appEntry = resolveFrom(config.root, config.entry);
  const debugConsoleUrl =
    options.debugConsoleUrl ??
    createDefaultDebugConsoleUrl(options.host, options.port);
  const target = normalizeCompanionUrl(options.target, "Companion target");
  const debugConsole = normalizeCompanionUrl(
    debugConsoleUrl,
    "Companion debug console URL",
  );
  const debugToken = await loadOrCreateDebugToken(config.root);
  const authenticatedDebugConsoleUrl = addDebugToken(
    debugConsole.href,
    debugToken,
  );
  const targetMatch = target.matchPattern;

  await assertOutputDirFilesystemBoundary(
    config.root,
    outDir,
    "Companion output directory",
  );
  await rm(outDir, { recursive: true, force: true });
  await ensureDir(outDir);
  const tempDir = await mkdtemp(join(outDir, ".bmkl-companion-"));
  const entryFile = join(tempDir, "entry.ts");
  try {
    await writeTextFile(
      entryFile,
      createCompanionEntry({
        appName: config.name,
        debugConsoleUrl: authenticatedDebugConsoleUrl,
        entry: appEntry,
        globalName: config.globalName,
        target: target.href,
      }),
    );

    const previousBuilderFlag = process.env.BMKL_BUILDER;
    const previousCompanionFlag = process.env.BMKL_COMPANION;
    process.env.BMKL_BUILDER = "1";
    process.env.BMKL_COMPANION = "1";
    try {
      await viteBuild(
        mergeConfig(
          {
            root: config.root,
            configFile: config.vite?.configFile ?? undefined,
          },
          {
            ...(options.quiet ? { logLevel: "silent" as const } : {}),
            build: {
              emptyOutDir: false,
              lib: {
                entry: entryFile,
                name: `${config.globalName}Companion`,
                formats: ["iife"],
                fileName: () => COMPANION_CONTENT_FILE,
              },
              minify: config.vite?.minify ?? "esbuild",
              outDir,
              sourcemap: config.vite?.sourcemap ?? false,
            },
          },
        ),
      );
    } finally {
      if (previousBuilderFlag === undefined) {
        delete process.env.BMKL_BUILDER;
      } else {
        process.env.BMKL_BUILDER = previousBuilderFlag;
      }
      if (previousCompanionFlag === undefined) {
        delete process.env.BMKL_COMPANION;
      } else {
        process.env.BMKL_COMPANION = previousCompanionFlag;
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const manifestPath = resolveOutputFile(
    outDir,
    "manifest.json",
    "Companion manifest",
  );
  const serviceWorkerPath = resolveOutputFile(
    outDir,
    COMPANION_SERVICE_WORKER_FILE,
    "Companion service worker",
  );
  const readmePath = resolveOutputFile(outDir, "README.md", "Companion README");
  await writeTextFile(
    manifestPath,
    `${JSON.stringify(
      createManifest(config, targetMatch, debugConsole.matchPattern),
      null,
      2,
    )}\n`,
  );
  await writeTextFile(serviceWorkerPath, createServiceWorker(target.origin));
  await writeTextFile(
    readmePath,
    createCompanionReadme({
      debugConsoleUrl: authenticatedDebugConsoleUrl,
      outDir,
      targetMatch,
    }),
  );

  return {
    contentScriptPath: join(outDir, COMPANION_CONTENT_FILE),
    debugConsoleUrl: authenticatedDebugConsoleUrl,
    manifestPath,
    outDir,
    targetMatch,
  };
}

function createManifest(
  config: BookmarkletBuildConfig,
  targetMatch: string,
  debugConsoleMatch: string,
): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: `BMKL Companion: ${config.name}`,
    version: "0.1.0",
    description:
      "Development companion for testing BMKL apps on strict CSP target pages.",
    action: {
      default_title: `Run ${config.name} companion`,
    },
    background: {
      service_worker: COMPANION_SERVICE_WORKER_FILE,
      type: "module",
    },
    permissions: ["activeTab", "scripting"],
    host_permissions: Array.from(new Set([targetMatch, debugConsoleMatch])),
    content_scripts: [
      {
        matches: [targetMatch],
        js: [COMPANION_CONTENT_FILE],
        run_at: "document_idle",
      },
    ],
  };
}

function createServiceWorker(targetOrigin: string): string {
  return `const TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) {
    return;
  }

  try {
    if (new URL(tab.url).origin !== TARGET_ORIGIN) {
      return;
    }
  } catch {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["${COMPANION_CONTENT_FILE}"],
  });
});
`;
}

function createCompanionReadme(options: {
  debugConsoleUrl: string;
  outDir: string;
  targetMatch: string;
}): string {
  return `# BMKL Companion Extension

Load this directory as an unpacked Chrome extension:

${options.outDir}

Target match:

${options.targetMatch}

Debug console:

${options.debugConsoleUrl}

The companion bundles your current BMKL entry into the extension. Re-run
\`bmkl companion\` and reload the unpacked extension after changing source code.
`;
}

function createCompanionEntry(options: {
  appName: string;
  debugConsoleUrl: string;
  entry: string;
  globalName: string;
  target: string;
}): string {
  return `import * as entryModule from ${JSON.stringify(options.entry)};

const appName = ${JSON.stringify(options.appName)};
const globalName = ${JSON.stringify(options.globalName)};
const debugConsoleUrl = ${JSON.stringify(options.debugConsoleUrl)};
const target = ${JSON.stringify(options.target)};
try {
  const previousSession = globalThis.__BMKL_DEBUG_SESSION__;
  if (previousSession && typeof previousSession.__bmklCleanup === "function") {
    previousSession.__bmklCleanup();
  }
} catch {}
const sessionId = "bmkl-companion-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
const startedAt = new Date().toISOString();
const events = [];
let eventSeq = 0;
let debugWindow;
let overlayHost;
let statusEl;
let eventsEl;
let collectorBlocked = false;
let active = true;

const debugEventsUrl = (() => {
  const url = new URL(debugConsoleUrl);
  url.pathname = url.pathname.replace(/\\/$/, "") + "/events";
  url.hash = "";
  return url.toString();
})();

const page = () => ({
  url: location.origin + location.pathname,
  title: document.title,
  target,
  mode: "companion",
});

function openConsole() {
  if (!active) {
    return false;
  }
  const url = new URL(debugConsoleUrl);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("origin", location.origin);
  debugWindow = window.open(url.toString(), "bmkl-debug-" + sessionId, "popup,width=980,height=720");
  if (debugWindow) {
    setTimeout(() => replayEventsToConsole(), 250);
    setTimeout(() => replayEventsToConsole(), 1000);
  }
  return Boolean(debugWindow);
}

function postToConsole(event) {
  if (!active) {
    return;
  }
  try {
    debugWindow?.postMessage(event, new URL(debugConsoleUrl).origin);
  } catch {}
}

function replayEventsToConsole() {
  for (const event of events) {
    postToConsole(event);
  }
}

function sendToCollector(event) {
  if (collectorBlocked) {
    return;
  }
  try {
    fetch(debugEventsUrl, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(event),
      keepalive: true,
      mode: "cors",
    }).catch(() => reportCollectorBlocked());
  } catch {
    reportCollectorBlocked();
  }
}

function reportCollectorBlocked() {
  if (collectorBlocked) {
    return;
  }
  collectorBlocked = true;
  emitLocal("collector-blocked-likely", "Companion could not reach the local debug collector", { debugEventsUrl });
}

function emit(type, message, data) {
  if (!active) {
    return;
  }
  const event = createEvent(type, message, data);
  events.push(event);
  if (events.length > 80) {
    events.shift();
  }
  sendToCollector(event);
  postToConsole(event);
  setTimeout(() => postToConsole(event), 250);
  setTimeout(() => postToConsole(event), 1000);
  renderOverlay();
}

function emitLocal(type, message, data) {
  if (!active) {
    return;
  }
  const event = createEvent(type, message, data);
  events.push(event);
  if (events.length > 80) {
    events.shift();
  }
  postToConsole(event);
  setTimeout(() => postToConsole(event), 250);
  renderOverlay();
}

function createEvent(type, message, data) {
  return {
    source: "bmkl-debug",
    eventId: sessionId + "-" + ++eventSeq,
    sessionId,
    startedAt,
    time: new Date().toISOString(),
    type,
    message,
    data,
    page: page(),
  };
}

function errorPayload(error) {
  if (!error) {
    return {};
  }
  return {
    name: error.name,
    message: error.message || String(error),
    stack: error.stack,
  };
}

function installOverlay() {
  const overlayId = "__bmkl_companion__debug_overlay";
  document.getElementById(overlayId)?.remove();
  const host = document.createElement("div");
  host.id = overlayId;
  host.style.position = "fixed";
  host.style.left = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";
  host.style.fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    '<style>' +
    ':host{all:initial;color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '.panel{width:min(390px,calc(100vw - 32px));border:1px solid rgba(20,30,34,.18);border-radius:8px;background:rgba(255,253,246,.96);color:#142125;box-shadow:0 20px 80px rgba(0,0,0,.24);overflow:hidden}' +
    'header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:#203238;color:#fffaf0;font-weight:760}' +
    'main{padding:12px 14px;display:grid;gap:10px}' +
    '.status{font-size:13px;color:#4d625d}' +
    '.events{display:grid;gap:8px;max-height:190px;overflow:auto}' +
    '.event{border-top:1px solid #ded7ca;padding-top:8px;font-size:12px;line-height:1.35}' +
    '.event strong{display:block;color:#8d5d48;margin-bottom:3px}' +
    '.actions{display:flex;flex-wrap:wrap;gap:8px}' +
    'button{min-height:30px;border:0;border-radius:6px;padding:0 9px;background:#203238;color:#fffaf0;font:inherit;font-size:12px;font-weight:720;cursor:pointer}' +
    '</style>' +
    '<section class="panel">' +
    '<header><span>BMKL companion</span><button type="button" data-close>Close</button></header>' +
    '<main><div class="status" data-status></div><div class="actions">' +
    '<button type="button" data-console>Open console</button><button type="button" data-copy>Copy report</button><button type="button" data-rerun>Rerun</button>' +
    '</div><div class="events" data-events></div></main></section>';
  statusEl = shadow.querySelector("[data-status]");
  eventsEl = shadow.querySelector("[data-events]");
  shadow.querySelector("[data-close]")?.addEventListener("click", () => host.remove());
  shadow.querySelector("[data-console]")?.addEventListener("click", () => {
    if (openConsole()) {
      emit("debug-console-open", "Debug console opened");
    } else {
      emit("debug-console-blocked", "Popup was blocked");
    }
  });
  shadow.querySelector("[data-copy]")?.addEventListener("click", () => copyReport());
  shadow.querySelector("[data-rerun]")?.addEventListener("click", () => {
    void runApp();
  });
  document.documentElement.appendChild(host);
  overlayHost = host;
}

function renderOverlay() {
  if (!statusEl || !eventsEl) {
    return;
  }
  const last = events[events.length - 1];
  statusEl.textContent = last ? last.type + ": " + last.message : "ready";
  eventsEl.textContent = "";
  for (const event of events.slice(-8).reverse()) {
    const row = document.createElement("div");
    row.className = "event";
    const title = document.createElement("strong");
    title.textContent = new Date(event.time).toLocaleTimeString() + " " + event.type;
    const body = document.createElement("div");
    body.textContent = event.message || "";
    row.append(title, body);
    eventsEl.append(row);
  }
}

async function copyReport() {
  const report = JSON.stringify({ sessionId, startedAt, page: page(), events }, null, 2);
  try {
    await navigator.clipboard.writeText(report);
    emit("report-copied", "Companion debug report copied");
  } catch {
    emit("report-copy-failed", "Clipboard write failed", { report });
    window.prompt("Copy BMKL companion report", report);
  }
}

async function runApp() {
  const api = globalThis[globalName];
  const run = typeof entryModule.run === "function" ? entryModule.run : api?.run;
  if (typeof run !== "function") {
    emit("app-api-missing", "Companion could not find a run() function", { globalName });
    return;
  }
  try {
    await run();
    emit("app-run", "Companion app run() completed");
  } catch (error) {
    emit("app-run-error", error?.message || "Companion app run() failed", { error: errorPayload(error) });
  }
}

function handleWindowError(event) {
  emit("window-error", event.message || "Uncaught error", {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: errorPayload(event.error),
  });
}

function handleUnhandledRejection(event) {
  const reason = event.reason;
  emit("unhandled-rejection", reason?.message || String(reason), { error: errorPayload(reason) });
}

function cleanup() {
  if (!active) {
    return;
  }
  active = false;
  window.removeEventListener("error", handleWindowError);
  window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  overlayHost?.remove();
  if (globalThis.__BMKL_DEBUG_SESSION__ === debugSession) {
    try {
      delete globalThis.__BMKL_DEBUG_SESSION__;
    } catch {
      globalThis.__BMKL_DEBUG_SESSION__ = undefined;
    }
  }
}

const debugSession = {
  event: emit,
  error(error, phase = "app-error") {
    emit(phase, error?.message || String(error), { error: errorPayload(error) });
  },
  openConsole,
  report() {
    return { sessionId, startedAt, page: page(), events: events.slice() };
  },
  __bmklCleanup: cleanup,
};
globalThis.__BMKL_DEBUG_SESSION__ = debugSession;

window.addEventListener("error", handleWindowError);
window.addEventListener("unhandledrejection", handleUnhandledRejection);

installOverlay();
emit("companion-started", "BMKL companion started", { appName });
void runApp();
`;
}

interface NormalizedCompanionUrl {
  href: string;
  matchPattern: string;
  origin: string;
}

function normalizeCompanionUrl(
  input: string | undefined,
  label: string,
): NormalizedCompanionUrl {
  const value = input?.trim();
  if (!value) {
    throw new Error(`${label} requires a concrete HTTP(S) URL.`);
  }
  if (value === "<all_urls>" || value.includes("*")) {
    throw new Error(`${label} does not allow wildcard or <all_urls> patterns.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be a valid absolute URL: ${value}`, {
      cause: error,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use an http: or https: URL: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials.`);
  }

  return {
    href: url.toString(),
    matchPattern: `${url.protocol}//${url.host}/*`,
    origin: url.origin,
  };
}

function createDefaultDebugConsoleUrl(host = "127.0.0.1", port = 5173): string {
  const normalizedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}/__bmkl/debug`;
}
