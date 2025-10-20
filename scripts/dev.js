#!/usr/bin/env node

const { spawn } = require("node:child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  { name: "backend", args: ["--prefix", "backend", "run", "dev"] },
  { name: "frontend", args: ["--prefix", "frontend", "run", "dev"] },
];

const spawnOptions = {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
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
  const child = spawn(npmCommand, command.args, spawnOptions);
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
