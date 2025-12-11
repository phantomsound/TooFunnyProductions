// backend/lib/sqlScripts.js
import { readFile, readdir, stat } from "node:fs/promises";
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

function extractHelperInfo(content) {
  if (!content) return "SQL helper script";
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const dashComment = trimmed.match(/^--\s*(.+)$/);
    if (dashComment) return dashComment[1];

    const blockComment = trimmed.match(/^\/\*+\s*(.+?)\s*\*+\/?$/);
    if (blockComment) return blockComment[1];
  }

  return "SQL helper script";
}

async function discoverFolder(folder) {
  try {
    const entries = await readdir(folder.baseDir, { withFileTypes: true });
    const sqlEntries = entries.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".sql");

    const withMetadata = await Promise.all(
      sqlEntries.map(async (entry) => {
        const path = join(folder.baseDir, entry.name);
        const [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        return {
          id: `${folder.key}:${slugify(entry.name)}`,
          filename: entry.name,
          folder: folder.key,
          label: folder.label,
          path,
          helper: extractHelperInfo(content),
          dateWritten: stats.mtime.toISOString(),
        };
      })
    );

    return withMetadata;
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
