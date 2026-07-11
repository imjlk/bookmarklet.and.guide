import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
      shell: false,
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

export async function runPackageBin(
  packageName: string,
  binName: string,
  args: string[],
  options: RunCommandOptions,
): Promise<void> {
  const requireFromProject = createRequire(resolve(options.cwd, "package.json"));
  let packageJsonPath: string;
  try {
    packageJsonPath = requireFromProject.resolve(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(
      `Could not resolve ${packageName} from ${options.cwd}. Install project dependencies first.`,
      { cause: error },
    );
  }

  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (!relativeBin) {
    throw new Error(`Package ${packageName} does not declare the ${binName} executable.`);
  }

  await runCommand(
    process.execPath,
    [resolve(dirname(packageJsonPath), relativeBin), ...args],
    options,
  );
}
