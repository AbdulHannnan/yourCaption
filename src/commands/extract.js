// extract.js — Module 2: pull a clean, standardized WAV out of any video.
//
// Output is always 16 kHz, mono, 16-bit PCM — the format whisper.cpp wants.
// Handles: missing file, no audio track, odd codecs, wrong sample rate.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";

// Ask ffprobe what audio streams a file has (used to detect "no audio").
function probeAudioStreams(ffprobeBin, videoPath) {
  const res = spawnSync(
    ffprobeBin,
    [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_name,sample_rate,channels",
      "-of", "json",
      videoPath,
    ],
    { encoding: "utf8" }
  );
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error(`'${ffprobeBin}' not found. Install ffmpeg: brew install ffmpeg`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`ffprobe failed:\n${(res.stderr || "").trim()}`);
  }
  let parsed = {};
  try {
    parsed = JSON.parse(res.stdout || "{}");
  } catch {
    /* leave empty */
  }
  return parsed.streams || [];
}

function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export async function extract(args) {
  const cfg = loadConfig();
  const ffmpegBin = cfg.ffmpeg?.binary || "ffmpeg";
  const ffprobeBin = cfg.ffmpeg?.ffprobe || "ffprobe";
  const sampleRate = cfg.audio?.sampleRate || 16000;
  const channels = cfg.audio?.channels || 1;
  const inputDir = cfg.paths?.input || "input";
  const outputDir = cfg.paths?.output || "output";

  const videoArg = args[0];
  if (!videoArg) {
    console.error("Usage: extract <video>");
    console.error(`  <video> can be a path, or just a filename inside ${inputDir}/`);
    process.exit(1);
  }

  // Resolve the input: accept a direct path, or a bare filename in input/.
  let videoPath = videoArg;
  if (!existsSync(videoPath)) {
    const candidate = resolvePath(join(inputDir, videoArg));
    if (existsSync(candidate)) videoPath = candidate;
  }
  if (!existsSync(videoPath)) {
    console.error(`Input not found: ${videoArg}`);
    console.error(`Looked at the path you gave, and inside ${inputDir}/.`);
    process.exit(1);
  }

  // Edge case 1: no audio track at all.
  const audioStreams = probeAudioStreams(ffprobeBin, videoPath);
  if (audioStreams.length === 0) {
    console.error(`No audio track in: ${videoPath}`);
    console.error(`There's nothing to transcribe — skipping.`);
    process.exit(2);
  }

  const src = audioStreams[0];
  console.log(`Input audio : ${src.codec_name || "?"}, ${src.sample_rate || "?"} Hz, ${src.channels || "?"} ch`);
  console.log(`Target      : pcm_s16le, ${sampleRate} Hz, ${channels} ch (whisper.cpp format)`);

  // Build the output path: output/<name>.wav
  const outDir = resolvePath(outputDir);
  mkdirSync(outDir, { recursive: true });
  const stem = basename(videoPath, extname(videoPath));
  const outPath = join(outDir, `${stem}.wav`);

  // Edge cases 2 & 3 (odd codec, wrong rate) are handled simply by decoding
  // and re-encoding to our fixed target format — ffmpeg does the conversion.
  const ffArgs = [
    "-y",                      // overwrite if it already exists
    "-nostdin",                // never block waiting for keyboard input
    "-loglevel", "error",      // quiet unless something actually fails
    "-i", videoPath,
    "-vn",                     // drop video
    "-ac", String(channels),   // downmix channels
    "-ar", String(sampleRate), // resample
    "-c:a", "pcm_s16le",       // 16-bit PCM
    "-f", "wav",               // force WAV container
    outPath,
  ];

  const res = spawnSync(ffmpegBin, ffArgs, { encoding: "utf8" });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error(`'${ffmpegBin}' not found. Install ffmpeg: brew install ffmpeg`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`ffmpeg could not extract audio:\n${(res.stderr || "").trim()}`);
  }

  const size = statSync(outPath).size;
  console.log(`\n✅ Wrote ${outPath} (${humanSize(size)})`);
}
