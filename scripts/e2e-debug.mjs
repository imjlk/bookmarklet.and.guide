import { createServer } from "node:http";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { getPnpmCommand } from "./pnpm-command.mjs";

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
const childCompletions = new WeakMap();
const companionProfileDirs = new Set();
let targetServer;
let browser;
let extensionContext;
let debugBookmarkletUrl = "";
let debugConsoleUrl = "";
const devLogs = [];
let shutdownSignal;

const signalHandlers = new Map(
  ["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      shutdownSignal ??= signal;
      for (const child of childProcesses) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill(signal);
        }
      }
    },
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.once(signal, handler);
}

let primaryError;
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
  await stopChild(devProcess);
} catch (error) {
  primaryError = error;
}

const cleanupErrors = await cleanup();
for (const [signal, handler] of signalHandlers) {
  process.removeListener(signal, handler);
}
if (shutdownSignal) {
  for (const error of cleanupErrors) {
    console.error(`Cleanup warning: ${toErrorMessage(error)}`);
  }
  process.exitCode = shutdownSignal === "SIGINT" ? 130 : 143;
} else if (primaryError) {
  for (const error of cleanupErrors) {
    console.error(`Cleanup warning: ${toErrorMessage(error)}`);
  }
  throw primaryError;
} else if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, "BMKL E2E cleanup failed.");
}

async function cleanup() {
  const errors = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };

  await attempt(async () => {
    if (browser) {
      await browser.close();
      browser = undefined;
    }
  });
  await attempt(async () => {
    if (extensionContext) {
      await extensionContext.close();
      extensionContext = undefined;
    }
  });
  for (const profileDir of companionProfileDirs) {
    await attempt(async () => {
      await rm(profileDir, { recursive: true, force: true });
      companionProfileDirs.delete(profileDir);
    });
  }
  await attempt(async () => {
    if (targetServer) {
      await new Promise((resolve, reject) => {
        targetServer.close((error) => (error ? reject(error) : resolve()));
      });
      targetServer = undefined;
    }
  });

  const childResults = await Promise.allSettled(
    Array.from(childProcesses, (child) => stopChild(child)),
  );
  for (const result of childResults) {
    if (result.status === "rejected") {
      errors.push(result.reason);
    }
  }

  if (!keepArtifacts) {
    await attempt(() => rm(appDir, { recursive: true, force: true }));
    await attempt(() => execPnpm(["install"]));
  }

  return errors;
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
  await execPnpm(["install"]);
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
  const child = spawnTracked(
    process.execPath,
    [
      join(root, "packages", "cli", "dist", "index.js"),
      "dev",
      "--debug",
      "--target",
      `${targetOrigin}/no-csp.html`,
      "--port",
      String(devPort),
    ],
    {
      cwd: appDir,
      env: { ...process.env, BMKL_CWD: appDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  let stdoutBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.includes("[bmkl debug]")) {
        devLogs.push(line.trim());
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await Promise.race([
    waitFor(() => {
      const match = output.match(
        /Debug bookmarklet:\s*\n(.*)\n\s*\nTarget-site debug flow:/s,
      );
      if (!match) {
        return false;
      }
      const debugConsoleMatch = output.match(/Debug console:\s*(\S+)/);
      if (!debugConsoleMatch) {
        return false;
      }
      debugBookmarkletUrl = match[1].trim();
      debugConsoleUrl = debugConsoleMatch[1].trim();
      return (
        debugBookmarkletUrl.startsWith("javascript:") &&
        debugConsoleUrl.startsWith(devOrigin)
      );
    }, `bmkl dev did not print a debug bookmarklet.\n${output}`),
    childCompletion(child).then(
      ({ code, signal }) => {
        throw new Error(
          `bmkl dev exited before startup (${signal ?? code}).\n${output}`,
        );
      },
      (error) => {
        throw new Error("Could not spawn bmkl dev.", { cause: error });
      },
    ),
  ]);

  await waitForHttp(debugConsoleUrl);
  return child;
}

async function buildCompanionExtension() {
  await execPnpm([
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
  throwIfShuttingDown();
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
  throwIfShuttingDown();
  await waitForTerminalEvents(
    startLogIndex,
    testCase.expectedTerminal ?? [],
    testCase.name,
  );

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
  throwIfShuttingDown();
  const startLogIndex = devLogs.length;
  const userDataDir = await mkdtemp(join(tmpdir(), "bmkl-companion-profile-"));
  companionProfileDirs.add(userDataDir);
  const browserMessages = [];
  let result;
  let primaryError;

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
    await waitForTerminalEvents(
      startLogIndex,
      ["companion-started", "app-mounted", "app-run"],
      "companion-script-src-self",
    );

    const overlayText = await readOverlayText(page);
    const caseLogs = devLogs.slice(startLogIndex);
    result = {
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

  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (extensionContext) {
    const context = extensionContext;
    try {
      await context.close();
      if (extensionContext === context) {
        extensionContext = undefined;
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await rm(userDataDir, { recursive: true, force: true });
    companionProfileDirs.delete(userDataDir);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError) {
    for (const error of cleanupErrors) {
      console.error(`Companion cleanup warning: ${toErrorMessage(error)}`);
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Companion E2E cleanup failed.");
  }

  return result;
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

async function waitForTerminalEvents(startIndex, eventNames, caseName) {
  if (eventNames.length === 0) {
    return;
  }

  await waitFor(
    () => {
      const logs = devLogs.slice(startIndex);
      return eventNames.every((eventName) =>
        logs.some((line) => line.includes(`[bmkl debug] ${eventName}`)),
      );
    },
    `Timed out waiting for terminal debug events in ${caseName}: ${eventNames.join(", ")}`,
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
  const child = spawnTracked(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let result;
  try {
    result = await childCompletion(child);
  } catch (error) {
    throw new Error(`Could not spawn ${command}.`, { cause: error });
  }
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.signal ?? result.code}\n${output}`,
    );
  }
}

async function execPnpm(args) {
  const invocation = getPnpmCommand(args);
  await exec(invocation.command, invocation.args);
}

function spawnTracked(command, args, options) {
  const child = spawn(command, args, options);
  childProcesses.add(child);

  const completion = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      childProcesses.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      childProcesses.delete(child);
      resolve({ code, signal });
    });
  });
  void completion.catch(() => {});
  childCompletions.set(child, completion);
  return child;
}

function childCompletion(child) {
  const completion = childCompletions.get(child);
  if (!completion) {
    throw new Error("Missing child process completion tracker.");
  }
  return completion;
}

async function stopChild(child) {
  const completion = childCompletion(child);
  if (child.exitCode !== null || child.signalCode !== null) {
    await completion;
    return;
  }

  child.kill("SIGINT");
  if (await settlesWithin(completion, 5000)) {
    return;
  }

  child.kill("SIGKILL");
  await completion;
}

async function settlesWithin(promise, timeout) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(url) {
  await waitFor(async () => {
    try {
      const response = await fetch(url);
      const ok = response.ok;
      await response.body?.cancel().catch(() => {});
      return ok;
    } catch {
      return false;
    }
  }, `Timed out waiting for ${url}`);
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function waitFor(check, failureMessage, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    throwIfShuttingDown();
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failureMessage);
}

function throwIfShuttingDown() {
  if (shutdownSignal) {
    throw new Error(`BMKL E2E interrupted by ${shutdownSignal}.`);
  }
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
