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

    const plain = runCli(["build"], {
      cwd: root,
      env: withPath(binDir),
    });
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(
      plain.stdout,
      /Bookmarklet file: dist[\\/]custom[\\/]remote[\\/]custom-bookmarklet\.txt/,
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

test("build prepares the configured ttsc project before bundling", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const marker = join(root, "ttsc-args.txt");
    const result = runCli(["build", "--json"], {
      cwd: root,
      env: { ...withPath(binDir), BMKL_TTSC_MARKER: marker },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      (await readFile(marker, "utf8")).trim(),
      "prepare --project tsconfig.json",
    );
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

test("transport separators preserve structured JSON errors", () => {
  const result = runCli(["--", "build", "--json", "--runtime", "hybrid"]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(
    JSON.parse(result.stdout).error.message,
    "Invalid --runtime: hybrid. Choose inline | remote.",
  );
});

test("reported CLI version comes from package metadata", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const result = runCli(["--version"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("root help stays scannable and points to detailed command help", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /bmkl templates/);
  assert.match(result.stdout, /bmkl <command> --help/);
  assert.doesNotMatch(result.stdout, /Best for:|After npm publication/);
});

for (const bootstrapAgent of ["npm/11.0.0", "bun/1.2.0", "yarn/4.0.0"]) {
  test(`bmkl create reports pinned pnpm commands under ${bootstrapAgent}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bmkl-cli-create-test-"));
    try {
      const result = runCli(
        ["create", "app", "--template", "vanilla-shadow"],
        { cwd: root, env: { npm_config_user_agent: bootstrapAgent } },
      );
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(
        await readFile(join(root, "app", "package.json"), "utf8"),
      );
      assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
      assert.match(result.stdout, /Package manager: pnpm@\d+\.\d+\.\d+/);
      for (const command of [
        "pnpm install",
        "pnpm dev",
        "pnpm build",
        "pnpm inspect",
      ]) {
        assert.match(result.stdout, new RegExp(`  ${command}`));
      }
      assert.doesNotMatch(result.stdout, /  (?:bun|npm|yarn) /);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}

test("bmkl create local mode emits installable source-package overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "bmkl-cli-local-create-test-"));
  try {
    const result = runCli(
      ["create", "app", "--local", "--json", "--template", "vanilla-shadow"],
      { cwd: root },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).dependencyMode, "local");
    const manifest = JSON.parse(
      await readFile(join(root, "app", "package.json"), "utf8"),
    );
    assert.match(manifest.dependencies["@bmkl/runtime"], /^file:/);
    assert.match(manifest.devDependencies["@bmkl/cli"], /^file:/);
    const workspace = await readFile(
      join(root, "app", "pnpm-workspace.yaml"),
      "utf8",
    );
    assert.match(workspace, /"@bmkl\/contracts": "file:/);
    assert.match(workspace, /"@bmkl\/templates": "file:/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bmkl create quotes its destination and explains a missing pnpm prerequisite", async () => {
  const root = await mkdtemp(join(tmpdir(), "bmkl-cli-create-path-test-"));
  const destination = "project's panel";
  try {
    const result = runCli(
      ["create", destination, "--template", "vanilla-shadow"],
      {
        cwd: root,
        env: { PATH: "", npm_config_user_agent: "npm/11.0.0" },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const changeDirectory =
      process.platform === "win32"
        ? "Set-Location -LiteralPath 'project''s panel'"
        : "cd 'project'\"'\"'s panel'";
    assert.match(result.stdout, new RegExp(`  ${escapeRegExp(changeDirectory)}`));
    assert.match(result.stdout, /Prerequisite: install or enable pnpm@/);
    await readFile(join(root, destination, "package.json"), "utf8");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bmkl create prints a usable cd path for a dash-leading directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "bmkl-cli-create-dash-test-"));
  try {
    const result = runCli(["create", "--", "-panel"], { cwd: root });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      process.platform === "win32"
        ? /  Set-Location -LiteralPath '-panel'/
        : /  cd \.\/-panel/,
    );
    await readFile(join(root, "-panel", "package.json"), "utf8");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("install-page fails before building when output is disabled", async () => {
  await withBuildProject(async ({ root }) => {
    const marker = join(root, "dist", "custom", "keep.txt");
    await mkdir(join(root, "dist", "custom"), { recursive: true });
    await writeFile(marker, "keep\n");

    const result = runCli(["install-page", "--json"], { cwd: root });

    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(
      JSON.parse(result.stdout).error.message,
      "Install page output is disabled. Set output.installHtml to true in the bookmarklet config.",
    );
    assert.equal(await readFile(marker, "utf8"), "keep\n");
  });
});

test("doctor skips disabled ttsc checks and ignores remote config for inline runtime", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const configPath = join(root, "doctor-inline.config.mjs");
    const marker = join(root, "ttsc-ran.txt");
    await writeFile(
      configPath,
      `export default {
  name: "doctor-inline",
  entry: "src/inject.ts",
  outDir: "dist/doctor-inline",
  runtime: "inline",
  ttsc: { enabled: false },
  output: { installHtml: false, manifest: false, report: false },
};
`,
    );

    const result = runCli(
      ["doctor", "--json", "--config", configPath],
      {
        cwd: root,
        env: { ...withPath(binDir), BMKL_TTSC_MARKER: marker },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(findCheck(report, "ttsc-project"), {
      name: "ttsc-project",
      status: "pass",
      message: "ttsc checks are disabled",
    });
    assert.deepEqual(findCheck(report, "ttsc-binary"), {
      name: "ttsc-binary",
      status: "pass",
      message: "ttsc checks are disabled",
    });
    assert.equal(findCheck(report, "remote-base-url").status, "pass");
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
  });
});

test("doctor executes the project-local ttsc launcher", async () => {
  await withBuildProject(async ({ root }) => {
    await writeFile(
      join(root, "node_modules", "ttsc", "fixture.mjs"),
      "console.error('broken ttsc fixture'); process.exit(1);\n",
    );
    await writeFile(join(root, "tsconfig.json"), "{}\n");

    const result = runCli(["doctor", "--json"], { cwd: root });

    assert.equal(result.status, 1);
    assert.deepEqual(findCheck(JSON.parse(result.stdout), "ttsc-binary"), {
      name: "ttsc-binary",
      status: "fail",
      message: "Could not run the project-local ttsc --version",
    });
  });
});

test("doctor validates URL hosts and requires regular config files", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const validConfig = join(root, "doctor-remote.config.mjs");
    await writeFile(
      validConfig,
      `export default {
  name: "doctor-remote",
  entry: "src/inject.ts",
  outDir: "dist/doctor-remote",
  runtime: "remote",
  remote: { baseUrl: "https://myexample.com/assets/" },
  ttsc: { enabled: false },
  output: { installHtml: false, manifest: false, report: false },
};
`,
    );
    const valid = runCli(["doctor", "--json", "--config", validConfig], {
      cwd: root,
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      findCheck(JSON.parse(valid.stdout), "remote-base-url").status,
      "pass",
    );

    const invalidUrlConfig = join(root, "doctor-invalid-url.config.mjs");
    await writeFile(
      invalidUrlConfig,
      `export default {
  name: "doctor-invalid-url",
  entry: "src/inject.ts",
  outDir: "dist/doctor-invalid-url",
  runtime: "remote",
  remote: { baseUrl: "http://" },
  ttsc: { enabled: false },
  output: { installHtml: false, manifest: false, report: false },
};
`,
    );
    const invalidUrl = runCli(
      ["doctor", "--json", "--config", invalidUrlConfig],
      { cwd: root },
    );
    assert.equal(invalidUrl.status, 0, invalidUrl.stderr);
    assert.equal(
      findCheck(JSON.parse(invalidUrl.stdout), "remote-base-url").status,
      "warn",
    );

    const queryUrlConfig = join(root, "doctor-query-url.config.mjs");
    await writeFile(
      queryUrlConfig,
      `export default {
  name: "doctor-query-url",
  entry: "src/inject.ts",
  outDir: "dist/doctor-query-url",
  runtime: "remote",
  remote: { baseUrl: "https://cdn.example.com/assets/?token=secret" },
  ttsc: { enabled: false },
  output: { installHtml: false, manifest: false, report: false },
};
`,
    );
    const queryUrl = runCli(
      ["doctor", "--json", "--config", queryUrlConfig],
      { cwd: root },
    );
    assert.equal(queryUrl.status, 0, queryUrl.stderr);
    assert.equal(
      findCheck(JSON.parse(queryUrl.stdout), "remote-base-url").status,
      "warn",
    );

    const directoryConfig = join(root, "doctor-directories.config.mjs");
    await writeFile(
      directoryConfig,
      `export default {
  name: "doctor-directories",
  entry: ".",
  outDir: "dist/doctor-directories",
  runtime: "inline",
  ttsc: { enabled: true, project: "." },
  output: { installHtml: false, manifest: false, report: false },
};
`,
    );
    const directories = runCli(
      ["doctor", "--json", "--config", directoryConfig],
      { cwd: root, env: withPath(binDir) },
    );
    assert.equal(directories.status, 1);
    const directoryReport = JSON.parse(directories.stdout);
    assert.equal(findCheck(directoryReport, "entry").status, "fail");
    assert.equal(findCheck(directoryReport, "ttsc-project").status, "fail");
  });
});

test("doctor fails when only part of a build remains", async () => {
  await withBuildProject(async ({ binDir, root }) => {
    const env = withPath(binDir);
    const build = runCli(["build", "--json"], { cwd: root, env });
    assert.equal(build.status, 0, build.stderr);
    await rm(join(root, "dist", "custom", "inline", "custom-bookmarklet.txt"));

    const result = runCli(["doctor", "--json"], { cwd: root, env });

    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    const artifacts = findCheck(report, "artifacts");
    assert.equal(artifacts.status, "fail");
    assert.match(artifacts.message, /Missing artifact|bookmarklet length/i);
  });
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
    [["create"], /Missing project directory\. Usage: bmkl create <dir>/],
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

function findCheck(report, name) {
  const check = report.checks.find((candidate) => candidate.name === name);
  assert.ok(check, `Missing doctor check: ${name}`);
  return check;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withBuildProject(useProject) {
  const root = await mkdtemp(join(tmpdir(), "bmkl-cli-test-"));
  const binDir = join(root, "bin");
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(binDir, { recursive: true });
    const ttscPackageRoot = join(root, "node_modules", "ttsc");
    await mkdir(ttscPackageRoot, { recursive: true });
    await writeFile(
      join(ttscPackageRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "ttsc",
          version: "0.0.0-fixture",
          type: "module",
          bin: { ttsc: "fixture.mjs" },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(ttscPackageRoot, "fixture.mjs"),
      `import { writeFileSync } from "node:fs";
if (process.env.BMKL_TTSC_MARKER) {
  writeFileSync(process.env.BMKL_TTSC_MARKER, process.argv.slice(2).join(" "));
}
console.log("ttsc fixture output");
`,
    );
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
        ? '@if not "%BMKL_TTSC_MARKER%"=="" echo %*>"%BMKL_TTSC_MARKER%"\r\n@echo ttsc fixture output\r\n'
        : '#!/bin/sh\nif [ -n "$BMKL_TTSC_MARKER" ]; then printf "%s" "$*" > "$BMKL_TTSC_MARKER"; fi\necho "ttsc fixture output"\n',
    );
    if (process.platform !== "win32") {
      await chmod(ttscPath, 0o755);
    }

    await useProject({ binDir, root });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
