import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getPnpmCommand } from "./pnpm-command.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
let expectedPackageManager;
const keepArtifacts = process.env.BMKL_TEMPLATE_SMOKE_KEEP === "1";
const activeChildren = new Set();
let shutdownSignal;
let poolFailure;
const concurrency = parseConcurrency(
  process.env.BMKL_TEMPLATE_SMOKE_CONCURRENCY ?? "2",
);
const stepTimeoutMs = parsePositiveInteger(
  process.env.BMKL_TEMPLATE_SMOKE_STEP_TIMEOUT_MS ?? "600000",
  "BMKL_TEMPLATE_SMOKE_STEP_TIMEOUT_MS",
);
const templateNames = [
  "lit-shadow",
  "ttsc-shadow",
  "solid-shadow",
  "solid-query-shadow",
  "react-shadow",
  "vanilla-shadow",
];
const packageEntries = [
  ["@bmkl/contracts", "packages/contracts"],
  ["@bmkl/core", "packages/core"],
  ["@bmkl/runtime", "packages/runtime"],
  ["@bmkl/templates", "packages/templates"],
  ["@bmkl/vite", "packages/vite"],
  ["create-bmkl", "packages/create"],
  ["@bmkl/cli", "packages/cli"],
];

async function main() {
  expectedPackageManager = await readExpectedPackageManager();
  throwIfShuttingDown();
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-template-smoke-"));
  const packsDir = join(tempRoot, "packs");
  const projectsDir = join(tempRoot, "projects");

  try {
    await Promise.all([
      mkdir(packsDir, { recursive: true }),
      mkdir(projectsDir, { recursive: true }),
    ]);

    const packageVersions = await readPackageVersions();
    const bmklVersion = assertSynchronizedBmklVersions(packageVersions);
    const tarballs = await packWorkspacePackages(
      packsDir,
      packageVersions,
    );

    await runPool(templateNames, concurrency, async (templateName) => {
      await smokeTemplate({
        bmklVersion,
        projectsDir,
        tarballs,
        templateName,
      });
    });
    throwIfShuttingDown();

    console.log(
      `\nTemplate smoke passed for ${templateNames.length} templates at BMKL ${bmklVersion}.`,
    );
  } finally {
    if (keepArtifacts) {
      console.log(`Template smoke artifacts kept at ${tempRoot}`);
    } else {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
}

async function readPackageVersions() {
  const versions = new Map();
  for (const [name, directory] of packageEntries) {
    const manifest = await readJson(join(root, directory, "package.json"));
    if (manifest.name !== name || typeof manifest.version !== "string") {
      throw new Error(`Invalid package metadata for ${name} in ${directory}`);
    }
    if (
      name === "@bmkl/templates" &&
      manifest.packageManager !== expectedPackageManager
    ) {
      throw new Error(
        `@bmkl/templates must pin ${expectedPackageManager} to scaffold projects.`,
      );
    }
    versions.set(name, manifest.version);
  }
  return versions;
}

function assertSynchronizedBmklVersions(packageVersions) {
  const expected = packageVersions.get("@bmkl/templates");
  for (const [name, version] of packageVersions) {
    if (version !== expected) {
      throw new Error(
        `BMKL package versions must stay synchronized: ${name} is ${version}, expected ${expected}.`,
      );
    }
  }
  return expected;
}

async function packWorkspacePackages(packsDir, packageVersions) {
  const tarballs = new Map();
  for (const [name, directory] of packageEntries) {
    const version = packageVersions.get(name);
    const fileName = `${name.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`;
    const tarball = join(packsDir, fileName);
    await runPnpm(["pack", "--out", tarball], {
      cwd: join(root, directory),
      label: `pack ${name}`,
    });
    await access(tarball);
    tarballs.set(name, tarball);
  }
  return tarballs;
}

async function smokeTemplate({
  bmklVersion,
  projectsDir,
  tarballs,
  templateName,
}) {
  const projectDir = join(projectsDir, templateName);
  await run(
    process.execPath,
    [
      join(root, "packages/create/dist/index.js"),
      projectDir,
      "--template",
      templateName,
      "--force",
    ],
    { cwd: root, label: `create ${templateName}` },
  );

  const manifestPath = join(projectDir, "package.json");
  const manifest = await readJson(manifestPath);
  assertPublishedDependencies(manifest, bmklVersion, templateName);
  await assertGeneratedGitignore(projectDir, templateName);
  await assertGeneratedPnpmWorkspace(projectDir, templateName);
  const overrides = localizeBmklDependencies(manifest, projectDir, tarballs);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeLocalPnpmWorkspace(projectDir, overrides);

  await runPnpm(["install", "--prefer-offline", "--no-frozen-lockfile"], {
    cwd: projectDir,
    label: `${templateName} install`,
  });
  await runPnpm(["run", "typecheck"], {
    cwd: projectDir,
    label: `${templateName} typecheck`,
  });
  await runPnpm(["run", "build"], {
    cwd: projectDir,
    label: `${templateName} build`,
  });

  await Promise.all(
    [
      "dist/bookmarklet/remote/app.iife.js",
      "dist/bookmarklet/remote/bookmarklet.txt",
      "dist/bookmarklet/inline/bookmarklet.txt",
      "dist/bookmarklet/meta/build-report.json",
    ].map((path) => access(join(projectDir, path))),
  );
  console.log(`\u2713 ${templateName}`);
}

function assertPublishedDependencies(manifest, bmklVersion, templateName) {
  const serialized = JSON.stringify(manifest);
  if (serialized.includes("workspace:")) {
    throw new Error(`${templateName} still contains a workspace: dependency.`);
  }

  let bmklDependencyCount = 0;
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (!name.startsWith("@bmkl/")) {
        continue;
      }
      bmklDependencyCount += 1;
      if (specifier !== bmklVersion) {
        throw new Error(
          `${templateName} pins ${name} to ${specifier}; expected ${bmklVersion}.`,
        );
      }
    }
  }

  if (bmklDependencyCount === 0) {
    throw new Error(`${templateName} does not declare any BMKL packages.`);
  }
  if (manifest.packageManager !== expectedPackageManager) {
    throw new Error(
      `${templateName} pins ${manifest.packageManager ?? "no package manager"}; expected ${expectedPackageManager}.`,
    );
  }
}

