import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  BOOKMARKLET_RUNTIME_CHOICES,
  BOOKMARKLET_UPDATE_CHANNEL_CHOICES,
  BookmarkBuilder,
  loadConfig,
  type BookmarkletConfigOverrides,
} from "@bmkl/core";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_NAMES,
  createProject,
  listTemplateInfos,
  type CreateProjectResult,
  type TemplateInfo,
} from "@bmkl/templates";
import { satisfies } from "semver";

const VERSION = readOwnPackageVersion();
interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

interface ParseArgsOptions {
  aliases?: Record<string, string>;
  booleans?: string[];
  values?: string[];
}

interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

interface InstalledPackageManifest {
  peerDependencies?: Record<string, unknown>;
  version?: unknown;
}

type InstalledPackageManifestResult =
  | { status: "found"; manifest: InstalledPackageManifest }
  | { status: "missing" }
  | { status: "unreadable"; message: string };

interface ContractSmokeResult {
  ok: true;
  bridgeType: string;
  debugEventType: string;
  manifestRuntime: string;
}

interface ContractsModule {
  assertBmklBridgeMessage(input: unknown): unknown;
  assertBmklDebugReport(input: unknown): unknown;
  parseBmklDebugEventJson(input: string): unknown;
  parseBmklRemoteManifestJson(input: string): unknown;
  runBmklContractSmoke(): ContractSmokeResult;
}

async function main(argv: string[]): Promise<void> {
  while (argv[0] === "--") {
    argv.shift();
  }

  const [commandName, ...rest] = argv;

  if (!commandName) {
    await printRootHelp();
    return;
  }

  if (isHelp(commandName)) {
    assertNoPositionals(parseArgs(rest), "bmkl --help");
    await printRootHelp();
    return;
  }

  if (isVersion(commandName)) {
    assertNoPositionals(parseArgs(rest), "bmkl --version");
    console.log(VERSION);
    return;
  }

  switch (commandName) {
    case "create":
    case "init":
      await runCreate(rest);
      return;
    case "templates":
      await runTemplates(rest);
      return;
    case "dev":
      await runDev(rest);
      return;
    case "companion":
      await runCompanion(rest);
      return;
    case "build":
      await runBuild(rest);
      return;
    case "inspect":
      await runInspect(rest);
      return;
    case "install-page":
      await runInstallPage(rest);
      return;
    case "doctor":
      await runDoctor(rest);
      return;
    case "contracts":
    case "contract":
      await runContracts(rest);
      return;
    default:
      throw new Error(`Unknown command: ${commandName}. Run bmkl --help to list commands.`);
  }
}

async function runCreate(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      f: "force",
      t: "template",
    },
    booleans: ["force", "help", "json", "local"],
    values: ["template"],
  });

  assertAtMostPositionals(args, 1, "bmkl create <dir>");

  if (flagBoolean(args, "help")) {
    printCreateHelp();
    return;
  }

  const target = args.positionals[0];
  if (!target) {
    throw new Error("Missing project directory. Usage: bmkl create <dir>");
  }

  const result = await createProject({
    destination: resolve(getInvocationCwd(), target),
    force: flagBoolean(args, "force"),
    local: flagBoolean(args, "local"),
    template: flagString(args, "template") ?? DEFAULT_TEMPLATE,
  });

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printCreateResult(result, target);
}

async function runTemplates(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    booleans: ["help", "json"],
  });

  assertNoPositionals(args, "bmkl templates");

  if (flagBoolean(args, "help")) {
    printTemplatesHelp();
    return;
  }

  const templates = await listTemplateInfos();
  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(templates, null, 2));
    return;
  }

  printTemplateInfos(templates);
}

async function runBuild(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
    },
    booleans: ["help", "json", "print-bookmarklet"],
    values: ["base-url", "channel", "config", "runtime"],
  });

  assertNoPositionals(args, "bmkl build");
  assertMutuallyExclusive(args, "json", "print-bookmarklet");

  if (flagBoolean(args, "help")) {
    printBuildHelp();
    return;
  }

  const overrides: BookmarkletConfigOverrides = {};
  const runtime = validateChoice(
    "runtime",
    flagString(args, "runtime"),
    BOOKMARKLET_RUNTIME_CHOICES,
  );
  const channel = validateChoice(
    "channel",
    flagString(args, "channel"),
    BOOKMARKLET_UPDATE_CHANNEL_CHOICES,
  );
  const baseUrl = flagString(args, "base-url");
  if (runtime) {
    overrides.runtime = runtime;
  }
  if (channel) {
    overrides.channel = channel;
  }
  if (baseUrl) {
    overrides.remote = { baseUrl };
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
    overrides,
  });
  const result = await new BookmarkBuilder(config).build({
    quiet:
      flagBoolean(args, "json") || flagBoolean(args, "print-bookmarklet"),
  });

  if (flagBoolean(args, "print-bookmarklet")) {
    console.log(result.bookmarkletUrl);
    return;
  }

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(createBuildSummary(result), null, 2));
    return;
  }

  printBuildResult(result);
}

