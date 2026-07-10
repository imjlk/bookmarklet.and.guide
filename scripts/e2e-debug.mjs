import { createServer } from "node:http";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = join(root, "apps", "bmkl-debug-e2e-app");
const appName = "bmkl-debug-e2e-app";
const devPort = Number(process.env.BMKL_E2E_DEV_PORT ?? 5273);
const targetPort = Number(process.env.BMKL_E2E_TARGET_PORT ?? 5274);
const targetOrigin = `http://127.0.0.1:${targetPort}`;
const devOrigin = `http://127.0.0.1:${devPort}`;
const keepArtifacts = process.env.BMKL_E2E_KEEP === "1";
const companionExtensionDir = join(
  appDir,
  "dist",
  "bookmarklet",
  "companion-extension",
);

const cases = [
  {
    name: "no-csp",
    path: "/no-csp.html",
    expectedOverlay: ["module-loaded", "app-mounted", "app-run"],
    expectedTerminal: ["module-loaded", "app-mounted", "app-run"],
  },
  {
    name: "connect-src-self",
    path: "/connect-src-self.html",
    csp: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${devOrigin}`,
      "connect-src 'self'",
      "style-src 'self' 'unsafe-inline'",
    ].join("; "),
    disablePopup: true,
    expectedOverlay: [
      "debug-console-blocked",
      "module-loaded",
      "app-mounted",
      "app-run",
      "collector-blocked-likely",
    ],
    expectedTerminal: [],
    forbiddenTerminal: ["app-run"],
  },
  {
    name: "script-src-self",
    path: "/script-src-self.html",
    csp: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      `connect-src 'self' ${devOrigin}`,
      "style-src 'self' 'unsafe-inline'",
    ].join("; "),
    disablePopup: true,
    expectedOverlay: ["debug-console-blocked", "module-load-error"],
    expectedTerminal: ["module-load-error"],
    forbiddenOverlay: ["module-loaded", "app-run"],
  },
];

const childProcesses = new Set();
let targetServer;
let browser;
let extensionContext;
let debugBookmarkletUrl = "";
const devLogs = [];

try {
  await assertBuilt();
  await prepareApp();
  await pnpmInstall();

  targetServer = await startTargetServer();
  const devProcess = await startDebugDevServer();
  await buildCompanionExtension();

  browser = await chromium.launch({ headless: process.env.BMKL_E2E_HEADED !== "1" });
  const context = await browser.newContext();
  context.on("page", (page) => {
    void page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  });

  const results = [];
  for (const testCase of cases) {
    results.push(await runCase(context, testCase));
  }
  results.push(await runCompanionCase());

  printResults(results);
  devProcess.kill("SIGINT");
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (extensionContext) {
    await extensionContext.close().catch(() => {});
  }
  if (targetServer) {
    await new Promise((resolve) => targetServer.close(resolve));
  }
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
  if (!keepArtifacts) {
    await rm(appDir, { recursive: true, force: true });
    await exec("pnpm", ["install"]);
  }
}

async function assertBuilt() {
  const required = [
    "packages/create/dist/index.js",
    "packages/cli/dist/index.js",
    "packages/core/dist/index.js",
  ];
  for (const file of required) {
    try {
      await access(join(root, file));
    } catch {
      throw new Error(`Missing built artifact: ${file}. Run pnpm build before e2e:debug.`);
    }
  }
}

async function prepareApp() {
  await rm(appDir, { recursive: true, force: true });
  await exec("node", [
    join(root, "packages", "create", "dist", "index.js"),
    relative(root, appDir),
    "--template",
    "vanilla-shadow",
    "--force",
  ]);
}

async function pnpmInstall() {
  await exec("pnpm", ["install"]);
}

async function startTargetServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", targetOrigin);
    const testCase = cases.find((item) => item.path === url.pathname);

    if (url.pathname === "/bookmarklet.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(debugBookmarkletUrl);
      return;
    }

    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!testCase) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const headers = { "content-type": "text/html; charset=utf-8" };
    if (testCase.csp) {
      headers["content-security-policy"] = testCase.csp;
    }
    res.writeHead(200, headers);
    res.end(createTargetHtml(testCase));
  });

  server.listen(targetPort, "127.0.0.1");
  await once(server, "listening");
  return server;
}

function createTargetHtml(testCase) {
  const popupPatch = testCase.disablePopup ? "window.open = () => null;" : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BMKL E2E ${escapeHtml(testCase.name)}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f6efe5; color: #15272d; }
      main { min-height: 100svh; display: grid; place-items: center; padding: 40px; }
      section { max-width: 620px; border: 1px solid #d8c9b7; border-radius: 8px; padding: 24px; background: #fffaf2; }
      a { display: inline-flex; min-height: 36px; align-items: center; font-weight: 720; color: #184f57; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${escapeHtml(testCase.name)}</h1>
        <p>This fixture exercises BMKL debug bookmarklets against target-site policy.</p>
        <a id="run-bookmarklet" href="#">Run BMKL debug bookmarklet</a>
      </section>
    </main>
    <script>
      ${popupPatch}
      fetch("/bookmarklet.txt")
        .then((response) => response.text())
        .then((bookmarkletUrl) => {
          document.getElementById("run-bookmarklet").href = bookmarkletUrl.trim();
        });
    </script>
  </body>
</html>`;
}

async function startDebugDevServer() {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      appName,
      "exec",
      "bmkl",
      "dev",
      "--debug",
      "--target",
      `${targetOrigin}/no-csp.html`,
      "--port",
      String(devPort),
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  childProcesses.add(child);

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    for (const line of chunk.split(/\r?\n/)) {
      if (line.includes("[bmkl debug]")) {
        devLogs.push(line.trim());
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() => {
    const match = output.match(/Debug bookmarklet:\s*\n(.*)\n\s*\nTarget-site debug flow:/s);
    if (!match) {
      return false;
    }
    debugBookmarkletUrl = match[1].trim();
    return debugBookmarkletUrl.startsWith("javascript:");
  }, `bmkl dev did not print a debug bookmarklet.\n${output}`);

  await waitForHttp(`${devOrigin}/__bmkl/debug`);
  return child;
}

async function buildCompanionExtension() {
  await exec("pnpm", [
    "--filter",
    appName,
    "exec",
    "bmkl",
    "companion",
    "--target",
    `${targetOrigin}/script-src-self.html`,
    "--port",
    String(devPort),
  ]);
  await access(join(companionExtensionDir, "manifest.json"));
  await access(join(companionExtensionDir, "companion-content.js"));
}

async function runCase(context, testCase) {
  const startLogIndex = devLogs.length;
  const page = await context.newPage();
  const browserMessages = [];
  page.on("console", (message) => {
    browserMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    browserMessages.push(`pageerror: ${error.message}`);
  });

  await page.goto(`${targetOrigin}${testCase.path}`);
  await page.waitForFunction(
    () => document.getElementById("run-bookmarklet")?.getAttribute("href")?.startsWith("javascript:"),
    undefined,
    { timeout: 10000 },
  );
  await page.click("#run-bookmarklet");
  await waitForOverlayEvents(page, testCase.expectedOverlay);

  const overlayText = await readOverlayText(page);
  const caseLogs = devLogs.slice(startLogIndex);
  const failures = [];

  for (const expected of testCase.expectedOverlay) {
    if (!overlayText.includes(expected)) {
      failures.push(`overlay missing ${expected}`);
    }
  }
  for (const forbidden of testCase.forbiddenOverlay ?? []) {
    if (overlayText.includes(forbidden)) {
      failures.push(`overlay unexpectedly contains ${forbidden}`);
    }
  }
  for (const expected of testCase.expectedTerminal ?? []) {
    if (!caseLogs.some((line) => line.includes(`[bmkl debug] ${expected}`))) {
      failures.push(`terminal missing ${expected}`);
    }
  }
  for (const forbidden of testCase.forbiddenTerminal ?? []) {
    if (caseLogs.some((line) => line.includes(`[bmkl debug] ${forbidden}`))) {
      failures.push(`terminal unexpectedly contains ${forbidden}`);
    }
  }

  const result = {
    browserMessages,
    failures,
    logs: caseLogs,
    name: testCase.name,
    overlayText,
  };

  await page.close();

  if (failures.length > 0) {
    throw new Error(formatFailure(result));
  }

  return result;
}

async function runCompanionCase() {
  const startLogIndex = devLogs.length;
  const userDataDir = await mkdtemp(join(tmpdir(), "bmkl-companion-profile-"));
  const browserMessages = [];

  try {
    extensionContext = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: process.env.BMKL_E2E_HEADED !== "1",
      args: [
        `--disable-extensions-except=${companionExtensionDir}`,
        `--load-extension=${companionExtensionDir}`,
      ],
    });
    const serviceWorker =
      extensionContext.serviceWorkers()[0] ??
      (await extensionContext.waitForEvent("serviceworker", { timeout: 10000 }));
    browserMessages.push(`extension service worker: ${serviceWorker.url()}`);

    const page = await extensionContext.newPage();
    page.on("console", (message) => {
      browserMessages.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      browserMessages.push(`pageerror: ${error.message}`);
    });

    await page.goto(`${targetOrigin}/script-src-self.html`);
    await waitForOverlayEvents(page, [
      "companion-started",
      "app-mounted",
      "app-run",
    ]);

    const overlayText = await readOverlayText(page);
    const caseLogs = devLogs.slice(startLogIndex);
    const result = {
      browserMessages,
      failures: [],
      logs: caseLogs,
      name: "companion-script-src-self",
      overlayText,
    };

    for (const expected of ["companion-started", "app-mounted", "app-run"]) {
      if (!overlayText.includes(expected)) {
        result.failures.push(`overlay missing ${expected}`);
      }
      if (!caseLogs.some((line) => line.includes(`[bmkl debug] ${expected}`))) {
        result.failures.push(`terminal missing ${expected}`);
      }
    }
    if (overlayText.includes("module-load-error")) {
      result.failures.push("companion unexpectedly hit module-load-error");
    }

    await page.close();

    if (result.failures.length > 0) {
      throw new Error(formatFailure(result));
    }

    return result;
  } finally {
    if (extensionContext) {
      await extensionContext.close().catch(() => {});
      extensionContext = undefined;
    }
    await rm(userDataDir, { recursive: true, force: true });
  }
}

