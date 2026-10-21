// doctor.js — Module 1 health check for yourCaption.
// Verifies the three things the whole pipeline depends on:
//   1. ffmpeg          (audio extraction + rendering)
//   2. whisper-cli     (transcription engine from whisper.cpp)
//   3. the Whisper model file (present and a real GGML model)
//
// Run with:  npm run doctor
// Exits 0 if everything is OK, 1 if anything is MISSING.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

// Project root = one level up from this file (src/..), so paths work
// no matter which directory `npm run doctor` is invoked from.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadConfig() {
  const path = join(ROOT, "config.json");
  if (!existsSync(path)) {
    console.error(`config.json not found at ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// Returns true if a binary can be executed (exists on PATH), false only when
// the OS reports it is not found. A non-zero exit still means it exists.
function binaryExists(bin, args) {
  try {
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch (err) {
    return err.code !== "ENOENT";
  }
}

// Best-effort one-line version string for display.
function versionLine(bin, args, pick = (out) => out.split("\n")[0]) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return pick(out).trim();
  } catch (err) {
    // whisper-cli prints usage to stderr and exits non-zero with no args;
    // that still proves it runs, so fall back to a generic label.
    return null;
  }
}

// A whisper.cpp GGML model begins with the 4-byte magic 0x67676d6c,
// stored little-endian on disk as the bytes 6c 6d 67 67 ("lmgg").
function isGgmlModel(path) {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    closeSync(fd);
    return buf[0] === 0x6c && buf[1] === 0x6d && buf[2] === 0x67 && buf[3] === 0x67;
  } catch {
    return false;
  }
}

function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

const cfg = loadConfig();
const checks = [];

// 1. ffmpeg
{
  const bin = cfg.ffmpeg?.binary || "ffmpeg";
  const ok = binaryExists(bin, ["-version"]);
  const v = ok ? versionLine(bin, ["-version"]) : null;
  checks.push({
    name: "ffmpeg",
    ok,
    detail: ok ? (v || "installed") : `not found on PATH (expected '${bin}')`,
    fix: "brew install ffmpeg",
  });
}

// 2. whisper-cli
{
  const bin = cfg.whisper?.binary || "whisper-cli";
  const ok = binaryExists(bin, ["--help"]);
  checks.push({
    name: "whisper-cli",
    ok,
    detail: ok ? `installed (${bin})` : `not found on PATH (expected '${bin}')`,
    fix: "brew install whisper-cpp",
  });
}

// 3. model file
{
  const rel = cfg.whisper?.model || "";
  const modelPath = isAbsolute(rel) ? rel : join(ROOT, rel);
  let ok = false;
  let detail;
  if (!rel) {
    detail = "no model path set in config.json (whisper.model)";
  } else if (!existsSync(modelPath)) {
    detail = `file missing: ${rel}`;
  } else if (!isGgmlModel(modelPath)) {
    detail = `file exists but is not a GGML model (corrupt/partial download?): ${rel}`;
  } else {
    ok = true;
    detail = `${rel} (${humanSize(statSync(modelPath).size)})`;
  }
  checks.push({
    name: "whisper model",
    ok,
    detail,
    fix: "re-download the .bin from https://huggingface.co/ggerganov/whisper.cpp",
  });
}

// ---- Report ----
console.log("\nyourCaption — doctor\n" + "=".repeat(40));
let allOk = true;
for (const c of checks) {
  const tag = c.ok ? "OK     " : "MISSING";
  console.log(`[ ${tag} ]  ${c.name.padEnd(14)} ${c.detail}`);
  if (!c.ok) {
    allOk = false;
    console.log(`            ↳ fix: ${c.fix}`);
  }
}
console.log("=".repeat(40));
if (allOk) {
  console.log("All systems go. ✅  Ready for Module 2.\n");
  process.exit(0);
} else {
  console.log("Some components are missing. ❌  Fix the items above, then run again.\n");
  process.exit(1);
}
