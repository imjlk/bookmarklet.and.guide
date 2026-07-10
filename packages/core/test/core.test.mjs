import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  BookmarkBuilder,
  buildCompanionExtension,
  createDebugDevBookmarkletSource,
  loadConfig,
  resolveConfig,
} from "../dist/index.js";

test("loadConfig reports the failing config path and preserves the cause", async () => {
  await withProject(async ({ root }) => {
    const configPath = join(root, "broken.config.mjs");
    await writeFile(configPath, 'throw new Error("config exploded");\n');

    await assert.rejects(
      loadConfig({ cwd: root, configFile: configPath }),
      (error) => {
        assert.match(error.message, new RegExp(escapeRegExp(configPath)));
        assert.match(String(error.cause), /config exploded/);
        return true;
      },
    );
  });
});

test("debug loader awaits async runs and replaces global listeners on reinjection", async () => {
  const browser = createBrowserSandbox();
  const source = createDebugDevBookmarkletSource({
    debugConsoleUrl:
      "http://127.0.0.1:5173/__bmkl/debug?existing=1&token=test-token",
    globalName: "CoreTestApp",
    id: "core-test-debug-loader",
    moduleUrl: "http://127.0.0.1:5173/entry.js",
    target: "https://example.com/",
  });

  vm.runInNewContext(source, browser.context);
  const openedConsoleUrl = new URL(browser.openedUrls[0]);
  assert.equal(openedConsoleUrl.searchParams.get("existing"), "1");
  assert.equal(openedConsoleUrl.searchParams.get("token"), "test-token");
  assert.ok(openedConsoleUrl.searchParams.get("session"));
  assert.equal(
    openedConsoleUrl.searchParams.get("origin"),
    "https://example.com",
  );
  const collectedEventUrl = new URL(browser.requests[0]);
  assert.equal(collectedEventUrl.pathname, "/__bmkl/debug/events");
  assert.equal(collectedEventUrl.searchParams.get("existing"), "1");
  assert.equal(collectedEventUrl.searchParams.get("token"), "test-token");

  const firstSession = browser.context.__BMKL_DEBUG_SESSION__;
  const firstRun = deferred();
  browser.context.CoreTestApp = { run: () => firstRun.promise };
  browser.scripts.at(-1).onload();

  assert.equal(hasEvent(firstSession, "app-run"), false);
  firstRun.resolve();
  await flushAsyncWork();
  assert.equal(hasEvent(firstSession, "app-run"), true);

  const rejectedRun = deferred();
  browser.context.CoreTestApp = { run: () => rejectedRun.promise };
  browser.scripts.at(-1).onload();
  rejectedRun.reject(new Error("debug async failure"));
  await flushAsyncWork();
  assert.equal(hasEvent(firstSession, "app-run-error"), true);

  vm.runInNewContext(source, browser.context);
  assert.notEqual(browser.context.__BMKL_DEBUG_SESSION__, firstSession);
  assert.equal(browser.listeners.error.size, 1);
  assert.equal(browser.listeners.unhandledrejection.size, 1);
});

