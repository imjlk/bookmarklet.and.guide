import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createProject,
  getTemplateDir,
  TEMPLATE_NAMES,
} from "../dist/index.js";

const {
  packageManager: expectedPackageManager,
  version: packageVersion,
} = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("getTemplateDir rejects unknown names and traversal", () => {
  assert.throws(() => getTemplateDir("../outside"), /Unknown template/);
  assert.throws(() => getTemplateDir("node_modules"), /Unknown template/);
});

for (const template of TEMPLATE_NAMES) {
  test(`createProject writes publishable ${template} defaults`, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
    const destination = join(tempRoot, "app");

    try {
      const result = await createProject({ destination, template });
      const manifest = JSON.parse(
        await readFile(join(destination, "package.json"), "utf8"),
      );
      assert.equal(manifest.dependencies["@bmkl/runtime"], packageVersion);
      assert.equal(manifest.devDependencies["@bmkl/cli"], packageVersion);
      assert.equal(manifest.packageManager, expectedPackageManager);
      assert.equal(result.packageManager, expectedPackageManager);
      assert.equal(manifest.scripts.dev, "bmkl dev");
      assert.equal(manifest.scripts.preview, "vite");
      assert.equal(manifest.scripts.graph, "ttsc-graph view");
      assert.equal(manifest.scripts["graph:mcp"], "ttsc-graph");
      assert.equal(manifest.devDependencies["@ttsc/graph"], "^0.18.0");
      assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);

      const previewHtml = await readFile(join(destination, "index.html"), "utf8");
      assert.match(previewHtml, /src="\/src\/preview\.ts"/);
      const previewEntry = await readFile(
        join(destination, "src", "preview.ts"),
        "utf8",
      );
      assert.match(previewEntry, /import \{ run \} from "\.\/inject\.js";/);
      assert.match(previewEntry, /run\(\);/);

      const readme = await readFile(join(destination, "README.md"), "utf8");
      assert.match(readme, /^# app$/m);
      assert.match(readme, /pnpm dev/);
      assert.match(readme, /Install-once dev bookmarklet/);
      assert.match(readme, /pnpm preview/);
      assert.match(readme, /https:\/\/bookmarklet\.and\.guide\//);
      assert.doesNotMatch(readme, /__BMKL_/);

      if (template === "ttsc-shadow") {
        for (const dependency of ["@ttsc/lint", "@ttsc/paths", "@ttsc/strip"]) {
          assert.equal(manifest.devDependencies[dependency], "^0.18.0");
        }
      } else {
        for (const dependency of ["@ttsc/lint", "@ttsc/paths", "@ttsc/strip"]) {
          assert.equal(manifest.devDependencies[dependency], undefined);
        }
        const tsconfig = JSON.parse(
          await readFile(join(destination, "tsconfig.json"), "utf8"),
        );
        assert.equal(tsconfig.compilerOptions.plugins, undefined);
      }

      const gitignore = await readFile(join(destination, ".gitignore"), "utf8");
      assert.match(gitignore, /^\.bmkl-dev-cert\/$/m);
      assert.match(gitignore, /^\.env\*$/m);
      assert.match(gitignore, /^!\.env\.example$/m);

      const workspace = await readFile(
        join(destination, "pnpm-workspace.yaml"),
        "utf8",
      );
      assert.match(workspace, /^allowBuilds:$/m);
      assert.match(workspace, /^  esbuild: true$/m);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
}

test("createProject refuses non-empty destinations without force", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const destination = join(tempRoot, "app");
  const marker = join(destination, "existing.txt");

  try {
    await mkdir(destination);
    await writeFile(marker, "keep");
    await assert.rejects(
      createProject({ destination, template: "vanilla-shadow" }),
      /Target directory is not empty/,
    );
    assert.equal(await readFile(marker, "utf8"), "keep");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("createProject force preserves unrelated files and refreshes template files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const destination = join(tempRoot, "app");
  const marker = join(destination, "existing.txt");

  try {
    await mkdir(destination);
    await Promise.all([
      writeFile(marker, "keep"),
      writeFile(join(destination, "package.json"), "{}\n"),
    ]);
    await createProject({
      destination,
      force: true,
      template: "vanilla-shadow",
    });
    const manifest = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies["@bmkl/runtime"], packageVersion);
    assert.equal(await readFile(marker, "utf8"), "keep");
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("createProject rejects a symbolic-link destination", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const realDestination = join(tempRoot, "real");
  const linkedDestination = join(tempRoot, "linked");

  try {
    await mkdir(realDestination);
    try {
      await symlink(realDestination, linkedDestination, "dir");
    } catch (error) {
      if (skipUnsupportedSymlink(context, error)) {
        return;
      }
      throw error;
    }

    await assert.rejects(
      createProject({
        destination: linkedDestination,
        force: true,
        template: "vanilla-shadow",
      }),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("createProject refuses to overwrite nested symbolic links", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const destination = join(tempRoot, "app");
  const outside = join(tempRoot, "outside");

  try {
    await Promise.all([mkdir(destination), mkdir(outside)]);
    try {
      await symlink(outside, join(destination, "src"), "dir");
    } catch (error) {
      if (skipUnsupportedSymlink(context, error)) {
        return;
      }
      throw error;
    }

    await assert.rejects(
      createProject({
        destination,
        force: true,
        template: "vanilla-shadow",
      }),
      /Refusing to overwrite a symbolic link/,
    );
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function skipUnsupportedSymlink(context, error) {
  if (
    error &&
    typeof error === "object" &&
    ["EACCES", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(error.code)
  ) {
    context.skip("Creating directory symlinks requires additional permission.");
    return true;
  }
  return false;
}
