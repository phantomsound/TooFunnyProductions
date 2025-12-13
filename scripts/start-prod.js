#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const npmCli = path.resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js");

function frontendBuildExists() {
  const candidates = [
    process.env.FRONTEND_DIST && path.resolve(process.cwd(), process.env.FRONTEND_DIST),
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(process.cwd(), "frontend-dist"),
  ].filter(Boolean);

  return candidates.some((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function ensureFrontendBuild() {
  if (frontendBuildExists()) return;

  console.log("⚠️ frontend build missing; running `npm run build`...");
  const result = spawnSync(process.execPath, [npmCli, "run", "build"], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    console.error("❌ Frontend build failed. Fix the errors above and retry.");
    process.exit(result.status ?? 1);
  }
}

ensureFrontendBuild();

const child = spawn(
  process.execPath,
  ["server.js"],
  {
    cwd: path.resolve(process.cwd(), "backend"),
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: process.env.PORT || "8082",
    },
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
