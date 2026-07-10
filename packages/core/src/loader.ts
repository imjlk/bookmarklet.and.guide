import type { RemoteLoaderOptions } from "./types.js";

export function createRemoteScriptLoader(options: RemoteLoaderOptions): string {
  const src = JSON.stringify(options.src);
  const id = JSON.stringify(options.id);
  const globalName = JSON.stringify(options.globalName);
  const message = JSON.stringify(
    options.onErrorMessage ??
      "Bookmarklet failed to load. The current page CSP may have blocked remote script injection.",
  );
  const cacheBust = options.cacheBust === true;

  return `
(() => {
  const d = document;
  const id = ${id};
  d.getElementById(id)?.remove();

  const s = d.createElement("script");
  s.id = id;
  s.async = true;
  s.src = ${src}${cacheBust ? ` + (${src}.includes("?") ? "&" : "?") + "t=" + Date.now()` : ""};
  s.onload = () => {
    const api = globalThis[${globalName}];
    if (api && typeof api.run === "function") {
      api.run();
    }
  };
  s.onerror = () => {
    alert(${message});
  };
  d.documentElement.appendChild(s);
})();
`.trim();
}

export function createBookmarkletLoader(id: string, loaderUrl: string): string {
  const serializedId = JSON.stringify(id);
  const serializedUrl = JSON.stringify(loaderUrl);

  return `
(() => {
  const d = document;
  const id = ${serializedId};
  d.getElementById(id)?.remove();
  const s = d.createElement("script");
  s.id = id;
  s.async = true;
  s.src = ${serializedUrl} + (${serializedUrl}.includes("?") ? "&" : "?") + "t=" + Date.now();
  s.onerror = () => alert("Bookmarklet loader failed. CSP may have blocked it.");
  d.documentElement.appendChild(s);
})();
`.trim();
}

export function createDevLauncherBookmarkletSource(
  id: string,
  launcherUrl: string,
): string {
  const serializedId = JSON.stringify(id);
  const serializedUrl = JSON.stringify(launcherUrl);

  return `
(() => {
  const d = document;
  const id = ${serializedId};
  d.getElementById(id)?.remove();
  const s = d.createElement("script");
  s.id = id;
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = ${serializedUrl} + (${serializedUrl}.includes("?") ? "&" : "?") + "t=" + Date.now();
  s.onerror = () => alert("BMKL dev launcher failed to load. Is bmkl dev still running on the same host and port?");
  d.documentElement.appendChild(s);
})();
`.trim();
}

export interface DevBookmarkletSourceOptions {
  id: string;
  moduleUrl: string;
  globalName: string;
}

export interface DebugDevBookmarkletSourceOptions extends DevBookmarkletSourceOptions {
  debugConsoleUrl: string;
  target?: string;
}

export function createDevBookmarkletSource(
  id: string,
  moduleUrl: string,
  globalName = "BookmarkletApp",
): string {
  const serializedId = JSON.stringify(id);
  const serializedUrl = JSON.stringify(moduleUrl);
  const serializedGlobalName = JSON.stringify(globalName);

  return `
(() => {
  const d = document;
  const id = ${serializedId};
  d.getElementById(id)?.remove();
  const s = d.createElement("script");
  s.id = id;
  s.type = "module";
  s.src = ${serializedUrl} + (${serializedUrl}.includes("?") ? "&" : "?") + "t=" + Date.now();
  s.onload = () => {
    const api = globalThis[${serializedGlobalName}];
    if (api && typeof api.run === "function") {
      api.run();
    }
  };
  s.onerror = () => alert("BMKL dev module failed to load. Try --https for HTTPS pages.");
  d.documentElement.appendChild(s);
})();
`.trim();
}