test("dev debug endpoints require the project token shared with companion", async () => {
  await withProject(async ({ config, root }) => {
    const companion = await buildCompanionExtension(config, {
      debugConsoleUrl:
        "http://127.0.0.1:5173/__bmkl/debug?existing=companion",
      outDir: "companion-auth",
      target: "https://example.com/tools",
    });
    const companionConsoleUrl = new URL(companion.debugConsoleUrl);
    const token = companionConsoleUrl.searchParams.get("token");
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(
      companionConsoleUrl.searchParams.get("existing"),
      "companion",
    );

    const tokenPath = join(root, ".bmkl-dev-cert", "debug-token");
    assert.equal((await readFile(tokenPath, "utf8")).trim(), token);
    if (process.platform !== "win32") {
      assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    }

    const port = await getFreePort();
    const dev = await new BookmarkBuilder(config).dev({
      debug: true,
      host: "127.0.0.1",
      port,
      strictPort: true,
      target: "https://example.com/tools",
    });

    try {
      const consoleUrl = new URL(dev.debugConsoleUrl);
      assert.equal(consoleUrl.searchParams.get("token"), token);

      const consoleResponse = await fetch(consoleUrl);
      assert.equal(consoleResponse.status, 200);
      assert.match(await consoleResponse.text(), /debugEventsUrl\.toString\(\)/);

      const missingTokenUrl = new URL(consoleUrl);
      missingTokenUrl.searchParams.delete("token");
      assert.equal((await fetch(missingTokenUrl)).status, 404);

      const invalidTokenUrl = new URL(consoleUrl);
      invalidTokenUrl.searchParams.set("token", "invalid");
      assert.equal((await fetch(invalidTokenUrl)).status, 404);

      const eventsUrl = new URL(consoleUrl);
      eventsUrl.pathname = "/__bmkl/debug/events";
      const eventBody = createDebugEventBody();
      assert.equal(
        (
          await fetch(eventsUrl, {
            body: eventBody,
            headers: { "content-type": "text/plain;charset=utf-8" },
            method: "POST",
          })
        ).status,
        204,
      );
      assert.equal(
        (await fetch(eventsUrl, { method: "OPTIONS" })).status,
        204,
      );

      const invalidEventsUrl = new URL(eventsUrl);
      invalidEventsUrl.searchParams.set("token", "invalid");
      const invalidOptionsResponse = await fetch(invalidEventsUrl, {
        method: "OPTIONS",
      });
      assert.equal(invalidOptionsResponse.status, 404);
      assert.equal(
        invalidOptionsResponse.headers.has("access-control-allow-origin"),
        false,
      );
      assert.equal(
        (
          await fetch(invalidEventsUrl, {
            body: eventBody,
            method: "POST",
          })
        ).status,
        404,
      );

      assert.equal((await fetch(dev.launcherUrl)).status, 200);
      assert.equal((await fetch(dev.debugLauncherUrl)).status, 200);
      const invalidLauncherUrl = new URL(dev.debugLauncherUrl);
      invalidLauncherUrl.searchParams.set("token", "invalid");
      assert.equal((await fetch(invalidLauncherUrl)).status, 404);

      assert.match(decodeBookmarklet(dev.debugBookmarkletUrl), new RegExp(token));
      assert.match(
        decodeBookmarklet(dev.debugLauncherBookmarkletUrl),
        new RegExp(token),
      );
    } finally {
      await dev.close();
    }
  });
});

test("BookmarkBuilder rejects dangerous output paths before deleting files", async () => {
  await withProject(async ({ root, config }) => {
    const projectMarker = join(root, "keep.txt");
    await writeFile(projectMarker, "keep");

    const projectRootConfig = {
      ...config,
      outDir: ".",
    };
    await assert.rejects(
      new BookmarkBuilder(projectRootConfig).build(),
      /cannot be the project root/,
    );
    assert.equal(await readFile(projectMarker, "utf8"), "keep");

    const outsideConfig = {
      ...config,
      outDir: "../outside",
    };
    await assert.rejects(
      new BookmarkBuilder(outsideConfig).build(),
      /must stay inside/,
    );
    assert.equal(await readFile(projectMarker, "utf8"), "keep");

    await assert.rejects(
      new BookmarkBuilder({
        ...config,
        outDir: parse(root).root,
      }).inspect(),
      /cannot be the filesystem root/,
    );
    await assert.rejects(
      new BookmarkBuilder({
        ...config,
        outDir: homedir(),
      }).inspect(),
      /cannot be the home directory/,
    );
  });
});

test("BookmarkBuilder rejects output directories through external symlinks", async (context) => {
  await withProject(async ({ root, config }) => {
    const outside = join(root, "..", "outside");
    const marker = join(outside, "victim", "keep.txt");
    await mkdir(join(outside, "victim"), { recursive: true });
    await writeFile(marker, "keep");

    try {
      await symlink(outside, join(root, "linked-output"), "dir");
    } catch (error) {
      if (error.code === "EPERM") {
        context.skip("Creating directory symlinks requires additional permission.");
        return;
      }
      throw error;
    }

    await assert.rejects(
      new BookmarkBuilder({
        ...config,
        outDir: "linked-output/victim",
      }).build(),
      /must stay inside/,
    );
    assert.equal(await readFile(marker, "utf8"), "keep");
  });
});

test("BookmarkBuilder rejects artifact paths that escape their output directory", async () => {
  await withProject(async ({ root, config }) => {
    const outputMarker = join(root, "dist", "keep.txt");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(outputMarker, "keep");

    const unsafeConfig = {
      ...config,
      remote: {
        ...config.remote,
        loaderPath: "../../escaped-loader.js",
      },
    };

    await assert.rejects(
      new BookmarkBuilder(unsafeConfig).build(),
      /remote\.loaderPath must stay inside/,
    );
    assert.equal(await readFile(outputMarker, "utf8"), "keep");

    await assert.rejects(
      new BookmarkBuilder({
        ...config,
        remote: {
          ...config.remote,
          appPath: "assets/",
        },
      }).build(),
      /must resolve to a file, not a directory/,
    );
  });
});

