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
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createProject,
  getTemplateDir,
  getTemplateInfo,
  TEMPLATE_NAMES,
} from "../dist/index.js";

const templatesPackageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedPackageManager = templatesPackageManifest.bmkl.packageManager;
const packageVersion = templatesPackageManifest.version;
const panelSourceByTemplate = {
  "lit-shadow": "inject.ts",
  "react-shadow": "App.tsx",
  "solid-query-shadow": "App.tsx",
  "solid-shadow": "App.tsx",
  "ttsc-shadow": "renderPanel.ts",
  "vanilla-shadow": "inject.ts",
};
const entrySourceByTemplate = {
  "lit-shadow": "inject.ts",
  "react-shadow": "inject.tsx",
  "solid-query-shadow": "inject.tsx",
  "solid-shadow": "inject.tsx",
  "ttsc-shadow": "inject.ts",
  "vanilla-shadow": "inject.ts",
};

assert.equal(templatesPackageManifest.packageManager, expectedPackageManager);

test("getTemplateDir rejects unknown names and traversal", () => {
  assert.throws(() => getTemplateDir("../outside"), /Unknown template/);
  assert.throws(() => getTemplateDir("node_modules"), /Unknown template/);
});

test("ttsc-shadow is presented as the complete reference-stack template", () => {
  const template = getTemplateInfo("ttsc-shadow");

  assert.equal(template?.title, "ttsc Reference Stack + Shadow DOM");
  assert.match(template?.description ?? "", /typed DOM adapter/);
  assert.match(template?.description ?? "", /ttsx tests/);
  assert.match(template?.description ?? "", /declarations/);
  assert.match(template?.recommendedFor ?? "", /without a UI framework or backend/);
});

