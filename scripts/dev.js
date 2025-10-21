#!/usr/bin/env node

const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";

const npmCommand = isWindows ? "npm.cmd" : "npm";

const commands = [
  { name: "backend", args: buildArgs("backend", "dev") },
  { name: "frontend", args: buildArgs("frontend", "dev") },
];

function buildArgs(prefix, script) {
  return ["--prefix", prefix, "run", script];
}

const spawnOptions = {
  stdio: "inherit",
  env: process.env,
};

const children = [];
let shuttingDown = false;

function terminate(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child && !child.killed) {
      child.kill("SIGINT");
    }
  }
  // Small delay to allow processes to exit gracefully
  setTimeout(() => process.exit(exitCode), 100);
}

for (const command of commands) {
  const child = spawn(npmCommand, command.args, {
    ...spawnOptions,
    shell: isWindows,
  });
  children.push(child);

  child.on("error", (error) => {
    console.error(`[dev] Failed to start ${command.name}:`, error);
    terminate(1);
  });

  child.on("exit", (code) => {
    if (!shuttingDown) {
      terminate(code ?? 0);
    }
  });
}

process.on("SIGINT", () => terminate(0));
process.on("SIGTERM", () => terminate(0));