async function runInspect(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
    },
    booleans: ["help", "json"],
    values: ["config"],
  });

  assertNoPositionals(args, "bmkl inspect");

  if (flagBoolean(args, "help")) {
    printInspectHelp();
    return;
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
  });
  const result = await new BookmarkBuilder(config).inspect();

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printInspectResult(result);
}

async function runInstallPage(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
    },
    booleans: ["help", "json"],
    values: ["config"],
  });

  assertNoPositionals(args, "bmkl install-page");

  if (flagBoolean(args, "help")) {
    printInstallPageHelp();
    return;
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
  });
  if (config.output?.installHtml === false) {
    throw new Error(
      "Install page output is disabled. Set output.installHtml to true in the bookmarklet config.",
    );
  }

  const result = await new BookmarkBuilder(config).build({
    quiet: flagBoolean(args, "json"),
  });
  const installPage = result.artifacts.find((artifact) => artifact.kind === "install-html");
  if (!installPage) {
    throw new Error("Build completed without an install page artifact.");
  }

  if (flagBoolean(args, "json")) {
    console.log(
      JSON.stringify(
        {
          path: installPage.path,
          relativePath: relative(config.root, installPage.path),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(installPage.path);
}

async function runDev(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
      p: "port",
    },
    booleans: [
      "debug",
      "help",
      "https",
      "open",
      "print-bookmarklets",
      "strict-port",
    ],
    values: ["config", "host", "port", "target"],
  });

  assertNoPositionals(args, "bmkl dev");

  if (flagBoolean(args, "help")) {
    printDevHelp();
    return;
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
  });
  const server = await new BookmarkBuilder(config).dev({
    debug: flagBoolean(args, "debug"),
    host: flagString(args, "host") ?? "127.0.0.1",
    https: flagBoolean(args, "https"),
    port: flagPort(args, "port") ?? 5173,
    strictPort: flagBoolean(args, "strict-port"),
    open: flagBoolean(args, "open"),
    target: flagString(args, "target"),
  });

  console.log(`Vite: ${server.url}`);
  console.log(`Setup: ${server.setupUrl}`);
  for (const networkSetupUrl of server.networkSetupUrls) {
    console.log(`Setup (network): ${networkSetupUrl}`);
  }
  if (server.debugConsoleUrl) {
    console.log(`Debug console: ${server.debugConsoleUrl}`);
  }
  if (server.target) {
    console.log(`Target: ${server.target}`);
  }
  console.log("");
  console.log("Open Setup to drag or copy the install-once bookmarklet.");
  console.log("Keep this server running while you test target pages.");
  if (server.debugBookmarkletUrl) {
    console.log("");
    printDevDebugFlow(server.target);
  }
  if (flagBoolean(args, "print-bookmarklets")) {
    printDevBookmarklets(server);
  }

  await new Promise<void>((resolvePromise) => {
    const close = async () => {
      await server.close();
      resolvePromise();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

async function runCompanion(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
      p: "port",
    },
    booleans: ["help", "json"],
    values: [
      "config",
      "debug-console-url",
      "host",
      "out-dir",
      "port",
      "target",
    ],
  });

  assertNoPositionals(args, "bmkl companion");

  if (flagBoolean(args, "help")) {
    printCompanionHelp();
    return;
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
  });
  const result = await new BookmarkBuilder(config).companion({
    debugConsoleUrl: flagString(args, "debug-console-url"),
    host: flagString(args, "host") ?? "127.0.0.1",
    outDir: flagString(args, "out-dir"),
    port: flagPort(args, "port") ?? 5173,
    quiet: flagBoolean(args, "json"),
    target: flagString(args, "target"),
  });

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printCompanionResult(config.root, result);
}

