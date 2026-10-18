// render.js — Module 5: burn captions onto a video.
//
// Reads the caption JSON for <video>, writes a .ass subtitle file, then uses
// ffmpeg's subtitles filter (libass) to burn it on. Output -> output/.
//
// Usage: render <video>

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";
import { loadCaptionDoc, syncWordsToText } from "../lib/captions.js";
import { buildAss } from "../lib/ass.js";
import { loadTemplate } from "../lib/templates.js";

// Minimal flag parser: pulls out --template / -t, returns { positional, template }.
function parseArgs(args) {
  const positional = [];
  let template = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--template" || a === "-t") template = args[++i];
    else if (a.startsWith("--template=")) template = a.slice("--template=".length);
    else positional.push(a);
  }
  return { positional, template };
}

// Probe the first video stream's dimensions.
function probeDimensions(ffprobeBin, videoPath) {
  const res = spawnSync(
    ffprobeBin,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", videoPath],
    { encoding: "utf8" }
  );
  if (res.error) {
    if (res.error.code === "ENOENT") throw new Error(`'${ffprobeBin}' not found. brew install ffmpeg`);
    throw res.error;
  }
  const stream = JSON.parse(res.stdout || "{}").streams?.[0] || {};
  if (!stream.width || !stream.height) throw new Error(`Could not read video dimensions from ${videoPath}`);
  return { width: stream.width, height: stream.height };
}

// Escape a path for ffmpeg's filtergraph. The value must not contain raw
// filtergraph metacharacters, so escape them (backslash first). No outer
// quotes — this version's parser mishandles quoted filter values.
function subtitlesFilterArg(absPath) {
  const esc = absPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;");
  return `subtitles=${esc}`;
}

function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Core: burn a caption doc onto a video using a template.
 * Re-syncs per-word timings to any edited line text first, so editing a
 * line's `text` is enough.
 * @param {{ assPath: string, outPath: string }} paths
 * @returns {{ dims: object }}
 */
export function renderVideo(videoPath, doc, template, { assPath, outPath }, cfg, { quiet = false } = {}) {
  const ffmpegBin = cfg.ffmpeg?.binary || "ffmpeg";
  const ffprobeBin = cfg.ffmpeg?.ffprobe || "ffprobe";

  syncWordsToText(doc); // honor edits to line.text (no-op when already in sync)

  const dims = probeDimensions(ffprobeBin, videoPath);
  mkdirSync(dirname(assPath), { recursive: true });
  writeFileSync(assPath, buildAss(doc, dims, template), "utf8");

  const ffArgs = [
    "-y", "-nostdin", "-loglevel", "error", "-stats",
    "-i", videoPath,
    "-vf", subtitlesFilterArg(assPath),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "copy",
    outPath,
  ];
  const res = spawnSync(ffmpegBin, ffArgs, { stdio: quiet ? "ignore" : ["ignore", "inherit", "inherit"] });
  if (res.error) {
    if (res.error.code === "ENOENT") throw new Error(`'${ffmpegBin}' not found. brew install ffmpeg`);
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`ffmpeg failed while burning captions (exit ${res.status}).`);
  return { dims };
}

export async function render(args) {
  const cfg = loadConfig();
  const inputDir = cfg.paths?.input || "input";
  const outputDir = cfg.paths?.output || "output";

  const { positional, template: templateFlag } = parseArgs(args);
  const videoArg = positional[0];
  const templateName = templateFlag || cfg.render?.defaultTemplate || "clean";
  if (!videoArg) {
    console.error("Usage: render <video> [--template <name>]");
    process.exit(1);
  }

  // Load the style template (fails clearly, listing available ones).
  let template;
  try {
    template = loadTemplate(templateName, cfg);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Resolve the video (direct path, or a filename in input/).
  let videoPath = videoArg;
  if (!existsSync(videoPath)) {
    const candidate = resolvePath(join(inputDir, videoArg));
    if (existsSync(candidate)) videoPath = candidate;
  }
  if (!existsSync(videoPath)) {
    console.error(`Input video not found: ${videoArg}`);
    process.exit(1);
  }

  // Find the caption JSON produced by transcribe: output/<stem>.captions.json
  const outDir = resolvePath(outputDir);
  mkdirSync(outDir, { recursive: true });
  const stem = basename(videoPath, extname(videoPath));
  const captionsPath = join(outDir, `${stem}.captions.json`);
  if (!existsSync(captionsPath)) {
    console.error(`No caption file found: ${captionsPath}`);
    console.error(`Run transcription first, e.g.:`);
    console.error(`  npm run extract -- ${basename(videoPath)}`);
    console.error(`  npm run transcribe -- ${stem}.wav --lang ur`);
    process.exit(1);
  }

  const doc = loadCaptionDoc(captionsPath);
  if (!doc.lines || doc.lines.length === 0) {
    console.error(`Caption file has no lines — nothing to render: ${captionsPath}`);
    process.exit(2);
  }

  const assPath = join(outDir, `${stem}.${template.name}.ass`);
  const outPath = join(outDir, `${stem}.${template.name}.captioned.mp4`);

  console.log(`Template : ${template.name} — ${template.description}`);
  console.log(`Captions : ${captionsPath} (${doc.lines.length} lines)`);
  console.log(`Subtitle : ${assPath}`);
  console.log(`\nBurning captions… (re-encodes video; audio copied as-is)\n`);

  const { dims } = renderVideo(videoPath, doc, template, { assPath, outPath }, cfg);

  console.log(`\n✅ Wrote ${outPath} (${humanSize(statSync(outPath).size)}, ${dims.width}x${dims.height})`);
}
