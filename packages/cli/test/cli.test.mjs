import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const pathSeparator = process.platform === "win32" ? ";" : ":";

test("build preserves config defaults and deep-merges nested CLI overrides", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const original = runCli(["build", "--json"], {
      cwd: root,
      env: withPath(binDir),
    });

    assert.equal(original.status, 0, original.stderr);
    const originalSummary = JSON.parse(original.stdout);
    assert.equal(originalSummary.runtime, "inline");
    assert.equal(originalSummary.channel, "canary");
    assert.equal(originalSummary.artifacts.some(({ kind }) => kind === "manifest"), false);
    assert.equal(
      originalSummary.artifacts.some(({ kind }) => kind === "install-html"),
      false,
    );
    assert.equal(originalSummary.artifacts.some(({ kind }) => kind === "report"), false);
    assert.ok(
      originalSummary.artifacts.some(
        ({ fileName }) => fileName === "custom-bookmarklet.txt",
      ),
    );
    assert.match(original.stderr, /ttsc fixture output/);
    assert.doesNotMatch(original.stdout, /ttsc fixture output|vite v/i);

    const loaderPath = join(root, "dist/custom/remote/custom-loader.js");
    const remoteBookmarkletPath = join(
      root,
      "dist/custom/remote/custom-bookmarklet.txt",
    );
    assert.match(
      await readFile(loaderPath, "utf8"),
      /https:\/\/cdn\.original\.test\/bookmarklets\/custom-app\.js/,
    );
    await readFile(join(root, "dist/custom/remote/custom-app.js.map"), "utf8");

    const overridden = runCli(
      [
        "build",
        "--json",
        "--base-url=https://cdn.override.test/releases/token=a=b/",
        "--runtime",
        "remote",
      ],
      { cwd: root, env: withPath(binDir) },
    );

    assert.equal(overridden.status, 0, overridden.stderr);
    const overriddenSummary = JSON.parse(overridden.stdout);
    assert.equal(overriddenSummary.runtime, "remote");
    assert.equal(overriddenSummary.channel, "canary");
    assert.ok(
      overriddenSummary.artifacts.some(
        ({ fileName }) => fileName === "custom-bookmarklet.txt",
      ),
    );
    assert.match(
      await readFile(loaderPath, "utf8"),
      /https:\/\/cdn\.override\.test\/releases\/token=a=b\/custom-app\.js/,
    );
    assert.match(
      decodeURIComponent(await readFile(remoteBookmarkletPath, "utf8")),
      /https:\/\/cdn\.override\.test\/releases\/token=a=b\/custom-loader\.js/,
    );
  });
});

test("JSON and raw build modes keep stdout machine-readable", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const jsonResult = runCli(["build", "--json"], {
      cwd: root,
      env: withPath(binDir),
    });
    assert.equal(jsonResult.status, 0, jsonResult.stderr);
    assert.doesNotThrow(() => JSON.parse(jsonResult.stdout));
    assert.doesNotMatch(jsonResult.stdout, /ttsc fixture output|vite v/i);
    assert.match(jsonResult.stderr, /ttsc fixture output/);

    const rawResult = runCli(["build", "--print-bookmarklet"], {
      cwd: root,
      env: withPath(binDir),
    });
    assert.equal(rawResult.status, 0, rawResult.stderr);
    assert.match(rawResult.stdout, /^javascript:[^\n]+\n$/);
    assert.doesNotMatch(rawResult.stdout, /ttsc fixture output|vite v/i);
    assert.match(rawResult.stderr, /ttsc fixture output/);
  });
});

test("JSON mode reports structured errors", () => {
  const result = runCli(["build", "--json", "--runtime", "hybrid"]);

  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    error: {
      message: "Invalid --runtime: hybrid. Choose inline | remote.",
    },
  });
  assert.equal(result.stderr, "");
});

test("inline short-option values preserve additional equals signs", () => {
  const result = runCli(["inspect", "-c=missing=a=b.mjs"]);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /missing=a=b\.mjs/);
});

test("commands reject unknown options, missing values, and extra positionals", async (t) => {
  const cases = [
    [["templates", "--unknown"], /Unknown option: --unknown/],
    [["create", "one", "two"], /Unexpected argument: two/],
    [["build", "--runtime"], /Missing value for --runtime/],
    [["inspect", "extra"], /Unexpected argument: extra/],
    [["install-page", "extra"], /Unexpected argument: extra/],
    [["dev", "--port"], /Missing value for --port/],
    [["companion", "extra"], /Unexpected argument: extra/],
    [["doctor", "extra"], /Unexpected argument: extra/],
    [["contracts", "smoke", "extra"], /Unexpected argument: extra/],
    [["contracts", "unknown"], /Unknown contracts command: unknown/],
    [["build", "--", "--json"], /Unexpected argument: --json/],
    [["--version", "extra"], /Unexpected argument: extra/],
    [["unknown"], /Unknown command: unknown/],
    [
      ["build", "--json=false", "--print-bookmarklet", "--print-bookmarklet"],
      /Option --print-bookmarklet may only be provided once/,
    ],
  ];

  for (const [args, expected] of cases) {
    await t.test(args.join(" "), () => {
      const result = runCli(args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, expected);
    });
  }
});

function runCli(args, { cwd = dirname(cliPath), env = {} } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      BMKL_CWD: cwd,
      BMKL_DEBUG: "",
    },
  });
}

function withPath(binDir) {
  return {
    PATH: `${binDir}${pathSeparator}${process.env.PATH ?? ""}`,
  };
}

async function withBuildProject(useProject) {
  const root = await mkdtemp(join(tmpdir(), "bmkl-cli-test-"));
  const binDir = join(root, "bin");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(root, "src/inject.ts"),
      "export function run() { return 'fixture'; }\n",
    );
    await writeFile(
      join(root, "bookmarklet.config.mjs"),
      `export default {
  name: "cli-fixture",
  entry: "src/inject.ts",
  outDir: "dist/custom",
  runtime: "inline",
  channel: "canary",
  remote: {
    baseUrl: "https://cdn.original.test/bookmarks/../bookmarklets/",
    loaderPath: "custom-loader.js",
    appPath: "custom-app.js",
    manifestPath: "custom-manifest.json",
    cacheBust: false,
  },
  vite: {
    configFile: false,
    minify: false,
    sourcemap: true,
  },
  ttsc: {
    enabled: true,
    prepare: true,
    typecheck: false,
    plugins: false,
  },
  output: {
    bookmarkletFile: "custom-bookmarklet.txt",
    installHtml: false,
    manifest: false,
    report: false,
  },
};
`,
    );
    const ttscPath = join(binDir, process.platform === "win32" ? "ttsc.cmd" : "ttsc");
    await writeFile(
      ttscPath,
      process.platform === "win32"
        ? "@echo ttsc fixture output\r\n"
        : "#!/bin/sh\necho 'ttsc fixture output'\n",
    );
    if (process.platform !== "win32") {
      await chmod(ttscPath, 0o755);
    }

    await useProject({ binDir, root });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