async function runDoctor(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    aliases: {
      c: "config",
    },
    booleans: ["help", "json"],
    values: ["config"],
  });

  assertNoPositionals(args, "bmkl doctor");

  if (flagBoolean(args, "help")) {
    printDoctorHelp();
    return;
  }

  const config = await loadConfig({
    cwd: getInvocationCwd(),
    configFile: flagString(args, "config"),
  });
  const checks: DoctorCheck[] = [];

  const entryPath = resolve(config.root, config.entry);
  checks.push(
    isRegularFile(entryPath)
      ? {
          name: "entry",
          status: "pass",
          message: `Found ${relative(config.root, entryPath)}`,
        }
      : {
          name: "entry",
          status: "fail",
          message: `Missing ${relative(config.root, entryPath)}`,
        },
  );

  const tsconfigPath = resolve(config.root, config.ttsc?.project ?? "tsconfig.json");
  checks.push(
    !config.ttsc?.enabled || isRegularFile(tsconfigPath)
      ? {
          name: "ttsc-project",
          status: "pass",
          message: config.ttsc?.enabled
            ? `Found ${relative(config.root, tsconfigPath)}`
            : "ttsc checks are disabled",
        }
      : {
          name: "ttsc-project",
          status: "fail",
          message: `Missing ${relative(config.root, tsconfigPath)}`,
        },
  );

  if (config.ttsc?.enabled) {
    const ttscLauncher = resolveInstalledPackageBin(config.root, "ttsc", "ttsc");
    const ttscVersion = ttscLauncher
      ? spawnSync(process.execPath, [ttscLauncher, "--version"], {
          cwd: config.root,
          encoding: "utf8",
          shell: false,
        })
      : undefined;
    checks.push(
      ttscVersion?.status === 0
        ? {
            name: "ttsc-binary",
            status: "pass",
            message: ttscVersion.stdout.trim() || "ttsc executable is available",
          }
        : {
            name: "ttsc-binary",
            status: "fail",
            message: "Could not run the project-local ttsc --version",
          },
    );
    checks.push(createTtscGraphCompatibilityCheck(config.root));
  } else {
    checks.push({
      name: "ttsc-binary",
      status: "pass",
      message: "ttsc checks are disabled",
    });
    checks.push({
      name: "ttsc-graph",
      status: "pass",
      message: "ttsc checks are disabled",
    });
  }

  try {
    const smoke = await runContractSmoke();
    checks.push({
      name: "typia-contracts",
      status: "pass",
      message: `${smoke.debugEventType}, ${smoke.bridgeType}, ${smoke.manifestRuntime}`,
    });
  } catch (error) {
    checks.push({
      name: "typia-contracts",
      status: "fail",
      message:
        error instanceof Error
          ? error.message
          : "typia contract smoke failed",
    });
  }

  checks.push(createRemoteBaseUrlCheck(config.runtime, config.remote?.baseUrl));

  const inspect = await new BookmarkBuilder(config).inspect();
  checks.push(
    inspect.artifacts.length === 0
      ? {
          name: "artifacts",
          status: "warn",
          message: "Run bmkl build to generate bookmarklet artifacts.",
        }
      : inspect.warnings.length > 0
        ? {
            name: "artifacts",
            status: "fail",
            message: inspect.warnings.join(" "),
          }
        : {
            name: "artifacts",
            status: "pass",
            message: `Found ${inspect.artifacts.length} generated artifact(s).`,
          },
  );

  const report = {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
  };

  if (flagBoolean(args, "json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorResult(checks);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function runContracts(argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    booleans: ["help", "json"],
  });

  if (flagBoolean(args, "help")) {
    printContractsHelp();
    return;
  }

  const [command, file] = args.positionals;
  if (!command) {
    throw new Error("Missing contracts command. Usage: bmkl contracts <command>");
  }

  if (command === "smoke") {
    assertExactPositionals(args, 1, "bmkl contracts smoke");
    const smoke = await runContractSmoke();
    printContractValidationResult("smoke", undefined, smoke, flagBoolean(args, "json"));
    return;
  }

  const validationCommands = new Set([
    "validate-bridge-message",
    "validate-debug-event",
    "validate-debug-report",
    "validate-manifest",
  ]);
  if (!validationCommands.has(command)) {
    throw new Error(`Unknown contracts command: ${command}`);
  }
  assertExactPositionals(args, 2, `bmkl contracts ${command} <file>`);

  const path = resolve(getInvocationCwd(), file);
  const text = await readFile(path, "utf8");
  let value: unknown;

  value = await withContractsModule((contracts) => {
    switch (command) {
      case "validate-debug-event":
        return contracts.parseBmklDebugEventJson(text);
      case "validate-debug-report":
        return contracts.assertBmklDebugReport(JSON.parse(text));
      case "validate-manifest":
        return contracts.parseBmklRemoteManifestJson(text);
      case "validate-bridge-message":
        return contracts.assertBmklBridgeMessage(JSON.parse(text));
      default:
        throw new Error(`Unknown contracts command: ${command}`);
    }
  });

  printContractValidationResult(command, path, value, flagBoolean(args, "json"));
}

