import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TEMPLATE = "lit-shadow";

export const TEMPLATE_NAMES = [
  "lit-shadow",
  "ttsc-shadow",
  "solid-shadow",
  "solid-query-shadow",
  "react-shadow",
  "vanilla-shadow",
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export interface TemplateInfo {
  name: TemplateName;
  title: string;
  framework: string;
  language: string;
  description: string;
  recommendedFor: string;
}

export interface CreateProjectOptions {
  destination: string;
  template?: string;
  force?: boolean;
}

export interface CreateProjectResult {
  destination: string;
  template: TemplateInfo;
  projectName: string;
  globalName: string;
  projectId: string;
}

const TEMPLATE_INFOS: TemplateInfo[] = [
  {
    name: "lit-shadow",
    title: "Lit + Shadow DOM",
    framework: "Lit",
    language: "TypeScript",
    description: "A TS-first Vite + Lit starter with Web Components ergonomics.",
    recommendedFor: "Default choice when you want framework structure without TSX.",
  },
  {
    name: "ttsc-shadow",
    title: "ttsc + Shadow DOM",
    framework: "Vanilla + ttsc plugins",
    language: "TypeScript",
    description: "A compiler-aware starter using ttsc lint, strip, paths, and graph.",
    recommendedFor: "Teams that want to showcase or extend ttsc-powered DX.",
  },
  {
    name: "solid-shadow",
    title: "Solid + Shadow DOM",
    framework: "Solid",
    language: "TypeScript / TSX",
    description: "A compact Vite + Solid starter for interactive bookmarklets.",
    recommendedFor: "Small UI overlays and fast widgets with fine-grained reactivity.",
  },
  {
    name: "solid-query-shadow",
    title: "Solid Query + Shadow DOM",
    framework: "Solid + TanStack Query",
    language: "TypeScript / TSX",
    description: "A Solid starter with TanStack Query wired for cached async data.",
    recommendedFor: "Bookmarklets that read APIs, cache page data, or refetch state.",
  },
  {
    name: "react-shadow",
    title: "React + Shadow DOM",
    framework: "React",
    language: "TypeScript / TSX",
    description: "A Vite + React starter for teams already building React UI.",
    recommendedFor: "React component reuse and familiar app-style workflows.",
  },
  {
    name: "vanilla-shadow",
    title: "Vanilla TS + Shadow DOM",
    framework: "Vanilla",
    language: "TypeScript",
    description: "A minimal Vite + TypeScript starter with no UI framework.",
    recommendedFor: "Tiny actions, page utilities, and dependency-light scripts.",
  },
];

export async function listTemplates(): Promise<string[]> {
  return (await readdir(getTemplatesRoot(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function listTemplateInfos(): Promise<TemplateInfo[]> {
  const availableTemplates = new Set(await listTemplates());
  return TEMPLATE_INFOS.filter((template) => availableTemplates.has(template.name));
}

export function getTemplateInfo(template: string): TemplateInfo | undefined {
  return TEMPLATE_INFOS.find((info) => info.name === template);
}

export function getTemplateDir(template: string): string {
  return join(getTemplatesRoot(), template);
}

export function getTemplatesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates");
}

export async function createProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const templateName = options.template ?? DEFAULT_TEMPLATE;
  const template = getTemplateInfo(templateName);
  if (!template) {
    throw new Error(
      `Unknown template: ${templateName}. Run bmkl templates to list choices.`,
    );
  }

  const templateDir = getTemplateDir(template.name);
  if (!existsSync(templateDir)) {
    throw new Error(`Template not found: ${template.name}`);
  }

  const destination = resolve(options.destination);
  const projectName = toPackageName(basename(destination));
  const globalName = toGlobalName(basename(destination));
  const projectId = `__bmkl_${projectName.replace(/[^a-z0-9]+/g, "_")}__`;

  await assertWritableDirectory(destination, Boolean(options.force));
  await mkdir(destination, { recursive: true });
  await copyTemplateDirectory(templateDir, destination, {
    globalName,
    projectId,
    projectName,
  });

  const gitignorePath = join(destination, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(
      gitignorePath,
      "node_modules/\ndist/\n.env\n.DS_Store\n*.tsbuildinfo\n",
    );
  }

  return {
    destination,
    globalName,
    projectId,
    projectName,
    template,
  };
}

async function assertWritableDirectory(
  destination: string,
  force: boolean,
): Promise<void> {
  try {
    const info = await stat(destination);
    if (!info.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${destination}`);
    }

    const entries = await readdir(destination);
    if (entries.length > 0 && !force) {
      throw new Error(`Target directory is not empty: ${destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function copyTemplateDirectory(
  source: string,
  destination: string,
  replacements: {
    projectName: string;
    globalName: string;
    projectId: string;
  },
): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyTemplateDirectory(sourcePath, destinationPath, replacements);
      continue;
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    if (isTextTemplateFile(sourcePath)) {
      const text = await readFile(sourcePath, "utf8");
      await writeFile(destinationPath, applyReplacements(text, replacements));
    } else {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

function isTextTemplateFile(path: string): boolean {
  const extension = extname(path);
  if (!extension) {
    return true;
  }

  return new Set([
    ".css",
    ".cjs",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".mts",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
  ]).has(extension);
}

function applyReplacements(
  text: string,
  replacements: {
    projectName: string;
    globalName: string;
    projectId: string;
  },
): string {
  return text
    .replaceAll("__BMKL_PROJECT_NAME__", replacements.projectName)
    .replaceAll("__BMKL_GLOBAL_NAME__", replacements.globalName)
    .replaceAll("__BMKL_PROJECT_ID__", replacements.projectId);
}

function toPackageName(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "bookmarklet-app";
}

function toGlobalName(input: string): string {
  const normalized = input
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return normalized || "BookmarkletApp";
}
