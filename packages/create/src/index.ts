import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_NAMES,
  createProject,
  listTemplateInfos,
  type CreateProjectResult,
  type TemplateInfo,
} from "@bmkl/templates";

const VERSION = readOwnPackageVersion();

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

interface ParseArgsOptions {
  aliases?: Record<string, string>;
  booleans?: string[];
  strings?: string[];
}

async function main(argv: string[]): Promise<void> {
  while (argv[0] === "--") {
    argv.shift();
  }

  const args = parseArgs(argv, {
    aliases: {
      f: "force",
      h: "help",
      t: "template",
      v: "version",
    },
    booleans: [
      "force",
      "help",
      "json",
      "list-templates",
      "local",
      "templates",
      "version",
    ],
    strings: ["template"],
  });

  assertValidPositionals(args);

  if (flagBoolean(args, "version")) {
    console.log(VERSION);
    return;
  }

  if (flagBoolean(args, "help")) {
    printHelp();
    return;
  }

  if (flagBoolean(args, "templates") || flagBoolean(args, "list-templates")) {
    const templates = await listTemplateInfos();
    if (flagBoolean(args, "json")) {
      console.log(JSON.stringify(templates, null, 2));
    } else {
      printTemplateInfos(templates);
    }
    return;
  }

  const target = args.positionals[0] ?? ".";
  const result = await createProject({
    destination: resolve(process.cwd(), target),
    force: flagBoolean(args, "force"),
    local: flagBoolean(args, "local"),
    template: flagString(args, "template") ?? DEFAULT_TEMPLATE,
  });

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printCreateResult(result);
}

