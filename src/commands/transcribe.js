// transcribe.js — Module 3: run whisper.cpp and parse word-level output.
//
// Produces, for each spoken word: { word, start, end, confidence }.
//   start/end  seconds
//   confidence 0..1 (average of whisper's per-token probabilities)
//
// Usage: transcribe <audio.wav> [--lang ur|hi]
// Writes whisper's raw JSON to output/<name>.whisper.json and prints the
// transcript with timings.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";
import { buildCaptionDoc, saveCaptionDoc } from "../lib/captions.js";

// Minimal flag parser: pulls out --lang / -l, returns { positional, lang }.
function parseArgs(args) {
  const positional = [];
  let lang = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--lang" || a === "-l") {
      lang = args[++i];
    } else if (a.startsWith("--lang=")) {
      lang = a.slice("--lang=".length);
    } else {
      positional.push(a);
    }
  }
  return { positional, lang };
}

// A token is "special" (not real spoken text) if it's a whisper control token
// like [_BEG_] or a <|...|> timestamp marker. We skip these for confidence.
function isSpecialToken(text) {
  if (!text) return true;
  const t = text.trim();
  return /^\[_.*_\]$/.test(t) || /^<\|.*\|>$/.test(t) || t === "";
}

// Turn whisper's full-JSON transcription array into clean word objects.
function parseWhisperJson(json) {
  const segments = json.transcription || [];
  const words = [];
  for (const seg of segments) {
    const word = (seg.text || "").trim();
    if (!word) continue;

    // offsets are in milliseconds.
    const start = (seg.offsets?.from ?? 0) / 1000;
    const end = (seg.offsets?.to ?? 0) / 1000;

    // Confidence = mean probability of the real (non-special) tokens.
    let sum = 0;
    let n = 0;
    for (const tok of seg.tokens || []) {
      if (isSpecialToken(tok.text)) continue;
      if (typeof tok.p === "number") {
        sum += tok.p;
        n++;
      }
    }
    const confidence = n > 0 ? sum / n : null;

    words.push({ word, start, end, confidence });
  }
  return words;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(2).padStart(5, "0");
  return `${String(m).padStart(2, "0")}:${sec}`;
}

export async function transcribe(args) {
  const cfg = loadConfig();
  const whisperBin = cfg.whisper?.binary || "whisper-cli";
  const modelPath = resolvePath(cfg.whisper?.model || "");
  const defaultLang = cfg.whisper?.defaultLanguage || "ur";
  const threads = cfg.whisper?.threads || 4;
  const outputDir = cfg.paths?.output || "output";

  const { positional, lang: langFlag } = parseArgs(args);
  const lang = langFlag || defaultLang;
  const audioArg = positional[0];

  if (!audioArg) {
    console.error("Usage: transcribe <audio.wav> [--lang ur|hi]");
    process.exit(1);
  }
  if (!existsSync(modelPath)) {
    throw new Error(`Whisper model not found: ${modelPath}\nRun 'npm run doctor' to check setup.`);
  }

  // Resolve the audio: direct path, or a filename inside output/ or input/.
  let audioPath = audioArg;
  if (!existsSync(audioPath)) {
    for (const dir of [outputDir, cfg.paths?.input || "input"]) {
      const candidate = resolvePath(join(dir, audioArg));
      if (existsSync(candidate)) {
        audioPath = candidate;
        break;
      }
    }
  }
  if (!existsSync(audioPath)) {
    console.error(`Audio not found: ${audioArg}`);
    console.error(`Looked at the path you gave, and inside ${outputDir}/ and input/.`);
    process.exit(1);
  }

  // Where whisper writes its JSON. It appends ".json" to this prefix.
  const outDir = resolvePath(outputDir);
  mkdirSync(outDir, { recursive: true });
  const stem = basename(audioPath, extname(audioPath));
  const jsonPrefix = join(outDir, `${stem}.whisper`);
  const jsonPath = `${jsonPrefix}.json`;

  console.log(`Model   : ${cfg.whisper?.model}`);
  console.log(`Audio   : ${audioPath}`);
  console.log(`Language: ${lang}`);
  console.log(`Threads : ${threads}`);
  console.log(`\nTranscribing… (this is the slow step; progress below)\n`);

  const wArgs = [
    "-m", modelPath,
    "-f", audioPath,
    "-l", lang,
    "-t", String(threads),
    "-ml", "1",          // one word per segment…
    "-sow",              // …split on word boundaries
    "-ojf",              // full JSON (includes per-token probabilities)
    "-of", jsonPrefix,   // output file prefix
    "-pp",               // print progress
  ];

  // Let whisper's progress print straight to the terminal (stderr inherited).
  const res = spawnSync(whisperBin, wArgs, { stdio: ["ignore", "inherit", "inherit"] });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Error(`'${whisperBin}' not found. Install it: brew install whisper-cpp`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`whisper-cli exited with code ${res.status}.`);
  }
  if (!existsSync(jsonPath)) {
    throw new Error(`Expected whisper output not found: ${jsonPath}`);
  }

  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  const words = parseWhisperJson(json);

  // Build the caption document (the backbone file) and save it.
  const doc = buildCaptionDoc(
    words,
    { audio: audioPath, language: lang, model: cfg.whisper?.model },
    cfg.captions || {}
  );
  const captionsPath = join(outDir, `${stem}.captions.json`);
  saveCaptionDoc(captionsPath, doc);

  // ---- Print the transcript as grouped caption lines ----
  console.log(`\n${"=".repeat(50)}`);
  if (words.length === 0) {
    console.log("No words detected. (Silent/empty audio, or wrong --lang?)");
  } else {
    console.log("Transcript:\n");
    console.log(words.map((w) => w.word).join(" "));
    console.log(`\n${"-".repeat(50)}`);
    console.log(`Caption lines (${doc.lines.length}):\n`);
    for (const line of doc.lines) {
      console.log(`  #${String(line.index).padStart(2)} [${fmtTime(line.start)} → ${fmtTime(line.end)}]  ${line.text}`);
    }

    // Flag low-confidence words to fix later (Module 9 edit pass).
    const shaky = words.filter((w) => w.confidence != null && w.confidence < 0.5);
    if (shaky.length > 0) {
      console.log(`\n${"-".repeat(50)}`);
      console.log(`Low-confidence words to double-check (${shaky.length}):`);
      console.log("  " + shaky.map((w) => `${w.word} (${Math.round(w.confidence * 100)}%)`).join(", "));
    }
  }
  console.log(`${"=".repeat(50)}`);
  console.log(`\n${words.length} words in ${doc.lines.length} lines.`);
  console.log(`Captions saved : ${captionsPath}`);
  console.log(`Raw whisper JSON: ${jsonPath}`);

  return doc;
}
