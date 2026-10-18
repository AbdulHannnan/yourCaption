// project.js — shared helpers: locate the project root, load config,
// and resolve paths relative to the project (not the current directory).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

// This file lives in src/lib/, so the project root is two levels up.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig() {
  const path = join(ROOT, "config.json");
  if (!existsSync(path)) {
    throw new Error(`config.json not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// Absolute paths pass through; relative ones resolve against the project root.
export function resolvePath(p) {
  return isAbsolute(p) ? p : join(ROOT, p);
}
