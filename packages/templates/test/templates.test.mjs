import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createProject,
  getTemplateDir,
} from "../dist/index.js";

const { version: packageVersion } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("getTemplateDir rejects unknown names and traversal", () => {
  assert.throws(() => getTemplateDir("../outside"), /Unknown template/);
  assert.throws(() => getTemplateDir("node_modules"), /Unknown template/);
});

test("createProject writes publishable dependencies and safe defaults", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const destination = join(tempRoot, "app");

  try {
    await createProject({ destination, template: "vanilla-shadow" });
    const manifest = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies["@bmkl/runtime"], packageVersion);
    assert.equal(manifest.devDependencies["@bmkl/cli"], packageVersion);
    assert.equal(manifest.packageManager, "pnpm@11.7.0");
    assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);

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

test("createProject rejects a symbolic-link destination", async (context) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const realDestination = join(tempRoot, "real");
  const linkedDestination = join(tempRoot, "linked");

  try {
    await mkdir(realDestination);
    try {
      await symlink(realDestination, linkedDestination, "dir");
    } catch (error) {
      if (error.code === "EPERM") {
        context.skip("Creating directory symlinks requires additional permission.");
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
      if (error.code === "EPERM") {
        context.skip("Creating directory symlinks requires additional permission.");
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