test("BookmarkBuilder emits nested remote.appPath at the configured location", async () => {
  await withProject(async ({ root, config }) => {
    const nestedConfig = {
      ...config,
      remote: {
        ...config.remote,
        appPath: "assets/app.iife.js",
      },
    };

    const result = await new BookmarkBuilder(nestedConfig).build();
    const expectedPath = join(root, "dist", "remote", "assets", "app.iife.js");

    await access(expectedPath);
    assert.equal(
      result.artifacts.find((artifact) => artifact.kind === "app")?.path,
      expectedPath,
    );
  });
});

test("companion requires a concrete HTTP(S) target without deleting output", async () => {
  await withProject(async ({ root, config }) => {
    const outDir = join(root, "companion");
    const marker = join(outDir, "keep.txt");
    await mkdir(outDir, { recursive: true });
    await writeFile(marker, "keep");

    await assert.rejects(
      buildCompanionExtension(config, {
        outDir: ".",
        target: "https://example.com/",
      }),
      /cannot be the project root/,
    );
    await access(join(root, "entry.js"));

    await assert.rejects(
      buildCompanionExtension(config, { outDir: "companion" }),
      /requires a concrete HTTP\(S\) URL/,
    );
    await assert.rejects(
      buildCompanionExtension(config, {
        outDir: "companion",
        target: "https://*.example.com/*",
      }),
      /does not allow wildcard/,
    );
    await assert.rejects(
      buildCompanionExtension(config, {
        outDir: "companion",
        target: "file:///tmp/page.html",
      }),
      /must use an http: or https: URL/,
    );

    assert.equal(await readFile(marker, "utf8"), "keep");
  });
});

test("companion grants only target/debug origins and reruns only on target origin", async () => {
  await withProject(async ({ root, config }) => {
    const result = await buildCompanionExtension(config, {
      debugConsoleUrl: "http://127.0.0.1:5173/__bmkl/debug",
      outDir: "companion",
      target: "https://example.com/tools/page?mode=debug",
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));

    assert.deepEqual(manifest.host_permissions, [
      "https://example.com/*",
      "http://127.0.0.1:5173/*",
    ]);
    assert.deepEqual(manifest.content_scripts[0].matches, [
      "https://example.com/*",
    ]);

    const outputEntries = await readdir(result.outDir);
    assert.equal(
      outputEntries.some((entry) => entry.startsWith(".bmkl-companion-")),
      false,
    );

    const serviceWorker = await readFile(
      join(result.outDir, "service-worker.js"),
      "utf8",
    );
    let onClicked;
    const injections = [];
    vm.runInNewContext(serviceWorker, {
      URL,
      chrome: {
        action: {
          onClicked: {
            addListener(listener) {
              onClicked = listener;
            },
          },
        },
        scripting: {
          async executeScript(options) {
            injections.push(options);
          },
        },
      },
    });

    assert.equal(typeof onClicked, "function");
    await onClicked({ id: 1, url: "https://attacker.example/" });
    await onClicked({ id: 2, url: "chrome://extensions/" });
    await onClicked({ id: 3, url: "https://example.com/another-page" });

    assert.deepEqual(JSON.parse(JSON.stringify(injections)), [
      {
        target: { tabId: 3 },
        files: ["companion-content.js"],
      },
    ]);

    const companionSource = await readFile(result.contentScriptPath, "utf8");
    const browser = createBrowserSandbox();
    const firstRun = deferred();
    browser.context.__CORE_TEST_RUN__ = () => firstRun.promise;
    vm.runInNewContext(companionSource, browser.context);

    const firstSession = browser.context.__BMKL_DEBUG_SESSION__;
    const companionToken = new URL(result.debugConsoleUrl).searchParams.get(
      "token",
    );
    assert.equal(
      new URL(browser.requests[0]).searchParams.get("token"),
      companionToken,
    );
    assert.equal(hasEvent(firstSession, "app-run"), false);
    firstRun.resolve();
    await flushAsyncWork();
    assert.equal(hasEvent(firstSession, "app-run"), true);

    const rejectedRun = deferred();
    browser.context.__CORE_TEST_RUN__ = () => rejectedRun.promise;
    vm.runInNewContext(companionSource, browser.context);

    const secondSession = browser.context.__BMKL_DEBUG_SESSION__;
    assert.notEqual(secondSession, firstSession);
    assert.equal(browser.listeners.error.size, 1);
    assert.equal(browser.listeners.unhandledrejection.size, 1);
    assert.equal(hasEvent(secondSession, "app-run"), false);

    rejectedRun.reject(new Error("companion async failure"));
    await flushAsyncWork();
    assert.equal(hasEvent(secondSession, "app-run-error"), true);
  });
});

