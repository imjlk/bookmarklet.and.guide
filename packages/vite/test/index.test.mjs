import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "vite";
import { bmkl } from "../dist/index.js";

test("explicit development origins must be absolute HTTP(S) URLs", () => {
  assert.throws(
    () => bmkl({ devOrigin: "not-a-url" }),
    /Invalid devOrigin URL: not-a-url\. Expected an absolute HTTP\(S\) URL\./,
  );
  assert.throws(
    () => bmkl({ publicOrigin: "ftp://dev.example" }),
    /Invalid publicOrigin URL: ftp:\/\/dev\.example\. Expected an absolute HTTP\(S\) URL\./,
  );
});

test("dev bookmarklet uses the resolved absolute server URL and runs the app API", () => {
  const handler = createMiddleware(
    bmkl({ entry: "src/inject.ts", name: "ExampleBookmarklet" }),
    {
      config: { server: { https: false } },
      resolvedUrls: {
        local: ["http://127.0.0.1:4173/"],
        network: [],
      },
    },
  );
  const response = invoke(handler, {
    headers: { host: "untrusted.example" },
    method: "GET",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  const source = decodeBookmarklet(response.body);
  assert.match(source, /http:\/\/127\.0\.0\.1:4173\/src\/inject\.ts/);
  assert.doesNotMatch(source, /untrusted\.example/);
  assert.match(source, /globalThis\["ExampleBookmarklet"\]/);
  assert.match(source, /typeof a\.run==="function"\)a\.run\(\)/);
});

test("dev bookmarklet uses trusted server config before Vite resolves URLs", () => {
  const handler = createMiddleware(
    bmkl({ entry: "/src/inject.tsx", name: "EarlyApp" }),
    {
      config: { server: { host: "127.0.0.1", https: true, port: 5443 } },
      resolvedUrls: null,
    },
  );
  const response = invoke(handler, {
    headers: { host: "attacker.example" },
    method: "GET",
  });

  assert.match(
    decodeBookmarklet(response.body),
    /https:\/\/127\.0\.0\.1:5443\/src\/inject\.tsx/,
  );
  assert.doesNotMatch(decodeBookmarklet(response.body), /attacker\.example/);
});

test("publicOrigin is normalized to a credential-free origin", () => {
  const handler = createMiddleware(
    bmkl({
      publicOrigin: "https://user:secret@proxy.example/base?token=private",
    }),
    {
      config: { server: { https: false } },
      resolvedUrls: null,
    },
  );
  const source = decodeBookmarklet(
    invoke(handler, { headers: {}, method: "GET" }).body,
  );

  assert.match(source, /https:\/\/proxy\.example\/src\/inject\.ts/);
  assert.doesNotMatch(source, /user|secret|base|private/);
});

test("dev bookmarklet selects the resolved LAN URL matching the request host", () => {
  const handler = createMiddleware(bmkl(), {
    config: { server: { https: false } },
    resolvedUrls: {
      local: ["http://127.0.0.1:5173/"],
      network: ["http://192.168.1.20:5173/"],
    },
  });
  const response = invoke(handler, {
    headers: { host: "192.168.1.20:5173" },
    method: "GET",
  });

  assert.match(
    decodeBookmarklet(response.body),
    /http:\/\/192\.168\.1\.20:5173\/src\/inject\.ts/,
  );
});

test("dev server returns CORS headers for the configured target origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "bmkl-vite-test-"));
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: bmkl({ devOrigin: "https://target.example" }),
    root,
    server: { host: "127.0.0.1", port: 0 },
  });

  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/inject.ts"), "export const ready = true;\n");
    await server.listen();
    const address = server.resolvedUrls?.local[0];
    assert.ok(address);

    const allowed = await fetch(new URL("src/inject.ts", address), {
      headers: { origin: "https://target.example" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://target.example",
    );

    const rejected = await fetch(new URL("src/inject.ts", address), {
      headers: { origin: "https://other.example" },
    });
    assert.equal(
      rejected.headers.get("access-control-allow-origin"),
      "https://target.example",
    );
    assert.notEqual(
      rejected.headers.get("access-control-allow-origin"),
      "https://other.example",
    );
  } finally {
    await server.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("dev bookmarklet handles HEAD without a response body", () => {
  const handler = createMiddleware(bmkl(), {
    config: { server: {} },
    resolvedUrls: { local: ["http://localhost:5173/"], network: [] },
  });
  const response = invoke(handler, { headers: {}, method: "HEAD" });

  assert.equal(response.body, undefined);
});

test("dev bookmarklet delegates unsupported methods", () => {
  const handler = createMiddleware(bmkl(), {
    config: { server: {} },
    resolvedUrls: { local: ["http://localhost:5173/"], network: [] },
  });
  const response = invoke(handler, { headers: {}, method: "POST" });

  assert.equal(response.nextCalled, true);
  assert.equal(response.body, undefined);
});

function createMiddleware(plugins, serverProperties) {
  let handler;
  const plugin = plugins.find((candidate) => candidate.name === "bmkl:vite");
  assert.ok(plugin);
  assert.equal(typeof plugin.configureServer, "function");
  plugin.configureServer({
    ...serverProperties,
    middlewares: {
      use(route, candidate) {
        assert.equal(route, "/__bmkl/dev-bookmarklet");
        handler = candidate;
      },
    },
  });
  assert.equal(typeof handler, "function");
  return handler;
}

function invoke(handler, request) {
  const result = {
    body: undefined,
    headers: {},
    nextCalled: false,
    statusCode: 200,
  };
  const response = {
    get statusCode() {
      return result.statusCode;
    },
    set statusCode(value) {
      result.statusCode = value;
    },
    end(body) {
      result.body = body;
    },
    setHeader(name, value) {
      result.headers[name.toLowerCase()] = value;
    },
  };
  handler(request, response, () => {
    result.nextCalled = true;
  });
  return result;
}

function decodeBookmarklet(body) {
  assert.equal(typeof body, "string");
  assert.match(body, /^javascript:/);
  return decodeURIComponent(body.trim().slice("javascript:".length));
}
