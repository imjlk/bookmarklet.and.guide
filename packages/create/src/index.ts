import { resolve } from "node:path";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_NAMES,
  createProject,
  listTemplateInfos,
  type CreateProjectResult,
  type TemplateInfo,
} from "@bmkl/templates";

const VERSION = "0.1.0";

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
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
      "templates",
      "version",
    ],
  });

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
    template: flagString(args, "template") ?? DEFAULT_TEMPLATE,
  });

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printCreateResult(result, detectPackageManager());
}

function parseArgs(
  argv: string[],
  options: {
    aliases?: Record<string, string>;
    booleans?: string[];
  } = {},
): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const aliases = options.aliases ?? {};
  const booleans = new Set(options.booleans ?? []);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split("=", 2);
      const name = aliases[rawName] ?? rawName;
      if (booleans.has(name)) {
        flags.set(name, inlineValue === undefined ? true : inlineValue !== "false");
      } else if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
      } else if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        flags.set(name, argv[index + 1]);
        index += 1;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const shortName = arg.slice(1);
      const name = aliases[shortName] ?? shortName;
      if (booleans.has(name)) {
        flags.set(name, true);
      } else if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        flags.set(name, argv[index + 1]);
        index += 1;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function printHelp(): void {
  console.log(`create-bmkl ${VERSION}`);
  console.log("Create a Vite bookmarklet project from a bmkl template.");
  console.log("");
  console.log("Usage:");
  console.log("  npm create bmkl@latest my-bookmarklet -- --template lit-shadow");
  console.log("  pnpm create bmkl my-bookmarklet --template ttsc-shadow");
  console.log("  pnpm create bmkl my-bookmarklet --template solid-query-shadow");
  console.log("  bun create bmkl my-bookmarklet --template vanilla-shadow");
  console.log("");
  console.log("Options:");
  console.log(`  -t, --template <name>   Template (${TEMPLATE_NAMES.join(" | ")})`);
  console.log("  -f, --force             Write into a non-empty directory");
  console.log("  --templates             List templates instead of creating");
  console.log("  --json                  Print JSON output");
  console.log("  -h, --help              Show this help");
  console.log("  -v, --version           Print version");
}

function printCreateResult(
  result: CreateProjectResult,
  packageManager: string,
): void {
  console.log(
    `Created ${result.template.name} (${result.template.title}) at ${result.destination}`,
  );
  console.log("");
  console.log("Next:");
  console.log(`  cd ${result.destination}`);
  console.log(`  ${installCommand(packageManager)}`);
  console.log(`  ${runCommand(packageManager, "dev")}`);
  console.log("");
  console.log("Build artifacts:");
  console.log(`  ${runCommand(packageManager, "build")}`);
  console.log(`  ${runCommand(packageManager, "inspect")}`);
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

function detectPackageManager(): string {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("bun")) {
    return "bun";
  }
  if (userAgent.startsWith("npm")) {
    return "npm";
  }
  if (userAgent.startsWith("yarn")) {
    return "yarn";
  }
  return "pnpm";
}

function installCommand(packageManager: string): string {
  if (packageManager === "yarn") {
    return "yarn";
  }
  return `${packageManager} install`;
}

function runCommand(packageManager: string, script: string): string {
  if (packageManager === "npm") {
    return `npm run ${script}`;
  }
  return `${packageManager} ${script}`;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