function parseArgs(
  argv: string[],
  options: ParseArgsOptions = {},
): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  const booleans = new Set(["help", ...(options.booleans ?? [])]);
  const values = new Set(options.values ?? []);
  const aliases: Record<string, string> = { h: "help", ...options.aliases };
  const known = new Set([...booleans, ...values]);

  for (const [alias, name] of Object.entries(aliases)) {
    if (!known.has(name)) {
      throw new Error(`Invalid CLI parser alias: -${alias} maps to --${name}.`);
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = splitOptionArgument(arg, 2);
      const name = aliases[rawName] ?? rawName;
      assertKnownOption(arg, name, known);
      assertOptionNotRepeated(flags, name);
      if (booleans.has(name)) {
        flags.set(name, parseBooleanOption(name, inlineValue));
      } else if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          throw new Error(`Missing value for --${name}.`);
        }
        flags.set(name, inlineValue);
      } else if (isOptionValue(argv[index + 1])) {
        flags.set(name, argv[index + 1] as string);
        index += 1;
      } else {
        throw new Error(`Missing value for --${name}.`);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const [shortName, inlineValue] = splitOptionArgument(arg, 1);
      const name = aliases[shortName] ?? shortName;
      assertKnownOption(arg, name, known);
      assertOptionNotRepeated(flags, name);
      if (booleans.has(name)) {
        flags.set(name, parseBooleanOption(name, inlineValue));
      } else if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          throw new Error(`Missing value for --${name}.`);
        }
        flags.set(name, inlineValue);
      } else if (isOptionValue(argv[index + 1])) {
        flags.set(name, argv[index + 1] as string);
        index += 1;
      } else {
        throw new Error(`Missing value for --${name}.`);
      }
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function assertKnownOption(
  arg: string,
  name: string,
  known: ReadonlySet<string>,
): void {
  if (!name || !known.has(name)) {
    throw new Error(`Unknown option: ${arg}`);
  }
}

function splitOptionArgument(
  argument: string,
  prefixLength: number,
): [name: string, inlineValue: string | undefined] {
  const equalsIndex = argument.indexOf("=", prefixLength);
  return equalsIndex === -1
    ? [argument.slice(prefixLength), undefined]
    : [argument.slice(prefixLength, equalsIndex), argument.slice(equalsIndex + 1)];
}

function assertOptionNotRepeated(
  flags: ReadonlyMap<string, string | boolean>,
  name: string,
): void {
  if (flags.has(name)) {
    throw new Error(`Option --${name} may only be provided once.`);
  }
}

function parseBooleanOption(
  name: string,
  inlineValue: string | undefined,
): boolean {
  if (inlineValue === undefined) {
    return true;
  }
  if (inlineValue === "true") {
    return true;
  }
  if (inlineValue === "false") {
    return false;
  }
  throw new Error(`Invalid boolean for --${name}: ${inlineValue}. Use true or false.`);
}

function isOptionValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !value.startsWith("-");
}

async function printRootHelp(): Promise<void> {
  console.log(`bmkl ${VERSION}`);
  console.log("Create Vite-powered bookmarklets and build installable artifacts.");
  console.log("");
  console.log("Commands:");
  console.log("  create <dir>    Scaffold a project (alias: init)");
  console.log("  templates       Compare maintained starters");
  console.log("  dev             Start Vite and the bookmarklet setup page");
  console.log("  build           Build remote and inline artifacts");
  console.log("  inspect         Inspect generated artifact sizes and contracts");
  console.log("  doctor          Check config, compiler, contracts, and artifacts");
  console.log("  install-page    Rebuild and print the production install page");
  console.log("  companion       Build an unpacked strict-CSP test extension");
  console.log("  contracts       Validate external BMKL payloads");
  console.log("");
  console.log("Start:");
  console.log("  bmkl create my-bookmarklet --template lit-shadow");
  console.log("  bmkl templates");
  console.log("");
  console.log("Run bmkl <command> --help for command options. bmk is a short alias.");
}

function printCreateHelp(): void {
  console.log("Usage:");
  console.log("  bmkl create <dir> [options]");
  console.log("");
  console.log("Options:");
  console.log(`  -t, --template <name>   Template (${TEMPLATE_NAMES.join(" | ")})`);
  console.log("  -f, --force             Write into a non-empty directory");
  console.log("  --local                 Link prebuilt BMKL packages from this checkout");
  console.log("  --json                  Print created project metadata as JSON");
  console.log("  -h, --help              Show this help");
}

function printTemplatesHelp(): void {
  console.log("Usage:");
  console.log("  bmkl templates [--json]");
  console.log("");
  console.log("Options:");
  console.log("  --json      Print template metadata as JSON");
  console.log("  -h, --help  Show this help");
}

