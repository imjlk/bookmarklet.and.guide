import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { getPnpmCommand } from "./pnpm-command.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === "--") {
  cliArgs.shift();
}
const pnpm = getPnpmCommand([
  "--filter",
  "@bmkl/cli",
  "dev",
  "--",
  ...cliArgs,
]);
const child = spawn(
  pnpm.command,
  pnpm.args,
  {
    cwd: root,
    env: {
      ...process.env,
      BMKL_CWD: process.env.INIT_CWD ?? process.cwd(),
    },
    stdio: "inherit",
  },
);

let forwardedSignal;
const signalHandlers = new Map(
  ["SIGINT", "SIGTERM"].map((signal) => [
    signal,
    () => {
      forwardedSignal ??= signal;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    },
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.once(signal, handler);
}

const [code, signal] = await once(child, "exit");
for (const [signalName, handler] of signalHandlers) {
  process.removeListener(signalName, handler);
}

const finalSignal = forwardedSignal ?? signal;
process.exitCode =
  finalSignal === "SIGINT"
    ? 130
    : finalSignal === "SIGTERM"
      ? 143
      : code ?? 1;
