import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

import {
  assertBmklBridgeMessage,
  isBmklBridgeMessage,
  validateBmklBridgeMessage,
} from "../packages/contracts/dist/index.js";
import {
  connectBookmarkletActionBridge,
  createBookmarkletBridge,
  createBookmarkletActionRegistry,
  isBookmarkletBridgeMessage,
} from "../packages/runtime/dist/index.js";

const runtimeSource = await readFile(
  new URL("../packages/runtime/dist/index.js", import.meta.url),
  "utf8",
);
const runtimeModuleUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;

await testBridgeContractParity();
await testBridgeLifecycle();
await testActionValidation();
await testAbortedActionDoesNotPost();
await testBrowserMounts();

console.log("✓ runtime smoke");

function testBridgeContractParity() {
  const valid = {
    type: "bmkl:run-action",
    requestId: "request-1",
    action: "inspect",
    input: undefined,
  };
  const missingInput = {
    type: "bmkl:run-action",
    requestId: "request-1",
    action: "inspect",
  };
  const extraProperty = { ...valid, unexpected: true };

  assert.equal(isBookmarkletBridgeMessage(valid), true);
  assert.equal(isBmklBridgeMessage(valid), true);
  assert.doesNotThrow(() => assertBmklBridgeMessage(valid));

  for (const invalid of [missingInput, extraProperty]) {
    assert.equal(isBookmarkletBridgeMessage(invalid), false);
    assert.equal(isBmklBridgeMessage(invalid), false);
    assert.equal(validateBmklBridgeMessage(invalid).success, false);
    assert.throws(() => assertBmklBridgeMessage(invalid));
  }
}

async function testBridgeLifecycle() {
  assert.throws(
    () =>
      createBookmarkletBridge({
        targetWindow: {},
        targetOrigin: "*",
        receiveWindow: createMockWindow(),
      }),
    /expectedOrigin/,
  );

  const receiveWindow = createMockWindow();
  const targetWindow = {
    postMessage(message) {
      if (message.type !== "bmkl:run-action" || message.action === "never") {
        return;
      }
      queueMicrotask(() => {
        receiveWindow.emit({
          data: {
            type: "bmkl:action-result",
            requestId: message.requestId,
            result: `handled:${message.input}`,
          },
          origin: "https://target.example",
          source: targetWindow,
        });
      });
    },
  };
  const bridge = createBookmarkletBridge({
    targetWindow,
    targetOrigin: "https://target.example",
    receiveWindow,
    timeoutMs: 100,
  });

  assert.equal(await bridge.request("echo", "bmkl"), "handled:bmkl");

  const controller = new AbortController();
  const aborted = bridge.request("never", undefined, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });

  bridge.close();
  assert.equal(receiveWindow.listenerCount(), 0);
}

async function testActionValidation() {
  const registry = createBookmarkletActionRegistry([
    {
      name: "uppercase",
      assertInput(input) {
        if (typeof input !== "string") {
          throw new Error("Expected a string input.");
        }
        return input;
      },
      validateOutput(output) {
        return typeof output === "string"
          ? { success: true, data: output }
          : {
              success: false,
              data: output,
              errors: [{ path: "$input", expected: "string", value: output }],
            };
      },
      run(input) {
        return input.toUpperCase();
      },
    },
    {
      name: "invalid-output",
      assertInput(input) {
        return input;
      },
      validateOutput(output) {
        return {
          success: false,
          data: output,
          errors: [{ path: "$input", expected: "string", value: output }],
        };
      },
      run() {
        return 42;
      },
    },
  ]);

  assert.equal(await registry.run("uppercase", "bmkl"), "BMKL");
  assert.throws(
    () => registry.register(registry.list()[0]),
    /already registered/,
  );
  await assert.rejects(() => registry.run("uppercase", 42), /string input/);
  await assert.rejects(
    () => registry.run("invalid-output", undefined),
    /invalid output/,
  );
}