function printBuildHelp(): void {
  console.log("Usage:");
  console.log("  bmkl build [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>       Path to bookmarklet config file");
  console.log("  --runtime <runtime>       inline | remote");
  console.log("  --channel <channel>       dev | canary | latest | pinned");
  console.log("  --base-url <url>          Override remote.baseUrl");
  console.log("  --print-bookmarklet       Print only the bookmarklet URL");
  console.log("  --json                    Print build metadata as JSON");
  console.log("  -h, --help                Show this help");
}

function printInspectHelp(): void {
  console.log("Usage:");
  console.log("  bmkl inspect [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>  Path to bookmarklet config file");
  console.log("  --json               Print inspection result as JSON");
  console.log("  -h, --help           Show this help");
}

function printInstallPageHelp(): void {
  console.log("Usage:");
  console.log("  bmkl install-page [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>  Path to bookmarklet config file");
  console.log("  --json               Print install page metadata as JSON");
  console.log("  -h, --help           Show this help");
}

function printDevHelp(): void {
  console.log("Usage:");
  console.log("  bmkl dev [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>  Path to bookmarklet config file");
  console.log(
    "  --debug             Print a debug bookmarklet and serve the local debug console",
  );
  console.log("  --host <host>        Dev server host (default: 127.0.0.1)");
  console.log("  --https             Serve the dev module and debug console over HTTPS");
  console.log("  -p, --port <port>    Dev server port (default: 5173)");
  console.log("  --strict-port        Fail instead of moving to another port");
  console.log("  --open               Open the bookmarklet setup page");
  console.log("  --print-bookmarklets Print raw bookmarklet URLs in the terminal");
  console.log("  --target <url>       Target site URL to print in the debug test flow");
  console.log("  -h, --help           Show this help");
}

function printDevDebugFlow(target?: string): void {
  console.log("Target-site debug flow:");
  console.log(`  1. Open ${target ?? "the real target site"} in your browser.`);
  console.log("  2. Open Setup and drag BMKL debug to your bookmarks bar.");
  console.log("  3. Click BMKL debug while you are on the target site.");
  console.log(
    "  4. Reproduce the issue and watch the terminal, local console, and in-page overlay.",
  );
  console.log(
    "  5. Keep the console window open when popup policy allows it; direct localhost collection still runs.",
  );
  console.log(
    "  6. If CSP, popup policy, or the bridge blocks delivery, click Copy report in the overlay.",
  );
  console.log("  7. Keep using the same bookmark while the dev host and port stay the same.");
  console.log(
    "  8. If script-src or strict inline policy blocks the bookmarklet path, build a companion extension with bmkl companion.",
  );
}

function printDevBookmarklets(
  server: Awaited<ReturnType<BookmarkBuilder["dev"]>>,
): void {
  console.log("");
  console.log("Raw bookmarklet URLs:");
  console.log("  Install-once dev:");
  console.log(server.launcherBookmarkletUrl);
  console.log("  Direct dev:");
  console.log(server.bookmarkletUrl);
  if (server.debugLauncherBookmarkletUrl) {
    console.log("  Install-once debug:");
    console.log(server.debugLauncherBookmarkletUrl);
  }
  if (server.debugBookmarkletUrl) {
    console.log("  Direct debug:");
    console.log(server.debugBookmarkletUrl);
  }
}

function printCompanionHelp(): void {
  console.log("Build an unpacked Chrome MV3 extension for strict CSP target-site testing.");
  console.log("");
  console.log("Usage:");
  console.log("  bmkl companion [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>          Path to bookmarklet config file");
  console.log(
    "  --target <url-or-pattern>    Target URL or Chrome match pattern (default: <all_urls>)",
  );
  console.log(
    "  --debug-console-url <url>    Debug console URL (default: http://127.0.0.1:5173/__bmkl/debug)",
  );
  console.log("  --host <host>                Debug console host when URL is not provided");
  console.log("  -p, --port <port>            Debug console port when URL is not provided");
  console.log("  --out-dir <dir>              Extension output directory");
  console.log("  --json                       Print companion metadata as JSON");
  console.log("  -h, --help                   Show this help");
}

function printDoctorHelp(): void {
  console.log("Usage:");
  console.log("  bmkl doctor [options]");
  console.log("");
  console.log("Options:");
  console.log("  -c, --config <file>  Path to bookmarklet config file");
  console.log("  --json               Print diagnostic report as JSON");
  console.log("  -h, --help           Show this help");
}

