#!/usr/bin/env node

const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";

const npmCommand = isWindows ? "npm.cmd" : "npm";

const child = spawn(
  npmCommand,
  ["--prefix", "backend", "run", "start"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: process.env.PORT || "8082",
    },
    shell: isWindows,
  }
);

child.on("error", (error) => {
  console.error("[start] Failed to boot backend:", error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  if (!child.killed) child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  if (!child.killed) child.kill("SIGTERM");
});