export function createDebugDevBookmarkletSource(
  options: DebugDevBookmarkletSourceOptions,
): string {
  const id = JSON.stringify(options.id);
  const moduleUrl = JSON.stringify(options.moduleUrl);
  const globalName = JSON.stringify(options.globalName);
  const debugConsoleUrl = JSON.stringify(options.debugConsoleUrl);
  const target = JSON.stringify(options.target ?? "");

  return `
(() => {
  const d = document;
  const id = ${id};
  const moduleUrl = ${moduleUrl};
  const globalName = ${globalName};
  const debugConsoleUrl = ${debugConsoleUrl};
  const target = ${target};
  const sessionId = "bmkl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const startedAt = new Date().toISOString();
  const events = [];
  let eventSeq = 0;
  const page = () => ({
    url: location.origin + location.pathname,
    title: d.title,
    target,
  });
  let debugWindow;
  let overlayRoot;
  let statusEl;
  let eventsEl;
  let collectorBlocked = false;
  const debugEventsUrl = (() => {
    const url = new URL(debugConsoleUrl);
    url.pathname = url.pathname.replace(/\\/$/, "") + "/events";
    url.search = "";
    return url.toString();
  })();

  function openConsole() {
    const url = debugConsoleUrl + (debugConsoleUrl.includes("?") ? "&" : "?") + "session=" + encodeURIComponent(sessionId) + "&origin=" + encodeURIComponent(location.origin);
    debugWindow = window.open(url, "bmkl-debug-" + sessionId, "popup,width=980,height=720");
    if (debugWindow) {
      setTimeout(() => replayEventsToConsole(), 250);
      setTimeout(() => replayEventsToConsole(), 1000);
    }
    return Boolean(debugWindow);
  }

  function postToConsole(event) {
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
      }).catch(() => {
        reportCollectorBlocked();
      });
    } catch {
      reportCollectorBlocked();
    }
  }

  function reportCollectorBlocked() {
    if (collectorBlocked) {
      return;
    }
    collectorBlocked = true;
    emitLocal("collector-blocked-likely", "Direct localhost collector was blocked; use the console relay or Copy report fallback", { debugEventsUrl });
  }

  function emit(type, message, data) {
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
    const event = {
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
    return event;
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
    const overlayId = id + "__debug_overlay";
    d.getElementById(overlayId)?.remove();
    const host = d.createElement("div");
    host.id = overlayId;
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "2147483647";
    host.style.fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<style>' +
      ':host{all:initial;color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.panel{width:min(390px,calc(100vw - 32px));border:1px solid rgba(20,30,34,.18);border-radius:8px;background:rgba(255,253,246,.96);color:#142125;box-shadow:0 20px 80px rgba(0,0,0,.24);overflow:hidden}' +
      'header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:#18343a;color:#fffaf0;font-weight:760}' +
      'main{padding:12px 14px;display:grid;gap:10px}' +
      '.status{font-size:13px;color:#4d625d}' +
      '.events{display:grid;gap:8px;max-height:190px;overflow:auto}' +
      '.event{border-top:1px solid #ded7ca;padding-top:8px;font-size:12px;line-height:1.35}' +
      '.event strong{display:block;color:#8d5d48;margin-bottom:3px}' +
      '.actions{display:flex;flex-wrap:wrap;gap:8px}' +
      'button{min-height:30px;border:0;border-radius:6px;padding:0 9px;background:#203238;color:#fffaf0;font:inherit;font-size:12px;font-weight:720;cursor:pointer}' +
      '</style>' +
      '<section class="panel">' +
      '<header><span>BMKL debug</span><button type="button" data-close>Close</button></header>' +
      '<main><div class="status" data-status></div><div class="actions">' +
      '<button type="button" data-console>Open console</button><button type="button" data-copy>Copy report</button><button type="button" data-rerun>Reload app</button>' +
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
    shadow.querySelector("[data-rerun]")?.addEventListener("click", () => loadModule());
    d.documentElement.appendChild(host);
    overlayRoot = host;
  }

  function renderOverlay() {
    if (!statusEl || !eventsEl) {
      return;
    }
    const last = events[events.length - 1];
    statusEl.textContent = last ? last.type + ": " + last.message : "ready";
    eventsEl.textContent = "";
    for (const event of events.slice(-8).reverse()) {
      const row = d.createElement("div");
      row.className = "event";
      const title = d.createElement("strong");
      title.textContent = new Date(event.time).toLocaleTimeString() + " " + event.type;
      const body = d.createElement("div");
      body.textContent = event.message || "";
      row.append(title, body);
      eventsEl.append(row);
    }
  }

  async function copyReport() {
    const report = JSON.stringify({ sessionId, startedAt, page: page(), events }, null, 2);
    try {
      await navigator.clipboard.writeText(report);
      emit("report-copied", "Debug report copied");
    } catch {
      emit("report-copy-failed", "Clipboard write failed", { report });
      window.prompt("Copy BMKL debug report", report);
    }
  }

  function runApp() {
    const api = globalThis[globalName];
    if (!api || typeof api.run !== "function") {
      emit("app-api-missing", "Global run() API was not found", { globalName });
      return;
    }
    try {
      api.run();
      emit("app-run", "App run() completed");
    } catch (error) {
      emit("app-run-error", error?.message || "App run() failed", { error: errorPayload(error) });
    }
  }

  function loadModule() {
    d.getElementById(id)?.remove();
    try {
      delete globalThis[globalName];
    } catch {
      globalThis[globalName] = undefined;
    }
    const s = d.createElement("script");
    s.id = id;
    s.type = "module";
    s.crossOrigin = "anonymous";
    s.src = moduleUrl + (moduleUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
    s.onload = () => {
      emit("module-loaded", "Dev module loaded", { moduleUrl });
      runApp();
    };
    s.onerror = () => {
      emit("module-load-error", "Dev module failed to load. Try --https for HTTPS target pages.", { moduleUrl });
    };
    setTimeout(() => {
      if (!globalThis[globalName]) {
        emit("module-timeout", "Global API was not registered within 8 seconds", { globalName });
      }
    }, 8000);
    d.documentElement.appendChild(s);
  }

  globalThis.__BMKL_DEBUG_SESSION__ = {
    event: emit,
    error(error, phase = "app-error") {
      emit(phase, error?.message || String(error), { error: errorPayload(error) });
    },
    openConsole,
    report() {
      return { sessionId, startedAt, page: page(), events: events.slice() };
    },
  };

  window.addEventListener("error", (event) => {
    emit("window-error", event.message || "Uncaught error", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: errorPayload(event.error),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    emit("unhandled-rejection", reason?.message || String(reason), { error: errorPayload(reason) });
  });

  installOverlay();
  if (!openConsole()) {
    emit("debug-console-blocked", "Popup was blocked; use the overlay copy report fallback");
  }

  loadModule();
})();
`.trim();
}