async function assertGeneratedGitignore(projectDir, templateName) {
  const gitignore = await readFile(join(projectDir, ".gitignore"), "utf8");
  for (const entry of [".bmkl-dev-cert/", ".env*", "!.env.example"]) {
    if (!gitignore.split(/\r?\n/).includes(entry)) {
      throw new Error(`${templateName} .gitignore is missing ${entry}.`);
    }
  }
}

async function assertGeneratedPnpmWorkspace(projectDir, templateName) {
  const workspace = await readFile(
    join(projectDir, "pnpm-workspace.yaml"),
    "utf8",
  );
  for (const entry of ['  - "."', "allowBuilds:", "  esbuild: true"]) {
    if (!workspace.split(/\r?\n/).includes(entry)) {
      throw new Error(`${templateName} pnpm-workspace.yaml is missing ${entry}.`);
    }
  }
}

function localizeBmklDependencies(manifest, projectDir, tarballs) {
  const overrides = {};
  for (const [name, tarball] of tarballs) {
    const specifier = `file:${normalizePath(relative(projectDir, tarball))}`;
    overrides[name] = specifier;
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (manifest[section]?.[name]) {
        manifest[section][name] = specifier;
      }
    }
  }

  return overrides;
}

async function writeLocalPnpmWorkspace(projectDir, overrides) {
  const lines = [
    "packages:",
    '  - "."',
    "allowBuilds:",
    "  esbuild: true",
    "overrides:",
  ];
  for (const [name, specifier] of Object.entries(overrides)) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`);
  }
  lines.push("");
  await writeFile(join(projectDir, "pnpm-workspace.yaml"), lines.join("\n"));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readExpectedPackageManager() {
  const manifest = await readJson(join(root, "package.json"));
  if (
    typeof manifest.packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)
  ) {
    throw new Error("Root package.json must pin an exact pnpm packageManager.");
  }
  return manifest.packageManager;
}

async function runPnpm(args, options) {
  const invocation = getPnpmCommand(args);
  await run(invocation.command, invocation.args, options);
}

async function run(command, args, { cwd, label }) {
  throwIfShuttingDown();
  console.log(`\n> ${label}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CI: process.env.CI ?? "1" },
    stdio: "inherit",
  });
  activeChildren.add(child);
  let code;
  let forceTimer;
  let signal;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 5_000);
    }
  }, stepTimeoutMs);
  try {
    [code, signal] = await once(child, "exit");
  } catch (error) {
    throw new Error(`${label} encountered a process error.`, { cause: error });
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(forceTimer);
    activeChildren.delete(child);
  }
  if (timedOut) {
    throw new Error(`${label} timed out after ${stepTimeoutMs}ms.`);
  }
  if (signal || code !== 0) {
    throw new Error(
      `${label} failed${signal ? ` from signal ${signal}` : ` with exit code ${code}`}.`,
    );
  }
}

function throwIfShuttingDown() {
  if (shutdownSignal) {
    throw new Error(`Template smoke interrupted by ${shutdownSignal}.`);
  }
  if (poolFailure) {
    throw new Error("Template smoke canceled after another template failed.", {
      cause: poolFailure,
    });
  }
}

async function runPool(items, limit, task) {
  poolFailure = undefined;
  let nextIndex = 0;
  const failures = [];
  try {
    const workers = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (nextIndex < items.length && failures.length === 0) {
          const item = items[nextIndex];
          nextIndex += 1;
          try {
            await task(item);
          } catch (error) {
            poolFailure ??= error;
            failures.push(error);
          }
        }
      },
    );
    await Promise.all(workers);
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `${failures.length} template smoke tasks failed.`,
      );
    }
  } finally {
    poolFailure = undefined;
  }
}

function parseConcurrency(value) {
  return parsePositiveInteger(value, "BMKL_TEMPLATE_SMOKE_CONCURRENCY");
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function formatError(error) {
  if (error instanceof AggregateError) {
    const errors = Array.isArray(error.errors) ? error.errors : [];
    return [
      error.message,
      ...errors.map((item, index) =>
        `${index + 1}. ${item instanceof Error ? item.message : String(item)}`,
      ),
    ].join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

const signalHandlers = new Map(
  ["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      shutdownSignal ??= signal;
      for (const child of activeChildren) {
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

let mainError;
try {
  await main();
} catch (error) {
  mainError = error;
} finally {
  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler);
  }
}

if (shutdownSignal) {
  process.exitCode = shutdownSignal === "SIGINT" ? 130 : 143;
} else if (mainError) {
  console.error(formatError(mainError));
  process.exitCode = 1;
}
