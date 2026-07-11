import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

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
  registerBookmarkletApi,
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
await testApiRegistrationValidation();
const browserTypes = { chromium, firefox, webkit };
const requestedBrowsers = (
  process.env.BMKL_RUNTIME_BROWSERS ?? "chromium"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
for (const browserName of requestedBrowsers) {
  const browserType = browserTypes[browserName];
  if (!browserType) {
    throw new Error(
      `Unknown BMKL runtime browser: ${browserName}. Choose chromium, firefox, or webkit.`,
    );
  }
  await testBrowserMounts(browserName, browserType);
}

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
  const validNullInput = { ...valid, input: null };
  const validError = {
    type: "bmkl:error",
    requestId: "request-2",
    message: "failed",
  };
  const invalidCases = [
    missingInput,
    extraProperty,
    { ...valid, requestId: "" },
    { ...valid, action: 42 },
    { type: "bmkl:action-result", requestId: "request-3" },
  ];

  for (const message of [valid, validNullInput, validError]) {
    assert.equal(isBookmarkletBridgeMessage(message), true);
    assert.equal(isBmklBridgeMessage(message), true);
    assert.doesNotThrow(() => assertBmklBridgeMessage(message));
  }

  for (const invalid of invalidCases) {
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

  for (const spoof of [
    { origin: "https://evil.example", source: targetWindow },
    { origin: "https://target.example", source: {} },
  ]) {
    targetWindow.postMessage = (message) => {
      queueMicrotask(() => {
        receiveWindow.emit({
          data: {
            type: "bmkl:action-result",
            requestId: message.requestId,
            result: "spoofed",
          },
          ...spoof,
        });
      });
    };
    await assert.rejects(
      bridge.request("spoof", undefined, { timeoutMs: 20 }),
      /timed out/,
    );
  }

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
  let failAction;
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
      name: "failing",
      assertInput(input) {
        return input;
      },
      validateOutput(output) {
        return { success: true, data: output };
      },
      run() {
        return new Promise((_, reject) => {
          failAction = reject;
        });
      },
    },
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

  const rejectingController = new AbortController();
  connectBookmarkletActionBridge(bridge, registry, {
    signal: rejectingController.signal,
  });
  onMessage(
    {
      type: "bmkl:run-action",
      requestId: "failing-1",
      action: "failing",
      input: undefined,
    },
    {},
  );
  rejectingController.abort();
  failAction(new Error("aborted failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(posts, []);
}

function testApiRegistrationValidation() {
  const valid = {
    id: "runtime-smoke-validation",
    globalName: "__BMKL_API_VALIDATION__",
    run() {},
    destroy() {},
  };

  for (const options of [
    { ...valid, id: "" },
    { ...valid, globalName: "  " },
    { ...valid, run: undefined },
    { ...valid, destroy: null },
  ]) {
    assert.throws(() => registerBookmarkletApi(options), /must be/);
  }

  for (const globalName of [
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "prototype",
    "toString",
  ]) {
    assert.throws(
      () => registerBookmarkletApi({ ...valid, globalName }),
      /unsafe/,
    );
  }

  for (const globalName of [
    "eval",
    "Function",
    "globalThis",
    "Infinity",
    "NaN",
    "undefined",
  ]) {
    const existing = globalThis[globalName];
    assert.throws(
      () => registerBookmarkletApi({ ...valid, globalName }),
      /already defined/,
    );
    assert.equal(globalThis[globalName], existing);
  }

  const undefinedHostName = "__BMKL_RUNTIME_UNDEFINED_HOST_GLOBAL__";
  Object.defineProperty(globalThis, undefinedHostName, {
    value: undefined,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  try {
    assert.throws(
      () =>
        registerBookmarkletApi({
          ...valid,
          globalName: undefinedHostName,
        }),
      /already defined/,
    );
    assert.equal(Object.hasOwn(globalThis, undefinedHostName), true);
    assert.equal(globalThis[undefinedHostName], undefined);
  } finally {
    Reflect.deleteProperty(globalThis, undefinedHostName);
  }
}

async function testBrowserMounts(browserName, browserType) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto("data:text/html,<main id='target'>target page</main>");
    await withTimeout(
      page.evaluate(async (moduleUrl) => {
        globalThis.__BMKL_RUNTIME__ = await import(moduleUrl);
      }, runtimeModuleUrl),
      10_000,
      "runtime module import",
    );

    const result = await withTimeout(
      page.evaluate(() => {
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
            shadow.host === restoredShadow.host &&
            shadow.root === restoredShadow.root,
          styleReused:
            firstStyle === secondStyle && secondStyle.textContent?.includes("blue"),
          iframeReused:
            iframe.host === restoredIframe.host &&
            iframe.root === restoredIframe.root,
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
      }),
      10_000,
      `${browserName} runtime browser assertions`,
    );

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

    const apiHandoff = await withTimeout(
      page.evaluate(async (moduleUrl) => {
        const firstRuntime = await import(`${moduleUrl}#api-first`);
        const secondRuntime = await import(`${moduleUrl}#api-second`);
        const thirdRuntime = await import(`${moduleUrl}#api-third`);
        const fourthRuntime = await import(`${moduleUrl}#api-fourth`);
        const cleanupCalls = [];
        const id = "runtime-smoke-api-handoff";

        const originalGlobalPrototype = Object.getPrototypeOf(globalThis);
        const originalConstructor = globalThis.constructor;
        const originalPrototypeDescriptor = Object.getOwnPropertyDescriptor(
          globalThis,
          "prototype",
        );
        const dangerousErrors = [];
        for (const globalName of ["__proto__", "constructor", "prototype"]) {
          try {
            firstRuntime.registerBookmarkletApi({
              id: `runtime-smoke-dangerous-${globalName}`,
              globalName,
              run() {},
              destroy() {},
            });
          } catch (error) {
            dangerousErrors.push(String(error));
          }
        }
        const dangerousNamesWereSafe =
          dangerousErrors.length === 3 &&
          dangerousErrors.every((message) => message.includes("unsafe")) &&
          Object.getPrototypeOf(globalThis) === originalGlobalPrototype &&
          globalThis.constructor === originalConstructor &&
          JSON.stringify(
            Object.getOwnPropertyDescriptor(globalThis, "prototype"),
          ) === JSON.stringify(originalPrototypeDescriptor);

        const first = firstRuntime.registerBookmarkletApi({
          id,
          globalName: "__BMKL_API_FIRST__",
          run: () => "first",
          destroy: () => cleanupCalls.push("first"),
        });
        const firstGlobalDescriptor = Object.getOwnPropertyDescriptor(
          globalThis,
          "__BMKL_API_FIRST__",
        );
        const firstGlobal =
          globalThis.__BMKL_API_FIRST__ === first.api &&
          firstGlobalDescriptor?.configurable === true &&
          firstGlobalDescriptor.enumerable === true &&
          firstGlobalDescriptor.writable === true;

        const second = secondRuntime.registerBookmarkletApi({
          id,
          globalName: "__BMKL_API_SECOND__",
          run: () => "second",
          destroy: () => cleanupCalls.push("second"),
        });
        const replacement = {
          firstCleaned: cleanupCalls.join(",") === "first",
          oldGlobalRemoved: !("__BMKL_API_FIRST__" in globalThis),
          newGlobalInstalled: globalThis.__BMKL_API_SECOND__ === second.api,
        };

        second.release();
        const releasedGlobalCallable =
          globalThis.__BMKL_API_SECOND__?.run() === "second";
        const third = thirdRuntime.registerBookmarkletApi({
          id,
          globalName: "__BMKL_API_THIRD__",
          run: () => "third",
          destroy: () => cleanupCalls.push("third"),
        });
        const releasedApiWasNotCleaned = !cleanupCalls.includes("second");

        third.release();
        second.activate();
        const reactivatedGlobal = globalThis.__BMKL_API_SECOND__ === second.api;
        const fourth = fourthRuntime.registerBookmarkletApi({
          id,
          globalName: "__BMKL_API_FOURTH__",
          run: () => "fourth",
          destroy: () => cleanupCalls.push("fourth"),
        });
        const reactivatedApiWasCleaned = cleanupCalls.includes("second");

        const releasedFirst = thirdRuntime.registerBookmarkletApi({
          id: "runtime-smoke-api-released-same-name",
          globalName: "__BMKL_API_RELEASED_SAME_NAME__",
          run: () => "released-first",
          destroy: () => cleanupCalls.push("released-first"),
        });
        const ownershipDescriptor = Object.getOwnPropertyDescriptor(
          releasedFirst.api,
          Symbol.for(
            "@bmkl/runtime/bookmarklet-api-registration:api-ownership",
          ),
        );
        releasedFirst.release();
        const releasedSecond = fourthRuntime.registerBookmarkletApi({
          id: "runtime-smoke-api-released-same-name",
          globalName: "__BMKL_API_RELEASED_SAME_NAME__",
          run: () => "released-second",
          destroy: () => cleanupCalls.push("released-second"),
        });
        const releasedSameNameWasHandedOff =
          !cleanupCalls.includes("released-first") &&
          globalThis.__BMKL_API_RELEASED_SAME_NAME__ === releasedSecond.api &&
          globalThis.__BMKL_API_RELEASED_SAME_NAME__.run() === "released-second" &&
          ownershipDescriptor?.enumerable === false;
        releasedSecond.release();

        const collisionCleanupCalls = [];
        const collisionPrevious = firstRuntime.registerBookmarkletApi({
          id: "runtime-smoke-api-host-collision",
          globalName: "__BMKL_API_COLLISION_PREVIOUS__",
          run: () => "collision-previous",
          destroy: () => collisionCleanupCalls.push("previous"),
        });
        const hostGlobal = { owner: "host-page" };
        Object.defineProperty(globalThis, "__BMKL_API_HOST_GLOBAL__", {
          value: hostGlobal,
          configurable: true,
          enumerable: true,
          writable: true,
        });
        let hostCollisionMessage = "";
        try {
          secondRuntime.registerBookmarkletApi({
            id: "runtime-smoke-api-host-collision",
            globalName: "__BMKL_API_HOST_GLOBAL__",
            run() {},
            destroy: () => collisionCleanupCalls.push("incoming"),
          });
        } catch (error) {
          hostCollisionMessage = String(error);
        }
        const hostCollisionWasPreserved =
          hostCollisionMessage.includes("already defined") &&
          globalThis.__BMKL_API_HOST_GLOBAL__ === hostGlobal &&
          globalThis.__BMKL_API_COLLISION_PREVIOUS__ === collisionPrevious.api &&
          collisionCleanupCalls.length === 0;

        const protectedGlobalValue = { owner: "page" };
        firstRuntime.registerBookmarkletApi({
          id: "runtime-smoke-api-identity",
          globalName: "__BMKL_API_PROTECTED__",
          run() {},
          destroy: () => cleanupCalls.push("protected"),
        });
        globalThis.__BMKL_API_PROTECTED__ = protectedGlobalValue;
        secondRuntime.registerBookmarkletApi({
          id: "runtime-smoke-api-identity",
          globalName: "__BMKL_API_PROTECTED_NEXT__",
          run() {},
          destroy() {},
        });
        const pageGlobalWasPreserved =
          globalThis.__BMKL_API_PROTECTED__ === protectedGlobalValue;

        const previousDebugSession = globalThis.__BMKL_DEBUG_SESSION__;
        const previousConsoleError = console.error;
        const reportedErrors = [];
        let consoleErrorCount = 0;
        try {
          globalThis.__BMKL_DEBUG_SESSION__ = {
            event() {},
            error(error, phase) {
              reportedErrors.push({ error: String(error), phase });
            },
          };
          console.error = () => {
            consoleErrorCount += 1;
          };
          const failing = firstRuntime.registerBookmarkletApi({
            id: "runtime-smoke-api-errors",
            globalName: "__BMKL_API_FAILING__",
            run() {},
            destroy() {
              throw new Error("expected cleanup failure");
            },
          });
          secondRuntime.registerBookmarkletApi({
            id: "runtime-smoke-api-errors",
            globalName: "__BMKL_API_AFTER_FAILURE__",
            run() {},
            destroy() {},
          });
          if (globalThis.__BMKL_API_FAILING__ === failing.api) {
            throw new Error("The failing API global was not handed off.");
          }
        } finally {
          console.error = previousConsoleError;
          if (previousDebugSession === undefined) {
            delete globalThis.__BMKL_DEBUG_SESSION__;
          } else {
            globalThis.__BMKL_DEBUG_SESSION__ = previousDebugSession;
          }
        }

        fourth.release();
        return {
          firstGlobal,
          dangerousNamesWereSafe,
          replacement,
          releasedGlobalCallable,
          releasedApiWasNotCleaned,
          thirdGlobalStillCallable:
            globalThis.__BMKL_API_THIRD__?.run() === "third",
          reactivatedGlobal,
          reactivatedApiWasCleaned,
          activeGlobal: globalThis.__BMKL_API_FOURTH__ === fourth.api,
          inactiveThirdWasNotCleaned: !cleanupCalls.includes("third"),
          handoffCleanupCalls: cleanupCalls.filter((name) =>
            ["first", "second", "third", "fourth"].includes(name),
          ),
          pageGlobalWasPreserved,
          releasedSameNameWasHandedOff,
          hostCollisionWasPreserved,
          cleanupErrorReported:
            reportedErrors.length === 1 &&
            reportedErrors[0].phase === "api-handoff-cleanup" &&
            consoleErrorCount === 1,
        };
      }, runtimeModuleUrl),
      10_000,
      `${browserName} runtime API handoff assertions`,
    );

    assert.equal(apiHandoff.firstGlobal, true);
    assert.equal(apiHandoff.dangerousNamesWereSafe, true);
    assert.equal(apiHandoff.replacement.firstCleaned, true);
    assert.equal(apiHandoff.replacement.oldGlobalRemoved, true);
    assert.equal(apiHandoff.replacement.newGlobalInstalled, true);
    assert.equal(apiHandoff.releasedGlobalCallable, true);
    assert.equal(apiHandoff.releasedApiWasNotCleaned, true);
    assert.equal(apiHandoff.thirdGlobalStillCallable, true);
    assert.equal(apiHandoff.reactivatedGlobal, true);
    assert.equal(apiHandoff.reactivatedApiWasCleaned, true);
    assert.equal(apiHandoff.activeGlobal, true);
    assert.equal(apiHandoff.inactiveThirdWasNotCleaned, true);
    assert.deepEqual(apiHandoff.handoffCleanupCalls, ["first", "second"]);
    assert.equal(apiHandoff.pageGlobalWasPreserved, true);
    assert.equal(apiHandoff.releasedSameNameWasHandedOff, true);
    assert.equal(apiHandoff.hostCollisionWasPreserved, true);
    assert.equal(apiHandoff.cleanupErrorReported, true);
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

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
