import type { IncomingMessage, ServerResponse } from "node:http";
import { parseBmklDebugEventJson } from "@bmkl/contracts";
import type { ViteDevServer } from "vite";
import { hasValidDebugToken } from "./debug-token.js";

const DEBUG_EVENT_MAX_BODY_BYTES = 1_000_000;
const SEEN_EVENT_ID_LIMIT = 400;
const SEEN_EVENT_ID_RETAIN = 200;

export interface DebugConsoleOptions {
  appName: string;
  token: string;
}

export function installDebugConsoleMiddleware(
  server: ViteDevServer,
  options: DebugConsoleOptions,
): void {
  const seenEventIds = new Set<string>();

  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url ?? "/", "http://bmkl.local");

    if (url.pathname === "/__bmkl/debug") {
      if (!hasValidDebugToken(url, options.token)) {
        sendNotFound(res);
        return;
      }
      sendHtml(res, createDebugConsoleHtml(options));
      return;
    }

    if (url.pathname === "/__bmkl/debug/events") {
      if (!hasValidDebugToken(url, options.token)) {
        sendNotFound(res);
        return;
      }
      setEventCorsHeaders(res);
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("allow", "POST, OPTIONS");
        res.end();
        return;
      }

      void readBody(req, DEBUG_EVENT_MAX_BODY_BYTES)
        .then((body) => {
          logDebugEvent(body, seenEventIds);
          res.statusCode = 204;
          res.end();
        })
        .catch((error) => {
          res.statusCode = isBodyTooLargeError(error) ? 413 : 400;
          res.end();
        });
      return;
    }

    next();
  });
}