async function waitForOverlayEvents(page, eventNames) {
  await page.waitForFunction(
    (expected) => {
      const host = document.querySelector('[id$="__debug_overlay"]');
      const text = host?.shadowRoot?.textContent ?? "";
      return expected.every((eventName) => text.includes(eventName));
    },
    eventNames,
    { timeout: 10000 },
  );
}

async function readOverlayText(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[id$="__debug_overlay"]');
    return host?.shadowRoot?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });
}

function printResults(results) {
  for (const result of results) {
    console.log(`✓ ${result.name}`);
    console.log(`  overlay: ${summarizeOverlay(result.overlayText)}`);
    if (result.logs.length > 0) {
      console.log(`  terminal: ${result.logs.join(" | ")}`);
    } else {
      console.log("  terminal: no bmkl debug events");
    }
  }
}

function summarizeOverlay(text) {
  const interesting = [
    "debug-console-blocked",
    "companion-started",
    "collector-blocked-likely",
    "module-load-error",
    "module-loaded",
    "app-mounted",
    "app-run",
  ];
  return interesting.filter((item) => text.includes(item)).join(", ");
}

function formatFailure(result) {
  return [
    `E2E case failed: ${result.name}`,
    `Failures: ${result.failures.join(", ")}`,
    `Overlay: ${result.overlayText}`,
    `Terminal: ${result.logs.join("\n") || "(none)"}`,
    `Browser messages: ${result.browserMessages.join("\n") || "(none)"}`,
  ].join("\n\n");
}

async function exec(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  childProcesses.add(child);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, "exit");
  childProcesses.delete(child);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${code}\n${output}`);
  }
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }, `Timed out waiting for ${url}`);
}

async function waitFor(check, failureMessage, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failureMessage);
}

function escapeHtml(value) {
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
