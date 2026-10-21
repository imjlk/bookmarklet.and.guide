export function getPnpmCommand(args, options = {}) {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const userAgent = env.npm_config_user_agent ?? "";
  const pnpmExecPath = env.npm_execpath;

  if (userAgent.startsWith("pnpm/") && pnpmExecPath) {
    // Standalone pnpm (@pnpm/exe, the official install script) sets
    // npm_execpath to a native binary; only JavaScript entrypoints go through node.
    return /\.[cm]?js$/i.test(pnpmExecPath)
      ? { args: [pnpmExecPath, ...args], command: execPath }
      : { args, command: pnpmExecPath };
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