function printContractsHelp(): void {
  console.log("Usage:");
  console.log("  bmkl contracts smoke [--json]");
  console.log("  bmkl contracts validate-debug-event <file> [--json]");
  console.log("  bmkl contracts validate-debug-report <file> [--json]");
  console.log("  bmkl contracts validate-manifest <file> [--json]");
  console.log("  bmkl contracts validate-bridge-message <file> [--json]");
  console.log("");
  console.log("Options:");
  console.log("  --json      Print validation result as JSON");
  console.log("  -h, --help  Show this help");
}

function printCreateResult(
  result: CreateProjectResult,
  destinationArgument: string,
): void {
  console.log(
    `Created ${result.template.name} (${result.template.title}) at ${result.destination}`,
  );
  console.log(`Package manager: ${result.packageManager} (generated project policy)`);
  console.log(
    `Dependencies: ${result.dependencyMode === "local" ? "local BMKL source packages" : "published BMKL package versions"}`,
  );
  console.log("");
  console.log("Next:");
  printChangeDirectory(destinationArgument);
  printPnpmPrerequisite(result.packageManager);
  console.log("  pnpm install");
  console.log("  pnpm dev");
  console.log("");
  console.log("Build artifacts:");
  console.log("  pnpm build");
  console.log("  pnpm inspect");
}

function printPnpmPrerequisite(packageManager: string): void {
  const probe = spawnSync(
    process.platform === "win32" ? "where.exe" : "pnpm",
    process.platform === "win32" ? ["pnpm"] : ["--version"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (probe.status === 0) {
    return;
  }

  console.log(
    `  # Prerequisite: install or enable ${packageManager} (for example: corepack enable)`,
  );
}

function printChangeDirectory(value: string): void {
  if (process.platform === "win32") {
    console.log("  # Windows PowerShell");
    console.log(`  Set-Location -LiteralPath '${value.replaceAll("'", "''")}'`);
    return;
  }

  const shellPath = value.startsWith("-") ? `./${value}` : value;
  if (/^[a-zA-Z0-9_./:@+-]+$/.test(shellPath)) {
    console.log(`  cd ${shellPath}`);
    return;
  }
  console.log(`  cd '${shellPath.replaceAll("'", `'"'"'`)}'`);
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
  console.log("");
  console.log("Create with:");
  console.log("  bmkl create my-bookmarklet --template lit-shadow");
}

function printBuildResult(
  result: Awaited<ReturnType<BookmarkBuilder["build"]>>,
): void {
  console.log(`Built ${result.config.name}`);
  console.log(`Runtime: ${result.config.runtime} / Channel: ${result.config.channel}`);
  console.log("");
  console.log("Artifacts:");
  for (const artifact of result.artifacts) {
    console.log(
      `  ${artifact.kind.padEnd(12)} ${relative(result.config.root, artifact.path)} (${formatBytes(artifact.size)})`,
    );
  }

  const bookmarklet = result.artifacts.find(
    (artifact) =>
      artifact.kind === "bookmarklet" &&
      isPathInside(
        resolve(result.config.root, result.config.outDir, "remote"),
        artifact.path,
      ),
  );
  const installPage = result.artifacts.find((artifact) => artifact.kind === "install-html");

  console.log("");
  if (bookmarklet) {
    console.log(`Bookmarklet file: ${relative(result.config.root, bookmarklet.path)}`);
  }
  if (installPage) {
    console.log(`Install page: ${relative(result.config.root, installPage.path)}`);
  }
  console.log("Raw URL: bmkl build --print-bookmarklet");

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

function printInspectResult(
  result: Awaited<ReturnType<BookmarkBuilder["inspect"]>>,
): void {
  console.log(`Bookmarklet length: ${result.bookmarkletLength} chars`);
  console.log("");
  console.log("Artifacts:");
  for (const artifact of result.artifacts) {
    console.log(
      `  ${artifact.kind.padEnd(12)} ${artifact.fileName} (${formatBytes(artifact.size)})`,
    );
  }

  if (result.manifest) {
    console.log("");
    console.log(
      `Manifest: ${result.manifest.runtime}/${result.manifest.channel} -> ${result.manifest.entry}`,
    );
  }

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

function printCompanionResult(
  root: string,
  result: Awaited<ReturnType<BookmarkBuilder["companion"]>>,
): void {
  console.log("Built BMKL companion extension");
  console.log("");
  console.log(`Extension: ${relative(root, result.outDir)}`);
  console.log(`Manifest:  ${relative(root, result.manifestPath)}`);
  console.log(`Content:   ${relative(root, result.contentScriptPath)}`);
  console.log(`Target:    ${result.targetMatch}`);
  console.log(`Console:   ${result.debugConsoleUrl}`);
  console.log("");
  console.log("Companion test flow:");
  console.log("  1. Run bmkl dev --debug --target <same target> in this project.");
  console.log("  2. Open chrome://extensions and enable Developer mode.");
  console.log("  3. Load the Extension directory above as an unpacked extension.");
  console.log("  4. Open a strict CSP target page that matches the Target pattern.");
  console.log("  5. The companion runs automatically; click the extension action to rerun.");
  console.log("  6. Watch the terminal, debug console, and BMKL companion overlay.");
  console.log("  7. Re-run bmkl companion and reload the extension after source changes.");
}

function printDoctorResult(checks: DoctorCheck[]): void {
  console.log("Doctor:");
  for (const check of checks) {
    console.log(`  ${check.status.padEnd(4)} ${check.name}: ${check.message}`);
  }
}

function printContractValidationResult(
  command: string,
  file: string | undefined,
  value: unknown,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify({ ok: true, command, file, value }, null, 2));
    return;
  }

  const suffix = file ? ` ${formatDisplayPath(file)}` : "";
  console.log(`pass contracts ${command}${suffix}`);
}

function createBuildSummary(
  result: Awaited<ReturnType<BookmarkBuilder["build"]>>,
) {
  return {
    name: result.config.name,
    runtime: result.config.runtime,
    channel: result.config.channel,
    bookmarkletLength: result.bookmarkletUrl.length,
    artifacts: result.artifacts.map((artifact) => ({
      kind: artifact.kind,
      fileName: artifact.fileName,
      path: artifact.path,
      relativePath: relative(result.config.root, artifact.path),
      size: artifact.size,
    })),
    warnings: result.warnings,
  };
}

function assertNoPositionals(args: ParsedArgs, usage: string): void {
  assertExactPositionals(args, 0, usage);
}

function assertAtMostPositionals(
  args: ParsedArgs,
  maximum: number,
  usage: string,
): void {
  if (args.positionals.length > maximum) {
    throw new Error(`Unexpected argument: ${args.positionals[maximum]}. Usage: ${usage}`);
  }
}

function assertExactPositionals(
  args: ParsedArgs,
  expected: number,
  usage: string,
): void {
  if (args.positionals.length < expected) {
    throw new Error(`Missing argument. Usage: ${usage}`);
  }
  assertAtMostPositionals(args, expected, usage);
}

function assertMutuallyExclusive(
  args: ParsedArgs,
  first: string,
  second: string,
): void {
  if (flagBoolean(args, first) && flagBoolean(args, second)) {
    throw new Error(`Options --${first} and --${second} cannot be used together.`);
  }
}

function flagBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for --${name}: ${value}`);
  }
  return parsed;
}

function flagPort(args: ParsedArgs, name: string): number | undefined {
  const port = flagNumber(args, name);
  if (port === undefined) {
    return undefined;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for --${name}: ${port}. Choose 1-65535.`);
  }
  return port;
}

