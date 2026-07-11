import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../dist/index.js", import.meta.url);

test("create-bmkl rejects unknown options, missing values, and extra targets", async () => {
  await assertCliFailure([], /Missing project directory\. Usage: create-bmkl <dir>/);
  await assertCliFailure(["--wat"], /Unknown option: --wat/);
  await assertCliFailure(["--template"], /Option requires a value: --template/);
  await assertCliFailure(["one", "two"], /Unexpected argument: two/);
  await assertCliFailure(
    ["--templates", "unexpected"],
    /Unexpected argument: unexpected/,
  );
  await assertCliFailure(
    ["--force=maybe"],
    /Boolean option must be true or false/,
  );
  await assertCliFailure(
    ["app", "--template=vanilla-shadow=unexpected"],
    /Unknown template: vanilla-shadow=unexpected/,
  );
  await assertCliFailure(
    ["app", "-t=vanilla-shadow=unexpected"],
    /Unknown template: vanilla-shadow=unexpected/,
  );
  await assertCliFailure(
    ["--version", "--template", "vanilla-shadow"],
    /Option --template cannot be used with --version/,
  );
  await assertCliFailure(
    ["--templates", "--force"],
    /Option --force cannot be used with --templates/,
  );
  await assertCliFailure(
    ["--templates", "--list-templates"],
    /Use either --templates or --list-templates, not both/,
  );
});

test("create-bmkl help includes an explicit destination usage contract", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath.pathname,
    "app",
    "--help",
    "--template",
    "missing",
  ]);

  assert.match(stdout, /Usage:\s+create-bmkl <dir> \[options\]/);
});

test("disabled mode flags behave as absent during project creation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-false-mode-test-"));

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliPath.pathname,
        "app",
        "--json",
        "--templates=false",
        "--help=false",
        "--version=false",
        "--template",
        "vanilla-shadow",
      ],
      { cwd: tempRoot },
    );

    assert.equal(JSON.parse(stdout).template.name, "vanilla-shadow");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("create-bmkl reports package metadata as its version", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath.pathname,
    "--version",
  ]);
  assert.equal(stdout.trim(), manifest.version);
});

test("create-bmkl emits structured JSON errors", async () => {
  for (const args of [
    ["--json", "--wat"],
    ["--", "--json", "--wat"],
    ["--json"],
    ["app", "--json", "--template=missing"],
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath.pathname, ...args]),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, "");
        const result = JSON.parse(error.stdout);
        assert.equal(result.ok, false);
        assert.equal(typeof result.error.message, "string");
        assert.ok(result.error.message.length > 0);
        return true;
      },
    );
  }
});

test("create-bmkl quotes its destination and explains a missing pnpm prerequisite", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-path-test-"));
  const destination = "project's panel";

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath.pathname, destination, "--template", "vanilla-shadow"],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: "",
          npm_config_user_agent: "npm/11.0.0",
        },
      },
    );
    const changeDirectory =
      process.platform === "win32"
        ? "Set-Location -LiteralPath 'project''s panel'"
        : "cd 'project'\"'\"'s panel'";

    assert.match(stdout, new RegExp(`  ${escapeRegExp(changeDirectory)}`));
    assert.match(stdout, /Prerequisite: install or enable pnpm@/);
    await readFile(join(tempRoot, destination, "package.json"), "utf8");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("create-bmkl prints a usable cd path for a dash-leading directory", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-dash-test-"));

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath.pathname, "./-panel", "--template", "vanilla-shadow"],
      { cwd: tempRoot },
    );

    assert.match(
      stdout,
      process.platform === "win32"
        ? /  Set-Location -LiteralPath '\.\/-panel'/
        : /  cd \.\/-panel/,
    );
    await readFile(join(tempRoot, "-panel", "package.json"), "utf8");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

for (const bootstrapAgent of ["npm/11.0.0", "bun/1.2.0"]) {
  test(`create-bmkl reports pnpm project commands when bootstrapped by ${bootstrapAgent.split("/", 1)[0]}`, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-test-"));

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [cliPath.pathname, "app", "--template", "vanilla-shadow"],
        {
          cwd: tempRoot,
          env: { ...process.env, npm_config_user_agent: bootstrapAgent },
        },
      );
      const manifest = JSON.parse(
        await readFile(join(tempRoot, "app", "package.json"), "utf8"),
      );

      assert.match(manifest.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
      assert.match(stdout, new RegExp(`Package manager: ${manifest.packageManager}`));
      for (const command of [
        "pnpm install",
        "pnpm dev",
        "pnpm build",
        "pnpm inspect",
      ]) {
        assert.match(stdout, new RegExp(`  ${command}`));
      }
      assert.doesNotMatch(stdout, /  npm (?:install|run)/);
      assert.doesNotMatch(stdout, /  bun (?:install|dev|run)/);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
}

test("create-bmkl JSON output declares the generated package manager", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-test-"));

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath.pathname, "app", "--json", "--template=vanilla-shadow"],
      { cwd: tempRoot },
    );
    const result = JSON.parse(stdout);
    assert.match(result.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("create-bmkl local mode reports and links source packages", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "create-bmkl-local-test-"));

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliPath.pathname,
        "app",
        "--json",
        "--local",
        "--template=vanilla-shadow",
      ],
      { cwd: tempRoot },
    );
    assert.equal(JSON.parse(stdout).dependencyMode, "local");
    const manifest = JSON.parse(
      await readFile(join(tempRoot, "app", "package.json"), "utf8"),
    );
    assert.match(manifest.dependencies["@bmkl/runtime"], /^file:/);
    assert.match(
      await readFile(join(tempRoot, "app", "pnpm-workspace.yaml"), "utf8"),
      /"@bmkl\/cli": "file:/,
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

async function assertCliFailure(args, messagePattern) {
  await assert.rejects(
    execFileAsync(process.execPath, [cliPath.pathname, ...args]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, messagePattern);
      return true;
    },
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
