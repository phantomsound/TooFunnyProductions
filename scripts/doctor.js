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

function checkFrontendBuild() {
  heading("Frontend build");
  const candidates = [
    process.env.FRONTEND_DIST && path.resolve(process.cwd(), process.env.FRONTEND_DIST),
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(process.cwd(), "frontend-dist"),
  ].filter(Boolean);

  const found = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });

  if (found) {
    console.log(`✓ Production assets found at ${found}`);
  } else {
    console.log("⚠ frontend build missing (frontend/dist)");
    console.log("  Run `npm run build` so the backend can serve the SPA in production.");
  }
}

function checkGeneralSettingsFile() {
  heading("Admin settings file");
  const filePath = path.resolve(
    process.cwd(),
    "frontend/src/pages/admin/AdminSettingsGeneral.tsx"
  );

  if (!fs.existsSync(filePath)) {
    console.log("⚠ frontend/src/pages/admin/AdminSettingsGeneral.tsx is missing.");
    console.log("  Run `git fetch origin` followed by `git reset --hard origin/main` to restore it.");
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const issues = [];

  if (contents.includes("session_timeout_minutes?:")) {
    issues.push(
      "Outdated optional property syntax detected (`session_timeout_minutes?:`)."
    );
  }

  const reactImportMatches = contents.match(/import React from "react";/g) || [];
  if (reactImportMatches.length > 1) {
    issues.push("Duplicate React import detected at the top of the file.");
  }

  if (issues.length === 0) {
    console.log("✓ AdminSettingsGeneral.tsx matches the expected TypeScript structure.");
  } else {
    issues.forEach((issue) => console.log(`⚠ ${issue}`));
    console.log(
      "  Reset the file with `git checkout -- frontend/src/pages/admin/AdminSettingsGeneral.tsx` or hard-reset to origin/main."
    );
  }
}

function main() {
  console.log("Too Funny Productions — Environment Doctor\n");
  checkPackageScripts();
  checkGitStatus();
  checkEnvFiles();
  checkFrontendBuild();
  checkGeneralSettingsFile();
  console.log("\nNext steps:\n 1. If scripts are missing, update your git checkout.\n 2. Run `npm run setup` once per machine.\n 3. Start the stack with `npm run dev`.\n");
}

main();