function validateChoice<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  choices: T,
): T[number] | undefined {
  if (!value) {
    return undefined;
  }

  if ((choices as readonly string[]).includes(value)) {
    return value as T[number];
  }

  throw new Error(`Invalid --${name}: ${value}. Choose ${choices.join(" | ")}.`);
}

function createRemoteBaseUrlCheck(
  runtime: string,
  baseUrl: string | undefined,
): DoctorCheck {
  let url: URL;
  try {
    if (!baseUrl) {
      throw new Error("missing URL");
    }
    url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    if (url.username || url.password) {
      throw new Error("credentials are not allowed");
    }
    if (url.search || url.hash) {
      throw new Error("query parameters and fragments are not allowed");
    }
  } catch {
    return {
      name: "remote-base-url",
      status: "warn",
      message:
        "remote.baseUrl must be an absolute HTTP(S) URL without credentials, a query, or a fragment.",
    };
  }

  if (runtime === "inline") {
    return {
      name: "remote-base-url",
      status: "pass",
      message: "Not required for the inline runtime.",
    };
  }
  if (url.hostname === "example.com") {
    return {
      name: "remote-base-url",
      status: "warn",
      message: "remote.baseUrl still uses the example.com placeholder.",
    };
  }
  return {
    name: "remote-base-url",
    status: "pass",
    message: url.toString(),
  };
}

