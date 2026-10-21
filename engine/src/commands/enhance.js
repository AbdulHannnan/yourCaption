// enhance.js — Module 8: clean up audio before transcription.
//
// Default: a light, fast ffmpeg chain (high-pass + FFT denoise + loudness
// normalization). Optional: DeepFilterNet AI denoiser via --ai (heavier).
// Output is whisper-ready: 16 kHz mono PCM.
//
// Usage: enhance <audio> [--ai]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";

function parseArgs(args) {
  const positional = [];
  let ai = false;
  for (const a of args) {
    if (a === "--ai" || a === "--ai-denoise") ai = true;
    else positional.push(a);
  }
  return { positional, ai };
}

// Is a DeepFilterNet CLI available? Returns the binary name or null.
function findDeepFilter() {
  for (const bin of ["deep-filter", "deepFilter"]) {
    const r = spawnSync(bin, ["--help"], { stdio: "ignore" });
    if (!(r.error && r.error.code === "ENOENT")) return bin;
  }
  return null;
}

// Run DeepFilterNet into a temp dir and return the denoised wav path.
// NOTE: this branch is untested here (DeepFilterNet is not installed); it is
// written defensively and any failure falls back to the ffmpeg chain.
function runDeepFilter(bin, input, outDir) {
  const tmp = join(outDir, ".dfn_tmp");
  mkdirSync(tmp, { recursive: true });
  const before = new Set(readdirSync(tmp));
  const r = spawnSync(bin, [input, "-o", tmp], { encoding: "utf8" });
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0) throw new Error((r.stderr || "DeepFilterNet error").trim().split("\n").pop());
  const produced = readdirSync(tmp).filter((f) => f.toLowerCase().endsWith(".wav") && !before.has(f));
  const pick = produced.length ? produced : readdirSync(tmp).filter((f) => f.toLowerCase().endsWith(".wav"));
  if (pick.length === 0) throw new Error("no output wav produced");
  return join(tmp, pick.sort().pop());
}

/**
 * Core: enhance audio from inPath to outPath (16kHz mono PCM).
 * @param {object} opts { useAI, quiet }
 * @returns {{ usedAI: boolean, chain: string }}
 */
export function enhanceAudio(inPath, outPath, cfg, { useAI = false, quiet = false } = {}) {
  const ffmpegBin = cfg.ffmpeg?.binary || "ffmpeg";
  const sr = cfg.audio?.sampleRate || 16000;
  const ch = cfg.audio?.channels || 1;
  const en = cfg.enhance || {};
  const hp = en.highpassHz ?? 90;
  const nf = en.denoiseNf ?? -25;
  const I = en.loudnessI ?? -16;
  const TP = en.loudnessTP ?? -1.5;
  const LRA = en.loudnessLRA ?? 11;
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });

  // Optional AI denoise (produces an intermediate wav for ffmpeg to finish).
  let source = inPath;
  let usedAI = false;
  if (useAI) {
    const dfn = findDeepFilter();
    if (dfn) {
      try {
        source = runDeepFilter(dfn, inPath, outDir);
        usedAI = true;
      } catch (err) {
        if (!quiet) console.error(`AI denoiser failed (${err.message}). Falling back to the ffmpeg denoiser.\n`);
        source = inPath;
      }
    } else if (!quiet) {
      console.error("AI denoiser requested but DeepFilterNet was not found.");
      console.error("To install it (heavy — pulls PyTorch, ~2–4 GB download, needs ~2–4 GB RAM to run):");
      console.error("  pip install deepfilternet      # provides the 'deepFilter' command");
      console.error("Falling back to the light ffmpeg denoiser for now.\n");
    }
  }

  const filters = [`highpass=f=${hp}`];
  if (!usedAI) filters.push(`afftdn=nf=${nf}`);
  filters.push(`loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`);
  const af = filters.join(",");

  const res = spawnSync(
    ffmpegBin,
    ["-y", "-nostdin", "-loglevel", "error", "-i", source, "-af", af, "-ar", String(sr), "-ac", String(ch), "-c:a", "pcm_s16le", outPath],
    { stdio: quiet ? "ignore" : ["ignore", "inherit", "inherit"] }
  );
  if (res.error) {
    if (res.error.code === "ENOENT") throw new Error(`'${ffmpegBin}' not found. brew install ffmpeg`);
    throw res.error;
  }
  if (res.status !== 0) throw new Error(`ffmpeg enhancement failed (exit ${res.status}).`);
  return { usedAI, chain: af };
}

// CLI wrapper.
export async function enhance(args) {
  const cfg = loadConfig();
  const en = cfg.enhance || {};
  const outputDir = cfg.paths?.output || "output";
  const { positional, ai } = parseArgs(args);
  const useAI = ai || en.useAIDenoiser;
  const audioArg = positional[0];
  if (!audioArg) {
    console.error("Usage: enhance <audio> [--ai]");
    process.exit(1);
  }

  let audioPath = audioArg;
  if (!existsSync(audioPath)) {
    for (const dir of [outputDir, cfg.paths?.input || "input"]) {
      const candidate = resolvePath(join(dir, audioArg));
      if (existsSync(candidate)) { audioPath = candidate; break; }
    }
  }
  if (!existsSync(audioPath)) {
    console.error(`Audio not found: ${audioArg}`);
    process.exit(1);
  }

  const outDir = resolvePath(outputDir);
  const stem = basename(audioPath, extname(audioPath));
  const outPath = join(outDir, `${stem}.enhanced.wav`);

  console.log(`Input    : ${audioPath}`);
  const { usedAI, chain } = enhanceAudio(audioPath, outPath, cfg, { useAI });
  console.log(`Denoiser : ${usedAI ? "DeepFilterNet (AI)" : "ffmpeg afftdn (light default)"}`);
  console.log(`Chain    : ${chain}`);
  console.log(`\n✅ Wrote ${outPath} (${(statSync(outPath).size / 1024).toFixed(0)} KB)`);
}
