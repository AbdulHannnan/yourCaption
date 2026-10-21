// extract.js — Module 2: pull a clean, standardized WAV out of any video.
//
// Output is always 16 kHz, mono, 16-bit PCM — the format whisper.cpp wants.
// Handles: missing file, no audio track, odd codecs, wrong sample rate.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";

// Ask ffprobe what audio streams a file has (used to detect "no audio").
function probeAudioStreams(ffprobeBin, videoPath) {
  const res = spawnSync(
    ffprobeBin,
    ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "json", videoPath],
    { encoding: "utf8" }
  );
  if (res.error) {
    if (res.error.code === "ENOENT") throw new Error(`'${ffprobeBin}' not found. Install ffmpeg: brew install ffmpeg`);
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`ffprobe failed:\n${(res.stderr || "").trim()}`);
  let parsed = {};
  try { parsed = JSON.parse(res.stdout || "{}"); } catch { /* leave empty */ }
  return parsed.streams || [];
}

function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Core: extract audio from videoPath to outPath (16kHz mono PCM).
 * Throws on failure; sets err.noAudio = true when there is no audio track.
 * @returns {{ src: object }} the first source audio stream info
 */
export function extractAudio(videoPath, outPath, cfg) {
  const ffmpegBin = cfg.ffmpeg?.binary || "ffmpeg";
  const ffprobeBin = cfg.ffmpeg?.ffprobe || "ffprobe";
  const sampleRate = cfg.audio?.sampleRate || 16000;
  const channels = cfg.audio?.channels || 1;

  const audioStreams = probeAudioStreams(ffprobeBin, videoPath);
  if (audioStreams.length === 0) {
    throw Object.assign(new Error(`No audio track in: ${videoPath}`), { noAudio: true });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const ffArgs = [
    "-y", "-nostdin", "-loglevel", "error",
    "-i", videoPath,
    "-vn", "-ac", String(channels), "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "wav",
    outPath,
  ];
  const res = spawnSync(ffmpegBin, ffArgs, { encoding: "utf8" });
  if (res.error) {
    if (res.error.code === "ENOENT") throw new Error(`'${ffmpegBin}' not found. Install ffmpeg: brew install ffmpeg`);
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`ffmpeg could not extract audio:\n${(res.stderr || "").trim()}`);
  return { src: audioStreams[0] };
}

// Resolve an input arg to a path: direct, or a filename inside a config dir.
export function resolveMediaPath(arg, dirs, cfg) {
  if (existsSync(arg)) return arg;
  for (const dir of dirs) {
    const candidate = resolvePath(join(cfg.paths?.[dir] || dir, arg));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// CLI wrapper.
export async function extract(args) {
  const cfg = loadConfig();
  const videoArg = args[0];
  if (!videoArg) {
    console.error("Usage: extract <video>");
    process.exit(1);
  }
  const videoPath = resolveMediaPath(videoArg, ["input"], cfg);
  if (!videoPath) {
    console.error(`Input not found: ${videoArg}`);
    process.exit(1);
  }

  const outDir = resolvePath(cfg.paths?.output || "output");
  const stem = basename(videoPath, extname(videoPath));
  const outPath = join(outDir, `${stem}.wav`);

  try {
    const { src } = extractAudio(videoPath, outPath, cfg);
    console.log(`Input audio : ${src.codec_name || "?"}, ${src.sample_rate || "?"} Hz, ${src.channels || "?"} ch`);
    console.log(`Target      : pcm_s16le, ${cfg.audio?.sampleRate || 16000} Hz, ${cfg.audio?.channels || 1} ch (whisper.cpp format)`);
    console.log(`\n✅ Wrote ${outPath} (${humanSize(statSync(outPath).size)})`);
  } catch (err) {
    if (err.noAudio) {
      console.error(`${err.message}\nThere's nothing to transcribe — skipping.`);
      process.exit(2);
    }
    throw err;
  }
}