function createTtscGraphCompatibilityCheck(root: string): DoctorCheck {
  const graphResult = readInstalledPackageManifest(root, "@ttsc/graph");
  if (graphResult.status === "missing") {
    return {
      name: "ttsc-graph",
      status: "warn",
      message: "@ttsc/graph is not installed; code graph support is optional.",
    };
  }
  if (graphResult.status === "unreadable") {
    return {
      name: "ttsc-graph",
      status: "fail",
      message: `Could not read @ttsc/graph package metadata: ${graphResult.message}`,
    };
  }

  const ttscResult = readInstalledPackageManifest(root, "ttsc");
  if (ttscResult.status !== "found") {
    return {
      name: "ttsc-graph",
      status: "fail",
      message:
        ttscResult.status === "missing"
          ? "@ttsc/graph is installed but ttsc package metadata is missing."
          : `Could not read ttsc package metadata: ${ttscResult.message}`,
    };
  }

  const graph = graphResult.manifest;
  const ttsc = ttscResult.manifest;
  const graphVersion = readManifestVersion(graph);
  const ttscVersion = readManifestVersion(ttsc);
  const expectedTtscRange = graph.peerDependencies?.ttsc;
  if (!graphVersion || !ttscVersion || typeof expectedTtscRange !== "string") {
    return {
      name: "ttsc-graph",
      status: "fail",
      message: "Could not verify the installed ttsc and @ttsc/graph versions.",
    };
  }
  if (!satisfies(ttscVersion, expectedTtscRange)) {
    return {
      name: "ttsc-graph",
      status: "fail",
      message: `@ttsc/graph ${graphVersion} expects ttsc ${expectedTtscRange}, found ${ttscVersion}. Upgrade both together.`,
    };
  }
  return {
    name: "ttsc-graph",
    status: "pass",
    message: `ttsc ${ttscVersion} and @ttsc/graph ${graphVersion} are protocol-compatible.`,
  };
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readOwnPackageVersion(): string {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
    version?: unknown;
  };
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid @bmkl/cli version in ${packageJsonUrl.pathname}`);
  }
  return metadata.version;
}

function readInstalledPackageManifest(
  root: string,
  packageName: string,
): InstalledPackageManifestResult {
  try {
    const requireFromProject = createRequire(resolve(root, "package.json"));
    const packageJsonPath = requireFromProject.resolve(`${packageName}/package.json`);
    return {
      status: "found",
      manifest: JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as InstalledPackageManifest,
    };
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      return { status: "missing" };
    }
    return {
      status: "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function isModuleNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND"
  );
}

function readManifestVersion(
  manifest: InstalledPackageManifest,
): string | undefined {
  return typeof manifest.version === "string" && manifest.version.length > 0
    ? manifest.version
    : undefined;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} kB`;
}

function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent.length > 0 &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function resolveInstalledPackageBin(
  root: string,
  packageName: string,
  binName: string,
): string | undefined {
  try {
    const requireFromProject = createRequire(resolve(root, "package.json"));
    const packageJsonPath = requireFromProject.resolve(`${packageName}/package.json`);
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const relativeBin =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
    if (!relativeBin) {
      return undefined;
    }
    const binPath = resolve(dirname(packageJsonPath), relativeBin);
    return isRegularFile(binPath) ? binPath : undefined;
  } catch {
    return undefined;
  }
}

function isHelp(value: string): boolean {
  return value === "--help" || value === "-h";
}

function isVersion(value: string): boolean {
  return value === "--version" || value === "-v";
}

function getInvocationCwd(): string {
  return process.env.BMKL_CWD || process.cwd();
}

function formatDisplayPath(path: string): string {
  const cwd = getInvocationCwd();
  return path.startsWith(`${cwd}/`) ? relative(cwd, path) : path;
}

async function runContractSmoke(): Promise<ContractSmokeResult> {
  return withContractsModule((contracts) => contracts.runBmklContractSmoke());
}

async function withContractsModule<T>(
  useContracts: (contracts: ContractsModule) => T,
): Promise<T> {
  try {
    const contracts = await importContractsPackage();
    return useContracts(contracts);
  } catch (error) {
    if (!isTypiaTransformMissing(error)) {
      throw error;
    }
  }

  try {
    return useContracts(await importContractsDist());
  } catch (error) {
    throw new Error("Could not load compiled @bmkl/contracts after typia transform fallback.", {
      cause: error,
    });
  }
}

async function importContractsPackage(): Promise<ContractsModule> {
  return (await import("@bmkl/contracts")) as ContractsModule;
}

async function importContractsDist(): Promise<ContractsModule> {
  const specifier = "../../contracts/dist/index.js";
  return (await import(specifier)) as ContractsModule;
}

function isTypiaTransformMissing(error: unknown): boolean {
  return error instanceof Error && error.message.includes("no transform has been configured");
}

const cliArgv = process.argv.slice(2);

main([...cliArgv]).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (hasEnabledJsonFlag(cliArgv)) {
    console.log(JSON.stringify({ ok: false, error: { message } }, null, 2));
  } else {
    console.error(message);
  }
  if (process.env.BMKL_DEBUG && error instanceof Error && error.stack) {
    console.error(error.stack);
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
