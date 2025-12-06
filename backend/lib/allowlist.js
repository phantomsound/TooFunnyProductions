// backend/lib/allowlist.js
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const ALLOWLIST_FILE = join(DATA_DIR, "admin-allowlist.json");
const MESSAGING_OPT_IN_FILE = join(DATA_DIR, "admin-messaging-optin.json");

const DEFAULT_CORE_ADMINS = ["kmiko@gmail.com"];

const normalizeEmail = (value) => {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (!lower.includes("@")) return null;
  return lower;
};

const dedupe = (values) => {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const parseList = (input) => {
  if (!input) return [];
  return String(input)
    .split(/[\n,]/)
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
};

const loadStoredAllowlist = () => {
  try {
    const raw = readFileSync(ALLOWLIST_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupe(
      parsed
        .map((value) => normalizeEmail(value))
        .filter(Boolean)
    );
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(
        "⚠️ Failed to load admin allowlist override; falling back to environment variable.",
        err?.message || err
      );
    }
    return [];
  }
};

let editableAllowlist = loadStoredAllowlist();
let messagingOptIn = loadStoredMessagingOptIn();

export const getEditableAllowlist = () => [...editableAllowlist];

export const getEnvAllowlist = () => {
  const raw = process.env.ALLOWLIST_EMAILS || "";
  return dedupe(parseList(raw));
};

export const getAllowlist = () =>
  dedupe([
    ...DEFAULT_CORE_ADMINS.map((value) => normalizeEmail(value)).filter(Boolean),
    ...editableAllowlist,
    ...getEnvAllowlist(),
  ]);

export const setEditableAllowlist = async (input) => {
  const next = normalizeAllowlistInput(input);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ALLOWLIST_FILE, JSON.stringify(next, null, 2));
  editableAllowlist = next;
  return getEditableAllowlist();
};

export const resetEditableAllowlist = async () => {
  editableAllowlist = [];
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ALLOWLIST_FILE, JSON.stringify([], null, 2));
  return getEditableAllowlist();
};

export const normalizeAllowlistInput = (value) => {
  if (Array.isArray(value)) return dedupe(value.map((item) => normalizeEmail(item)).filter(Boolean));
  if (typeof value === "string") return dedupe(parseList(value));
  return [];
};

function loadStoredMessagingOptIn() {
  try {
    const raw = readFileSync(MESSAGING_OPT_IN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return dedupe(parsed.map((value) => normalizeEmail(value)).filter(Boolean));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn(
        "⚠️ Failed to load admin messaging opt-in list; treating as empty.",
        err?.message || err
      );
    }
    return [];
  }
}

export const getMessagingOptIn = () => [...messagingOptIn];

export const setMessagingOptIn = async (input) => {
  const next = normalizeAllowlistInput(input);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MESSAGING_OPT_IN_FILE, JSON.stringify(next, null, 2));
  messagingOptIn = next;
  return getMessagingOptIn();
};
