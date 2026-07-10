import { spawn } from "node:child_process";

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  quiet?: boolean;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: process.platform === "win32",
      stdio: options.quiet
        ? ["inherit", process.stderr, process.stderr]
        : "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
          ),
        );
      }
    });
  });
}