async function withProject(callback) {
  const sandbox = await mkdtemp(join(tmpdir(), "bmkl-core-test-"));
  const root = join(sandbox, "project");
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "entry.js"),
      "export function run() { return globalThis.__CORE_TEST_RUN__?.(); }\nObject.assign(globalThis, { CoreTestApp: { run } });\n",
    );

    const config = resolveConfig(
      {
        entry: "entry.js",
        name: "core-test-app",
        outDir: "dist",
        remote: {
          appPath: "app.iife.js",
          baseUrl: "https://cdn.example.com/bookmarklet/",
          cacheBust: false,
          loaderPath: "loader.js",
          manifestPath: "manifest.json",
        },
        ttsc: {
          enabled: false,
        },
        vite: {
          configFile: false,
          minify: false,
          sourcemap: false,
        },
        output: {
          installHtml: false,
          manifest: false,
          report: false,
        },
      },
      root,
    );

    await callback({ config, root });
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}

function createBrowserSandbox() {
  const listeners = {
    error: new Set(),
    unhandledrejection: new Set(),
  };
  const nodes = new Map();
  const openedUrls = [];
  const requests = [];
  const scripts = [];

  const createNode = (tagName) => {
    const childListeners = new Map();
    const node = {
      children: [],
      className: "",
      id: "",
      removed: false,
      style: {},
      tagName: tagName.toUpperCase(),
      textContent: "",
      addEventListener(type, listener) {
        childListeners.set(type, listener);
      },
      append(...children) {
        this.children.push(...children);
      },
      appendChild(child) {
        this.children.push(child);
        if (child.id) {
          nodes.set(child.id, child);
        }
        if (child.tagName === "SCRIPT") {
          scripts.push(child);
        }
        return child;
      },
      attachShadow() {
        const shadowNodes = new Map();
        return {
          innerHTML: "",
          querySelector(selector) {
            if (!shadowNodes.has(selector)) {
              shadowNodes.set(selector, createNode("div"));
            }
            return shadowNodes.get(selector);
          },
        };
      },
      remove() {
        this.removed = true;
        if (this.id && nodes.get(this.id) === this) {
          nodes.delete(this.id);
        }
      },
      setAttribute() {},
    };
    return node;
  };

  const documentElement = createNode("html");
  const document = {
    documentElement,
    title: "Core test page",
    createElement: createNode,
    getElementById(id) {
      return nodes.get(id) ?? null;
    },
  };
  const window = {
    addEventListener(type, listener) {
      listeners[type]?.add(listener);
    },
    open(url) {
      openedUrls.push(String(url));
      return null;
    },
    prompt() {},
    removeEventListener(type, listener) {
      listeners[type]?.delete(listener);
    },
  };
  const context = {
    Date,
    Math,
    Promise,
    URL,
    console,
    document,
    fetch: async (url) => {
      requests.push(String(url));
      return { ok: true };
    },
    location: {
      origin: "https://example.com",
      pathname: "/tools",
    },
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout: () => 0,
    window,
  };

  return { context, listeners, openedUrls, requests, scripts };
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function hasEvent(session, type) {
  return session.report().events.some((event) => event.type === type);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getFreePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function createDebugEventBody() {
  const now = new Date().toISOString();
  return JSON.stringify({
    source: "bmkl-debug",
    eventId: "debug-token-test",
    sessionId: "debug-token-session",
    startedAt: now,
    time: now,
    type: "debug-token-test",
    message: "authenticated debug event",
    page: {
      url: "https://example.com/tools",
      mode: "bookmarklet",
    },
  });
}

function decodeBookmarklet(bookmarkletUrl) {
  assert.match(bookmarkletUrl, /^javascript:/);
  return decodeURIComponent(bookmarkletUrl.slice("javascript:".length));
}