async function testAbortedActionDoesNotPost() {
  let onMessage;
  let finishAction;
  const posts = [];
  const bridge = {
    close() {},
    onMessage(listener) {
      onMessage = listener;
      return () => {
        onMessage = undefined;
      };
    },
    post(message) {
      posts.push(message);
    },
    request() {
      throw new Error("Not used by this smoke test.");
    },
    targetOrigin: "https://target.example",
  };
  const registry = createBookmarkletActionRegistry([
    {
      name: "slow",
      assertInput(input) {
        return input;
      },
      validateOutput(output) {
        return { success: true, data: output };
      },
      run() {
        return new Promise((resolve) => {
          finishAction = resolve;
        });
      },
    },
  ]);
  const controller = new AbortController();
  connectBookmarkletActionBridge(bridge, registry, {
    signal: controller.signal,
  });

  onMessage(
    {
      type: "bmkl:run-action",
      requestId: "slow-1",
      action: "slow",
      input: undefined,
    },
    {},
  );
  controller.abort();
  finishAction("done");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(posts, []);
}

async function testBrowserMounts() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("data:text/html,<main id='target'>target page</main>");
    await page.evaluate(async (moduleUrl) => {
      globalThis.__BMKL_RUNTIME__ = await import(moduleUrl);
    }, runtimeModuleUrl);

    const result = await page.evaluate(() => {
      const runtime = globalThis.__BMKL_RUNTIME__;

      const pageOwned = document.createElement("div");
      pageOwned.id = "page-owned";
      document.body.appendChild(pageOwned);
      let collisionMessage = "";
      try {
        runtime.mountBookmarkletApp({ id: "page-owned" });
      } catch (error) {
        collisionMessage = String(error);
      }

      const shadow = runtime.mountBookmarkletApp({ id: "shadow-app" });
      const restoredShadow = runtime.mountBookmarkletApp({
        id: "shadow-app",
        reset: false,
      });
      const firstStyle = runtime.installBookmarkletStyles(
        shadow,
        "body { color: red; }",
        'unsafe\"] selector',
      );
      const secondStyle = runtime.installBookmarkletStyles(
        shadow,
        "body { color: blue; }",
        'unsafe\"] selector',
      );

      const iframe = runtime.mountBookmarkletApp({
        id: "iframe-app",
        mode: "iframe",
      });
      const restoredIframe = runtime.mountBookmarkletApp({
        id: "iframe-app",
        mode: "iframe",
        reset: false,
      });
      const iframeSandbox = iframe.iframe?.getAttribute("sandbox") ?? "";

      const output = {
        pageElementRemains: document.getElementById("page-owned") === pageOwned,
        collisionMessage,
        shadowReused:
          shadow.host === restoredShadow.host && shadow.root === restoredShadow.root,
        styleReused:
          firstStyle === secondStyle && secondStyle.textContent?.includes("blue"),
        iframeReused:
          iframe.host === restoredIframe.host && iframe.root === restoredIframe.root,
        iframeConnected: iframe.host.isConnected,
        iframeDocumentAvailable: Boolean(iframe.iframe?.contentDocument),
        iframeSandbox,
      };

      shadow.destroy();
      iframe.destroy();
      return {
        ...output,
        mountsDestroyed:
          !document.getElementById("shadow-app") &&
          !document.getElementById("iframe-app"),
      };
    });

    assert.equal(result.pageElementRemains, true);
    assert.match(result.collisionMessage, /not owned by BMKL/);
    assert.equal(result.shadowReused, true);
    assert.equal(result.styleReused, true);
    assert.equal(result.iframeReused, true);
    assert.equal(result.iframeConnected, true);
    assert.equal(result.iframeDocumentAvailable, true);
    assert.match(result.iframeSandbox, /allow-same-origin/);
    assert.doesNotMatch(result.iframeSandbox, /allow-scripts/);
    assert.equal(result.mountsDestroyed, true);
  } finally {
    await browser.close();
  }
}

function createMockWindow() {
  const listeners = new Set();
  return {
    addEventListener(type, listener) {
      if (type === "message") {
        listeners.add(listener);
      }
    },
    clearTimeout,
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    listenerCount() {
      return listeners.size;
    },
    removeEventListener(type, listener) {
      if (type === "message") {
        listeners.delete(listener);
      }
    },
    setTimeout,
  };
}
