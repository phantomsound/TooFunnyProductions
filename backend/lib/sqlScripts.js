// backend/lib/sqlScripts.js
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPT_FOLDERS = [
  { key: "docs", baseDir: join(__dirname, "..", "docs"), label: "MikoDB docs" },
  { key: "tests", baseDir: join(__dirname, "..", "docs", "tests"), label: "Validation" },
];

function slugify(name) {
  return name
    .replace(/\.sql$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function discoverFolder(folder) {
  try {
    const entries = await readdir(folder.baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".sql")
      .map((entry) => ({
        id: `${folder.key}:${slugify(entry.name)}`,
        filename: entry.name,
        folder: folder.key,
        label: folder.label,
        path: join(folder.baseDir, entry.name),
      }));
  } catch (err) {
    console.warn(`Unable to read SQL scripts for ${folder.key}`, err?.message || err);
    return [];
  }
}

export async function listSqlScripts() {
  const discovered = await Promise.all(SCRIPT_FOLDERS.map(discoverFolder));
  return discovered.flat();
}

export async function getSqlScriptById(id) {
  if (!id) return null;
  const scripts = await listSqlScripts();
  const match = scripts.find((item) => item.id === id);
  if (!match) return null;

  const content = await readFile(match.path, "utf8");
  return { ...match, content };
}