test("shared panel conventions stay synchronized across templates", async () => {
  // Keep these forkable helpers in generated source, but anchor their shared baseline.
  const canonicalTemplate = "vanilla-shadow";
  assert.ok(TEMPLATE_NAMES.includes(canonicalTemplate));
  const otherTemplates = TEMPLATE_NAMES.filter(
    (template) => template !== canonicalTemplate,
  );
  const canonicalPanelConfig = await readFile(
    join(getTemplateDir(canonicalTemplate), "src", "panel.config.ts"),
    "utf8",
  );
  const canonicalStyles = await readFile(
    join(getTemplateDir(canonicalTemplate), "src", "style.css"),
    "utf8",
  );

  for (const template of otherTemplates) {
    assert.equal(
      await readFile(
        join(getTemplateDir(template), "src", "panel.config.ts"),
        "utf8",
      ),
      canonicalPanelConfig,
      `${template} panel config drifted from ${canonicalTemplate}`,
    );
    assert.equal(
      await readFile(join(getTemplateDir(template), "src", "style.css"), "utf8"),
      canonicalStyles,
      `${template} panel styles drifted from ${canonicalTemplate}`,
    );
  }
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
      assert.equal(result.dependencyMode, "published");
      assert.equal(result.projectName, "app");
      assert.equal(result.projectTitle, "App");
      assert.equal(manifest.scripts.dev, "bmkl dev");
      assert.equal(manifest.scripts.preview, "vite");
      assert.equal(manifest.scripts.graph, "ttsc-graph view");
      assert.equal(manifest.scripts["graph:mcp"], "ttsc-graph");
      assert.equal(manifest.devDependencies["@ttsc/graph"], "^0.18.0");
      assert.doesNotMatch(JSON.stringify(manifest), /workspace:/);

      const previewHtml = await readFile(join(destination, "index.html"), "utf8");
      assert.doesNotMatch(
        previewHtml,
        /\r/,
        `${template} generated HTML must use LF line endings`,
      );
      assert.match(previewHtml, /src="\/src\/preview\.ts"/);
      assert.match(previewHtml, /<title>App preview<\/title>/);
      assert.match(previewHtml, /data-preview-run/);
      const previewEntry = await readFile(
        join(destination, "src", "preview.ts"),
        "utf8",
      );
      assert.doesNotMatch(
        previewEntry,
        /\r/,
        `${template} generated text must use LF line endings`,
      );
      assert.match(previewEntry, /import \{ run \} from "\.\/inject\.js";/);
      assert.match(previewEntry, /\[data-preview-run\]/);
      assert.match(previewEntry, /addEventListener\("click", run\)/);
      assert.match(previewEntry, /run\(\);/);
      const panelConfig = await readFile(
        join(destination, "src", "panel.config.ts"),
        "utf8",
      );
      assert.doesNotMatch(
        panelConfig,
        /\r/,
        `${template} generated config must use LF line endings`,
      );
      assert.match(panelConfig, /title: "App"/);
      assert.match(panelConfig, /event\.key !== "Escape"/);
      assert.match(
        panelConfig,
        /ownerDocument\.addEventListener\("keydown", handleKeydown, true\)/,
      );
      assert.match(
        panelConfig,
        /ownerDocument\.removeEventListener\("keydown", handleKeydown, true\)/,
      );
      assert.match(panelConfig, /previousFocus\.focus/);
      assert.match(panelConfig, /panel\.focus/);
      assert.doesNotMatch(panelConfig, /__BMKL_/);
      const panelSourceName = panelSourceByTemplate[template];
      const entrySourceName = entrySourceByTemplate[template];
      assert.ok(
        panelSourceName,
        `panelSourceByTemplate is missing ${template}`,
      );
      assert.ok(
        entrySourceName,
        `entrySourceByTemplate is missing ${template}`,
      );
      const panelSource = await readFile(
        join(destination, "src", panelSourceName),
        "utf8",
      );
      assert.match(panelSource, /role="dialog"/);
      assert.match(panelSource, /aria-labelledby="bmkl-panel-title"/);
      assert.match(panelSource, /tab[Ii]ndex=(?:\{-1\}|"-1")/);
      assert.match(panelSource, /<h2[^>]+id="bmkl-panel-title"/);
      assert.match(panelSource, /aria-label="Close panel"/);
      assert.match(panelSource, /panelConfig\.title/);
      const entrySource = await readFile(
        join(destination, "src", entrySourceName),
        "utf8",
      );
      assert.match(entrySource, /registerBookmarkletApi/);
      assert.match(entrySource, /destroy,/);
      assert.match(entrySource, /globalName: "App"/);
      assert.match(entrySource, /id: "__bmkl_app__"/);
      assert.match(entrySource, /registration\.activate\(\)/);
      assert.match(entrySource, /registration\.release\(\)/);
      assert.doesNotMatch(entrySource, /Object\.assign\(globalThis/);
      const panelStyles = await readFile(
        join(destination, "src", "style.css"),
        "utf8",
      );
      assert.match(panelStyles, /--bmkl-accent:/);
      assert.match(panelStyles, /--bmkl-radius:/);
      assert.match(panelStyles, /@media \(prefers-reduced-motion: reduce\)/);

      const readme = await readFile(join(destination, "README.md"), "utf8");
      assert.match(readme, /^# App$/m);
      assert.match(readme, /pnpm dev/);
      assert.match(readme, /local \*\*Setup\*\* URL/);
      assert.match(readme, /drag \*\*BMKL dev\*\*/);
      assert.match(readme, /pnpm preview/);
      assert.match(readme, /^## Customize$/m);
      assert.match(readme, /src\/panel\.config\.ts/);
      assert.match(readme, /cache-busted reload cleanup/);
      assert.match(readme, /https:\/\/bookmarklet\.and\.guide\//);
      assert.doesNotMatch(readme, /__BMKL_/);

      if (template === "ttsc-shadow") {
        for (const dependency of ["@ttsc/lint", "@ttsc/paths", "@ttsc/strip"]) {
          assert.equal(manifest.devDependencies[dependency], "^0.18.0");
        }
        assert.equal(
          manifest.scripts.test,
          "ttsx --project tsconfig.json test/snapshotReport.test.ts",
        );
        assert.match(manifest.scripts.verify, /pnpm test/);
        assert.match(manifest.scripts.verify, /pnpm doctor$/);

        const lintConfig = await readFile(
          join(destination, "lint.config.ts"),
          "utf8",
        );
        assert.match(lintConfig, /satisfies ITtscLintConfig/);
        assert.match(lintConfig, /severity: "error"/);
        const stripConfig = await readFile(
          join(destination, "strip.config.js"),
          "utf8",
        );
        assert.match(stripConfig, /@type \{import\("@ttsc\/strip"\)\.ITtscStripConfig\}/);
        const viteConfig = await readFile(
          join(destination, "vite.config.ts"),
          "utf8",
        );
        assert.match(viteConfig, /find: \/\^@app\\\/\(\.\+\)\$\//);
        assert.match(viteConfig, /new URL\("\.\/src\/\$1\.ts"/);
        const injectSource = await readFile(
          join(destination, "src", "inject.ts"),
          "utf8",
        );
        assert.match(injectSource, /from "@app\/renderPanel"/);
        const reportSource = await readFile(
          join(destination, "src", "snapshotReport.ts"),
          "utf8",
        );
        assert.match(reportSource, /formatSnapshotReport/);
        const reportTest = await readFile(
          join(destination, "test", "snapshotReport.test.ts"),
          "utf8",
        );
        assert.match(reportTest, /from "@app\/snapshotReport"/);
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
      assert.match(workspace, /^# Generated by @bmkl\/templates\.$/m);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
}

test("createProject derives a display title without changing code identifiers", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-title-test-"));
  const destination = join(tempRoot, "my-agent");

  try {
    const result = await createProject({
      destination,
      template: "vanilla-shadow",
    });
    const manifest = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    );
    const bookmarkletConfig = await readFile(
      join(destination, "bookmarklet.config.ts"),
      "utf8",
    );
    const readme = await readFile(join(destination, "README.md"), "utf8");
    const previewHtml = await readFile(join(destination, "index.html"), "utf8");
    const panelConfig = await readFile(
      join(destination, "src", "panel.config.ts"),
      "utf8",
    );

    assert.equal(result.projectName, "my-agent");
    assert.equal(result.projectTitle, "My Agent");
    assert.equal(result.globalName, "MyAgent");
    assert.equal(result.projectId, "__bmkl_my_agent__");
    assert.equal(manifest.name, "my-agent");
    assert.match(bookmarkletConfig, /name: "my-agent"/);
    assert.match(readme, /^# My Agent$/m);
    assert.match(previewHtml, /<title>My Agent preview<\/title>/);
    assert.match(panelConfig, /title: "My Agent"/);
    assert.doesNotMatch(readme, /__BMKL_/);
    assert.doesNotMatch(previewHtml, /__BMKL_/);
    assert.doesNotMatch(panelConfig, /__BMKL_/);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("createProject keeps display-title replacements safe across file contexts", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-title-test-"));
  const destination = join(tempRoot, "my&copy;agent");

  try {
    const result = await createProject({
      destination,
      template: "vanilla-shadow",
    });
    const panelConfig = await readFile(
      join(destination, "src", "panel.config.ts"),
      "utf8",
    );
    const readme = await readFile(join(destination, "README.md"), "utf8");
    const previewHtml = await readFile(join(destination, "index.html"), "utf8");

    assert.equal(result.projectName, "my-copy-agent");
    assert.equal(result.projectTitle, "My Copy Agent");
    assert.equal(result.globalName, "MyCopyAgent");
    assert.equal(result.projectId, "__bmkl_my_copy_agent__");
    assert.match(panelConfig, /title: "My Copy Agent"/);
    assert.match(readme, /^# My Copy Agent$/m);
    assert.match(previewHtml, /<title>My Copy Agent preview<\/title>/);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

test("createProject local mode links every BMKL package from the source checkout", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-local-test-"));
  const destination = join(tempRoot, "app");

  try {
    const result = await createProject({
      destination,
      local: true,
      template: "vanilla-shadow",
    });
    const manifest = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8"),
    );
    assert.equal(result.dependencyMode, "local");
    assert.equal(manifest.private, true);

    for (const section of [manifest.dependencies, manifest.devDependencies]) {
      for (const [name, specifier] of Object.entries(section ?? {})) {
        if (!name.startsWith("@bmkl/")) {
          continue;
        }
        assert.match(specifier, /^file:/);
      }
    }

    const workspace = await readFile(
      join(destination, "pnpm-workspace.yaml"),
      "utf8",
    );
    for (const name of [
      "@bmkl/cli",
      "@bmkl/contracts",
      "@bmkl/core",
      "@bmkl/runtime",
      "@bmkl/templates",
      "@bmkl/vite",
    ]) {
      const match = workspace.match(
        new RegExp(`^  ${JSON.stringify(name)}: ("file:[^"]+")$`, "m"),
      );
      assert.ok(match, `Missing local override for ${name}`);
      const specifier = JSON.parse(match[1]);
      const linkedManifest = JSON.parse(
        await readFile(
          resolve(fileURLToPath(specifier), "package.json"),
          "utf8",
        ),
      );
      assert.equal(linkedManifest.name, name);
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

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

for (const generatedFile of [".gitignore", "pnpm-workspace.yaml"]) {
  test(`createProject refuses to overwrite a ${generatedFile} symbolic link`, async (context) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
    const destination = join(tempRoot, "app");
    const outside = join(tempRoot, "outside.txt");

    try {
      await mkdir(destination);
      await writeFile(outside, "keep\n");
      try {
        await symlink(outside, join(destination, generatedFile), "file");
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
          local: generatedFile === "pnpm-workspace.yaml",
          template: "vanilla-shadow",
        }),
        /Refusing to overwrite a symbolic link/,
      );
      assert.equal(await readFile(outside, "utf8"), "keep\n");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
}

test("createProject local mode preserves an existing pnpm workspace", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
  const destination = join(tempRoot, "app");
  const workspacePath = join(destination, "pnpm-workspace.yaml");
  const existingWorkspace = 'packages:\n  - "apps/*"\ncatalog:\n  react: ^19.0.0\n';

  try {
    await mkdir(destination);
    await writeFile(workspacePath, existingWorkspace);
    await assert.rejects(
      createProject({
        destination,
        force: true,
        local: true,
        template: "vanilla-shadow",
      }),
      /Refusing to overwrite an existing pnpm workspace in local mode/,
    );
    assert.equal(await readFile(workspacePath, "utf8"), existingWorkspace);
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
});

for (const generatedFile of [".gitignore", "pnpm-workspace.yaml"]) {
  test(`createProject rejects a directory at ${generatedFile}`, async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bmkl-templates-test-"));
    const destination = join(tempRoot, "app");

    try {
      await mkdir(join(destination, generatedFile), { recursive: true });
      await assert.rejects(
        createProject({
          destination,
          force: true,
          template: "vanilla-shadow",
        }),
        /Generated file path must be a regular file/,
      );
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
}

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
