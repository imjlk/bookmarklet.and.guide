import assert from "node:assert/strict";
import test from "node:test";
import { getPnpmCommand } from "./pnpm-command.mjs";

test("getPnpmCommand uses the active pnpm JavaScript entrypoint", () => {
  assert.deepEqual(
    getPnpmCommand(["install"], {
      env: {
        npm_config_user_agent: "pnpm/11.7.0 npm/? node/v22.12.0",
        npm_execpath: "/tools/pnpm.cjs",
      },
      execPath: "/tools/node",
      platform: "win32",
    }),
    {
      args: ["/tools/pnpm.cjs", "install"],
      command: "/tools/node",
    },
  );
});

test("getPnpmCommand falls back to PATH on non-Windows platforms", () => {
  assert.deepEqual(
    getPnpmCommand(["run", "build"], {
      env: {},
      platform: "linux",
    }),
    {
      args: ["run", "build"],
      command: "pnpm",
    },
  );
});

test("getPnpmCommand explains a missing pnpm entrypoint on Windows", () => {
  assert.throws(
    () =>
      getPnpmCommand([], {
        env: { npm_config_user_agent: "pnpm/11.7.0" },
        platform: "win32",
      }),
    /npm_execpath is unavailable/,
  );
  assert.throws(
    () => getPnpmCommand([], { env: {}, platform: "win32" }),
    /Run this script through pnpm/,
  );
});
