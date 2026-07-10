export function getPnpmCommand(args, options = {}) {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const userAgent = env.npm_config_user_agent ?? "";
  const pnpmExecPath = env.npm_execpath;

  if (userAgent.startsWith("pnpm/") && pnpmExecPath) {
    return {
      args: [pnpmExecPath, ...args],
      command: execPath,
    };
  }

  if (platform === "win32") {
    throw new Error(
      userAgent.startsWith("pnpm/")
        ? "pnpm is active, but npm_execpath is unavailable on Windows."
        : "Run this script through pnpm so its Windows launcher can be resolved safely.",
    );
  }

  return { args, command: "pnpm" };
}
