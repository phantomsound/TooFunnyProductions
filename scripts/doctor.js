#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function heading(title) {
  console.log(`\n=== ${title} ===`);
}

function checkPackageScripts() {
  heading("Root package scripts");
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const required = ["setup", "dev", "dev:backend", "dev:frontend", "build", "start", "start:api"];
  const missing = required.filter((script) => !pkg.scripts || !pkg.scripts[script]);
  if (missing.length === 0) {
    console.log("✓ All expected scripts are present.");
  } else {
    console.log("⚠ Missing scripts:", missing.join(", "));
    console.log("  Run `git fetch origin main` followed by `git reset --hard origin/main` to align with the latest repo state.");
  }
  if (!pkg.scripts?.doctor) {
    console.log("⚠ This diagnostic script is not registered as `npm run doctor`. Update package.json to include it if you copied the repo manually.");
  }
}

function checkGitStatus() {
  heading("Git status");
  const result = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
  if (result.error) {
    console.log("⚠ Unable to run git status:", result.error.message);
    return;
  }
  const output = result.stdout.trim();
  if (!output) {
    console.log("✓ Working tree clean.");
  } else {
    console.log("⚠ You have local changes:");
    console.log(output);
    console.log("  Stash or revert them before pulling: `git stash --include-untracked` or `git reset --hard`.");
  }
}

function checkEnvFiles() {
  heading("Environment files");
  const backendEnv = path.resolve(process.cwd(), "backend/.env");
  const frontendEnv = path.resolve(process.cwd(), "frontend/.env");
  const backendExists = fs.existsSync(backendEnv);
  const frontendExists = fs.existsSync(frontendEnv);
  console.log(`${backendExists ? "✓" : "⚠"} backend/.env ${backendExists ? "found" : "missing"}`);
  console.log(`${frontendExists ? "✓" : "⚠"} frontend/.env ${frontendExists ? "found (optional)" : "missing (optional)"}`);
  if (!backendExists) {
    console.log("  Copy backend/.env.example to backend/.env and fill in Supabase + OAuth secrets.");
  }
}

function main() {
  console.log("Too Funny Productions — Environment Doctor\n");
  checkPackageScripts();
  checkGitStatus();
  checkEnvFiles();
  console.log("\nNext steps:\n 1. If scripts are missing, update your git checkout.\n 2. Run `npm run setup` once per machine.\n 3. Start the stack with `npm run dev`.\n");
}

main();