function createDebugConsoleHtml(options: DebugConsoleOptions): string {
  const appName = escapeHtml(options.appName);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMKL debug console</title>
    <style>
      :root {
        color: #142125;
        background: #f7f4ec;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-width: 320px; }
      main { display: grid; grid-template-columns: minmax(260px, 0.42fr) 1fr; min-height: 100svh; }
      aside { border-right: 1px solid #d9d2c3; padding: 28px; background: #eee8dc; }
      section { padding: 28px; }
      h1 { margin: 0; font-size: 38px; line-height: 0.95; letter-spacing: 0; }
      h2 { margin: 28px 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 0; color: #8d5d48; }
      p { color: #5d6c68; line-height: 1.5; }
      code, pre { font-family: "SFMono-Regular", Consolas, monospace; }
      button { min-height: 36px; border: 0; border-radius: 8px; padding: 0 12px; background: #18343a; color: #fffaf0; font: inherit; font-weight: 720; cursor: pointer; }
      .meta { display: grid; gap: 10px; margin-top: 28px; }
      .meta div { display: grid; gap: 4px; }
      .meta span { color: #73817c; font-size: 12px; text-transform: uppercase; }
      .meta strong { overflow-wrap: anywhere; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 18px; }
      .status { margin-left: auto; color: #42615c; font-weight: 760; }
      .events { display: grid; border-top: 1px solid #d8d0c0; }
      .event { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 18px; padding: 16px 0; border-bottom: 1px solid #d8d0c0; }
      .event time { color: #8d5d48; font-size: 13px; }
      .event strong { display: block; margin-bottom: 5px; }
      .event p { margin: 0; color: #55635f; }
      .event pre { overflow: auto; max-height: 260px; margin: 10px 0 0; padding: 12px; border-radius: 8px; background: #172429; color: #f8f5ee; font-size: 12px; }
      .empty { padding: 44px 0; color: #65736e; }
      @media (max-width: 800px) {
        main { grid-template-columns: 1fr; }
        aside { border-right: 0; border-bottom: 1px solid #d9d2c3; }
        .event { grid-template-columns: 1fr; gap: 6px; }
      }
    </style>
  </head>
  <body>
    <main>
      <aside>
        <h1>BMKL debug console</h1>
        <p>Receives events from a bookmarklet running inside the target page through direct localhost collection and window.postMessage.</p>
        <div class="meta">
          <div><span>App</span><strong>${appName}</strong></div>
          <div><span>Session</span><strong id="session">waiting</strong></div>
          <div><span>Target</span><strong id="target">waiting for bookmarklet</strong></div>
        </div>
        <h2>Fallback</h2>
        <p>If this page receives nothing, use the in-page BMKL debug overlay and copy its report.</p>
      </aside>
      <section>
        <div class="toolbar">
          <button id="copy" type="button">Copy report</button>
          <button id="clear" type="button">Clear</button>
          <span class="status" id="status">waiting for events</span>
        </div>
        <div class="events" id="events">
          <div class="empty">Run the debug bookmarklet on your target site.</div>
        </div>
      </section>
    </main>
    <script>
      const events = [];
      const seenEventIds = new Set();
      const eventsEl = document.getElementById("events");
      const sessionEl = document.getElementById("session");
      const targetEl = document.getElementById("target");
      const statusEl = document.getElementById("status");
      const allowedOrigin = new URLSearchParams(location.search).get("origin");
      const debugEventsUrl = new URL(location.href);
      debugEventsUrl.pathname = "/__bmkl/debug/events";
      debugEventsUrl.hash = "";
      debugEventsUrl.searchParams.delete("session");
      debugEventsUrl.searchParams.delete("origin");

      window.addEventListener("message", (event) => {
        if (allowedOrigin && event.origin !== allowedOrigin) {
          return;
        }
        const data = event.data;
        if (!isDebugEventLike(data)) {
          return;
        }
        if (data.eventId && seenEventIds.has(data.eventId)) {
          return;
        }
        if (data.eventId) {
          seenEventIds.add(data.eventId);
        }
        events.push(data);
        sessionEl.textContent = data.sessionId || "unknown";
        targetEl.textContent = data.page?.url || "unknown";
        statusEl.textContent = "receiving";
        render();
        fetch(debugEventsUrl.toString(), {
          method: "POST",
          headers: { "content-type": "text/plain;charset=utf-8" },
          body: JSON.stringify(data),
        }).catch(() => {});
      });

      document.getElementById("copy").addEventListener("click", async () => {
        const report = JSON.stringify({ generatedAt: new Date().toISOString(), events }, null, 2);
        await navigator.clipboard.writeText(report);
        statusEl.textContent = "copied report";
      });

      document.getElementById("clear").addEventListener("click", () => {
        events.length = 0;
        render();
        statusEl.textContent = "cleared";
      });

      function render() {
        if (events.length === 0) {
          eventsEl.innerHTML = '<div class="empty">Run the debug bookmarklet on your target site.</div>';
          return;
        }
        eventsEl.textContent = "";
        for (const item of events.slice().reverse()) {
          const row = document.createElement("article");
          row.className = "event";
          const time = document.createElement("time");
          time.textContent = new Date(item.time).toLocaleTimeString();
          const body = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = item.type || "event";
          const message = document.createElement("p");
          message.textContent = item.message || "";
          body.append(title, message);
          if (item.error || item.data) {
            const pre = document.createElement("pre");
            pre.textContent = JSON.stringify(item.error || item.data, null, 2);
            body.append(pre);
          }
          row.append(time, body);
          eventsEl.append(row);
        }
      }

      function isDebugEventLike(value) {
        return Boolean(
          value &&
          value.source === "bmkl-debug" &&
          typeof value.eventId === "string" &&
          typeof value.sessionId === "string" &&
          typeof value.startedAt === "string" &&
          typeof value.time === "string" &&
          typeof value.type === "string" &&
          typeof value.message === "string" &&
          value.page &&
          typeof value.page.url === "string",
        );
      }
    </script>
  </body>
</html>`;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(html);
}

function sendNotFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.end();
}

function setEventCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("vary", "Origin");
}

async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error("BMKL debug event body too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function logDebugEvent(body: string, seenEventIds: Set<string>): void {
  try {
    const event = parseBmklDebugEventJson(body);
    if (event.eventId) {
      if (seenEventIds.has(event.eventId)) {
        return;
      }
      seenEventIds.add(event.eventId);
      trimSeenEventIds(seenEventIds);
    }
    const page = ` ${event.page.url}`;
    const message = event.message ? ` - ${event.message}` : "";
    console.log(`[bmkl debug] ${event.type}${message}${page}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[bmkl debug invalid] ${message}`);
  }
}

function trimSeenEventIds(seenEventIds: Set<string>): void {
  if (seenEventIds.size <= SEEN_EVENT_ID_LIMIT) {
    return;
  }

  for (const eventId of seenEventIds) {
    seenEventIds.delete(eventId);
    if (seenEventIds.size <= SEEN_EVENT_ID_RETAIN) {
      return;
    }
  }
}

function isBodyTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message === "BMKL debug event body too large.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#039;";
    }
  });
}
