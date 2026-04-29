#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

if (args.length === 0) {
  run(pnpm, ["-r", "--parallel", "dev"]);
} else {
  run(pnpm, ["--filter", "@actalk/inkos-core", "build"]);
  run(pnpm, ["--filter", "@actalk/inkos", "build"]);
  run(process.execPath, [resolve(root, "packages/cli/dist/index.js"), ...args]);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