function parseArgs(
  argv: string[],
  options: ParseArgsOptions = {},
): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const aliases = options.aliases ?? {};
  const booleans = new Set(options.booleans ?? []);
  const strings = new Set(options.strings ?? []);
  const knownNames = new Set([...booleans, ...strings]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = splitOptionArgument(arg, 2);
      const name = aliases[rawName] ?? rawName;
      assertKnownOption(arg, name, knownNames);
      assertUniqueOption(flags, name);
      if (booleans.has(name)) {
        flags.set(name, parseBooleanOption(arg, inlineValue));
      } else if (inlineValue !== undefined) {
        flags.set(name, assertOptionValue(arg, inlineValue));
      } else if (argv[index + 1] && argv[index + 1] !== "--") {
        flags.set(name, assertOptionValue(arg, argv[index + 1]));
        index += 1;
      } else {
        throw new Error(`Option requires a value: --${rawName}`);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const [shortName, inlineValue] = splitOptionArgument(arg, 1);
      const name = aliases[shortName];
      if (!name || shortName.length !== 1) {
        throw new Error(`Unknown option: ${arg}`);
      }
      assertKnownOption(arg, name, knownNames);
      assertUniqueOption(flags, name);
      if (booleans.has(name)) {
        flags.set(name, parseBooleanOption(arg, inlineValue));
      } else if (inlineValue !== undefined) {
        flags.set(name, assertOptionValue(arg, inlineValue));
      } else if (argv[index + 1] && argv[index + 1] !== "--") {
        flags.set(name, assertOptionValue(arg, argv[index + 1]));
        index += 1;
      } else {
        throw new Error(`Option requires a value: ${arg}`);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function splitOptionArgument(
  argument: string,
  prefixLength: number,
): [name: string, inlineValue: string | undefined] {
  const equalsIndex = argument.indexOf("=", prefixLength);
  return equalsIndex === -1
    ? [argument.slice(prefixLength), undefined]
    : [
        argument.slice(prefixLength, equalsIndex),
        argument.slice(equalsIndex + 1),
      ];
}

function assertKnownOption(
  argument: string,
  name: string,
  knownNames: Set<string>,
): void {
  if (!knownNames.has(name)) {
    throw new Error(`Unknown option: ${argument}`);
  }
}

function assertUniqueOption(
  flags: Map<string, string | boolean>,
  name: string,
): void {
  if (flags.has(name)) {
    throw new Error(`Option may only be specified once: --${name}`);
  }
}

function parseBooleanOption(
  argument: string,
  inlineValue: string | undefined,
): boolean {
  if (inlineValue === undefined || inlineValue === "true") {
    return true;
  }
  if (inlineValue === "false") {
    return false;
  }
  throw new Error(`Boolean option must be true or false: ${argument}`);
}

function assertOptionValue(argument: string, value: string): string {
  if (value.length === 0 || value.startsWith("-")) {
    throw new Error(`Option requires a value: ${argument.split("=", 1)[0]}`);
  }
  return value;
}

function assertValidPositionals(args: ParsedArgs): void {
  if (args.positionals.length > 1) {
    throw new Error(`Unexpected argument: ${args.positionals[1]}`);
  }
  if (
    args.positionals.length > 0 &&
    (flagBoolean(args, "help") ||
      flagBoolean(args, "version") ||
      flagBoolean(args, "templates") ||
      flagBoolean(args, "list-templates"))
  ) {
    throw new Error(`Unexpected argument: ${args.positionals[0]}`);
  }
}

function printHelp(): void {
  console.log(`create-bmkl ${VERSION}`);
  console.log("Create a Vite bookmarklet project from a bmkl template.");
  console.log("");
  console.log("Source checkout:");
  console.log(
    "  pnpm --filter create-bmkl dev -- ./my-bookmarklet --local --template lit-shadow",
  );
  console.log("");
  console.log("After npm publication (not available yet):");
  console.log("  npm create bmkl@latest my-bookmarklet -- --template lit-shadow");
  console.log("  pnpm create bmkl my-bookmarklet --template ttsc-shadow");
  console.log("  pnpm create bmkl my-bookmarklet --template solid-query-shadow");
  console.log("  bun create bmkl my-bookmarklet --template vanilla-shadow");
  console.log("");
  console.log("Generated projects use the pinned pnpm version shown in package.json.");
  console.log("");
  console.log("Options:");
  console.log(`  -t, --template <name>   Template (${TEMPLATE_NAMES.join(" | ")})`);
  console.log("  -f, --force             Write into a non-empty directory");
  console.log("  --local                 Link prebuilt BMKL packages from this checkout");
  console.log("  --templates             List templates instead of creating");
  console.log("  --json                  Print JSON output");
  console.log("  -h, --help              Show this help");
  console.log("  -v, --version           Print version");
}

function printCreateResult(result: CreateProjectResult): void {
  console.log(
    `Created ${result.template.name} (${result.template.title}) at ${result.destination}`,
  );
  console.log(`Package manager: ${result.packageManager} (generated project policy)`);
  console.log(
    `Dependencies: ${result.dependencyMode === "local" ? "local BMKL source packages" : "published BMKL package versions"}`,
  );
  console.log("");
  console.log("Next:");
  console.log(`  cd ${result.destination}`);
  console.log("  pnpm install");
  console.log("  pnpm dev");
  console.log("");
  console.log("Build artifacts:");
  console.log("  pnpm build");
  console.log("  pnpm inspect");
}

function printTemplateInfos(templates: TemplateInfo[]): void {
  console.log("Vite templates:");
  for (const template of templates) {
    const defaultMarker = template.name === DEFAULT_TEMPLATE ? " (default)" : "";
    console.log(`  ${template.name}${defaultMarker}`);
    console.log(`    ${template.title} · ${template.language}`);
    console.log(`    ${template.description}`);
    console.log(`    Best for: ${template.recommendedFor}`);
  }
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOwnPackageVersion(): string {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
    version?: unknown;
  };
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid create-bmkl version in ${packageJsonUrl.pathname}`);
  }
  return metadata.version;
}

const cliArgv = process.argv.slice(2);

main([...cliArgv]).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (hasEnabledJsonFlag(cliArgv)) {
    console.log(JSON.stringify({ ok: false, error: { message } }, null, 2));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
});

function hasEnabledJsonFlag(argv: string[]): boolean {
  let sawArgument = false;
  for (const arg of argv) {
    if (arg === "--") {
      if (!sawArgument) {
        continue;
      }
      return false;
    }
    sawArgument = true;
    if (arg === "--json" || arg === "--json=true") {
      return true;
    }
  }
  return false;
}
