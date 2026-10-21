// batch.js — Module 10: run the full pipeline on every video in a folder.
//
// Usage: batch [folder] [--template <name>] [--lang ur|hi] [--enhance] [--ai]
//                       [--retranscribe] [--preview [sec]]
// Default folder: input/. Continues past per-file errors and prints a summary.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";
import { runPipeline } from "./caption.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".m4v", ".webm", ".avi", ".mpg", ".mpeg"]);

function parseArgs(args) {
  const positional = [];
  const opts = { enhance: false, ai: false, retranscribe: false, previewSeconds: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--template" || a === "-t") opts.templateName = args[++i];
    else if (a.startsWith("--template=")) opts.templateName = a.slice(11);
    else if (a === "--lang" || a === "-l") opts.lang = args[++i];
    else if (a.startsWith("--lang=")) opts.lang = a.slice(7);
    else if (a === "--enhance") opts.enhance = true;
    else if (a === "--ai") { opts.ai = true; opts.enhance = true; }
    else if (a === "--retranscribe") opts.retranscribe = true;
    else if (a === "--preview") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) { opts.previewSeconds = parseInt(next, 10); i++; }
      else opts.previewSeconds = 10;
    } else if (a.startsWith("--preview=")) {
      opts.previewSeconds = parseInt(a.slice(10), 10) || 10;
    } else positional.push(a);
  }
  return { positional, opts };
}

export async function batch(args) {
  const cfg = loadConfig();
  const { positional, opts } = parseArgs(args);

  const folderArg = positional[0] || cfg.paths?.input || "input";
  const folder = existsSync(folderArg) ? folderArg : resolvePath(folderArg);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    console.error(`Folder not found: ${folderArg}`);
    process.exit(1);
  }

  const videos = readdirSync(folder)
    .filter((f) => VIDEO_EXTS.has(extname(f).toLowerCase()))
    .sort()
    .map((f) => join(folder, f));

  if (videos.length === 0) {
    console.error(`No videos found in ${folder}/ (looked for: ${[...VIDEO_EXTS].join(" ")})`);
    process.exit(1);
  }

  const templateName = opts.templateName || cfg.render?.defaultTemplate || "clean";
  const lang = opts.lang || cfg.whisper?.defaultLanguage || "ur";
  console.log(`\n=== Batch: ${videos.length} video(s) in ${folder} ===`);
  console.log(`template=${templateName}  lang=${lang}  enhance=${opts.enhance}${opts.previewSeconds ? `  preview=${opts.previewSeconds}s` : ""}\n`);

  let ok = 0;
  const failures = [];
  videos.forEach((videoPath, idx) => {
    const name = basename(videoPath);
    process.stdout.write(`[${idx + 1}/${videos.length}] ${name} … `);
    try {
      const r = runPipeline(videoPath, { ...opts, templateName, lang }, cfg, { quiet: true });
      if (r.status === "rendered") {
        console.log(`✅ ${basename(r.outPath)} (${r.lines} lines)`);
        ok++;
      } else if (r.status === "empty") {
        console.log(`⚠️  no caption lines (skipped render)`);
        failures.push({ name, why: "no caption lines" });
      }
    } catch (err) {
      console.log(`❌ ${err.noAudio ? "no audio track" : err.message}`);
      failures.push({ name, why: err.message });
    }
  });

  console.log(`\n=== Done: ${ok}/${videos.length} rendered ===`);
  if (failures.length) {
    console.log(`Failed/skipped:`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.why}`);
  }
}
