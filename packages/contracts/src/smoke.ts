import {
  assertBmklBridgeMessage,
  type BmklBridgeMessage,
} from "./bridge.js";
import {
  BMKL_DEBUG_EVENT_SOURCE,
  assertBmklDebugEvent,
  type BmklDebugEvent,
} from "./debug.js";
import {
  assertBmklRemoteManifest,
  type BmklRemoteManifest,
} from "./manifest.js";

export interface BmklContractSmokeResult {
  ok: true;
  bridgeType: BmklBridgeMessage["type"];
  debugEventType: BmklDebugEvent["type"];
  manifestRuntime: BmklRemoteManifest["runtime"];
}

export function runBmklContractSmoke(): BmklContractSmokeResult {
  const now = new Date().toISOString();
  const debugEvent = assertBmklDebugEvent({
    source: BMKL_DEBUG_EVENT_SOURCE,
    eventId: "smoke-1",
    sessionId: "smoke",
    startedAt: now,
    time: now,
    type: "typia-smoke",
    message: "typia contract transform is active",
    page: {
      url: "https://example.com/",
      title: "Example",
      target: "https://example.com/",
    },
  });
  const bridgeMessage = assertBmklBridgeMessage({
    type: "bmkl:ready",
    appId: "smoke",
    capabilities: ["actions"],
  });
  const manifest = assertBmklRemoteManifest({
    name: "Smoke",
    version: "0.1.0",
    channel: "dev",
    runtime: "remote",
    ui: "shadow",
    entry: "app.iife.js",
    loader: "loader.js",
    sha256: "0".repeat(64),
    releaseDate: now,
    compat: {
      runtime: "bmkl@0.1",
      minBrowser: "chrome>=120",
    },
  });

  return {
    ok: true,
    bridgeType: bridgeMessage.type,
    debugEventType: debugEvent.type,
    manifestRuntime: manifest.runtime,
  };
}
