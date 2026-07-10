export function getPnpmCommand(args) {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const pnpmExecPath = process.env.npm_execpath;

  if (userAgent.startsWith("pnpm/") && pnpmExecPath) {
    return {
      args: [pnpmExecPath, ...args],
      command: process.execPath,
    };
  }

  if (process.platform === "win32") {
    throw new Error(
      "Run this script through pnpm so its Windows launcher can be resolved safely.",
    );
  }

  return { args, command: "pnpm" };
}
