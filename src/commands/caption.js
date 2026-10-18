// caption.js — Module 9: the full pipeline, end to end.
//
//   extract -> (enhance) -> transcribe -> caption model -> render  (+ srt/vtt)
//
// Usage: caption <video> [--template <name>] [--lang ur|hi]
//                        [--enhance] [--ai] [--edit] [--retranscribe]
//
// Edit workflow: a run reuses an existing output/<name>.captions.json, so you
// can fix wording in each line's "text" and re-run to re-render with your edits.
// Use --edit to stop after transcription (before the first render) to edit first.

import { existsSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";
import { extractAudio, resolveMediaPath } from "./extract.js";
import { enhanceAudio } from "./enhance.js";
import { transcribeWords } from "./transcribe.js";
import { renderVideo } from "./render.js";
import { buildCaptionDoc, saveCaptionDoc, loadCaptionDoc, syncWordsToText } from "../lib/captions.js";
import { loadTemplate } from "../lib/templates.js";
import { exportSrt, exportVtt } from "../lib/subtitles.js";

function parseArgs(args) {
  const positional = [];
  const flags = { enhance: false, ai: false, edit: false, retranscribe: false };
  let template = null;
  let lang = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--template" || a === "-t") template = args[++i];
    else if (a.startsWith("--template=")) template = a.slice(11);
    else if (a === "--lang" || a === "-l") lang = args[++i];
    else if (a.startsWith("--lang=")) lang = a.slice(7);
    else if (a === "--enhance") flags.enhance = true;
    else if (a === "--ai") { flags.ai = true; flags.enhance = true; }
    else if (a === "--edit") flags.edit = true;
    else if (a === "--retranscribe") flags.retranscribe = true;
    else positional.push(a);
  }
  return { positional, template, lang, flags };
}

export async function caption(args) {
  const cfg = loadConfig();
  const { positional, template: templateFlag, lang: langFlag, flags } = parseArgs(args);
  const lang = langFlag || cfg.whisper?.defaultLanguage || "ur";
  const templateName = templateFlag || cfg.render?.defaultTemplate || "clean";

  const videoArg = positional[0];
  if (!videoArg) {
    console.error("Usage: caption <video> [--template <name>] [--lang ur|hi] [--enhance] [--ai] [--edit] [--retranscribe]");
    process.exit(1);
  }

  const videoPath = resolveMediaPath(videoArg, ["input"], cfg);
  if (!videoPath) {
    console.error(`Input video not found: ${videoArg}`);
    process.exit(1);
  }

  // Validate the template up front (before doing slow work).
  let template;
  try {
    template = loadTemplate(templateName, cfg);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const outDir = resolvePath(cfg.paths?.output || "output");
  const stem = basename(videoPath, extname(videoPath));
  const captionsPath = join(outDir, `${stem}.captions.json`);

  console.log(`\n=== yourCaption pipeline: ${basename(videoPath)} ===`);
  console.log(`template=${templateName}  lang=${lang}  enhance=${flags.enhance}${flags.ai ? " (ai)" : ""}\n`);

  // ---- Captions: reuse edited file, or produce fresh ----
  let doc;
  if (existsSync(captionsPath) && !flags.retranscribe) {
    doc = loadCaptionDoc(captionsPath);
    syncWordsToText(doc);               // apply any edits to line "text"…
    saveCaptionDoc(captionsPath, doc);  // …and keep the file self-consistent
    console.log(`[1-3] Reusing captions: ${captionsPath} (${doc.lines.length} lines)`);
    console.log(`      (your edits to line "text" are kept. Pass --retranscribe to redo from audio.)`);
  } else {
    // 1) extract
    const wavPath = join(outDir, `${stem}.wav`);
    console.log(`[1/4] Extracting audio -> ${basename(wavPath)}`);
    try {
      extractAudio(videoPath, wavPath, cfg);
    } catch (err) {
      console.error(err.noAudio ? `${err.message}\nNothing to caption.` : `Extract failed: ${err.message}`);
      process.exit(err.noAudio ? 2 : 1);
    }

    // 2) enhance (optional)
    let audioForTranscribe = wavPath;
    if (flags.enhance) {
      const enhPath = join(outDir, `${stem}.enhanced.wav`);
      console.log(`[2/4] Enhancing audio -> ${basename(enhPath)}`);
      const { usedAI } = enhanceAudio(wavPath, enhPath, cfg, { useAI: flags.ai });
      console.log(`      denoiser: ${usedAI ? "DeepFilterNet (AI)" : "ffmpeg (light)"}`);
      audioForTranscribe = enhPath;
    } else {
      console.log(`[2/4] Enhancement skipped (pass --enhance to enable)`);
    }

    // 3) transcribe -> caption model
    console.log(`[3/4] Transcribing (${lang})… this is the slow step`);
    const { words } = transcribeWords(audioForTranscribe, lang, cfg, { quiet: true });
    doc = buildCaptionDoc(
      words,
      { audio: audioForTranscribe, language: lang, model: cfg.whisper?.model },
      cfg.captions || {}
    );
    saveCaptionDoc(captionsPath, doc);
    console.log(`      ${words.length} words in ${doc.lines.length} lines -> ${basename(captionsPath)}`);

    const shaky = words.filter((w) => w.confidence != null && w.confidence < 0.5);
    if (shaky.length) {
      console.log(`      low-confidence words to check: ${shaky.map((w) => w.word).slice(0, 12).join(", ")}${shaky.length > 12 ? " …" : ""}`);
    }
  }

  if (!doc.lines || doc.lines.length === 0) {
    console.error(`No caption lines — nothing to render.`);
    process.exit(2);
  }

  // ---- Exports (reflect any edits to line text) ----
  const srtPath = join(outDir, `${stem}.srt`);
  const vttPath = join(outDir, `${stem}.vtt`);
  exportSrt(doc, srtPath);
  exportVtt(doc, vttPath);

  // ---- Edit pass: stop before render so the user can fix text ----
  if (flags.edit) {
    console.log(`\n✋ Edit pass. Open and fix wording in each line's "text":`);
    console.log(`     ${captionsPath}`);
    console.log(`   Then render with your edits:`);
    console.log(`     npm run caption -- ${basename(videoPath)} --template ${templateName}`);
    console.log(`\n   Exported now: ${basename(srtPath)}, ${basename(vttPath)}`);
    return;
  }

  // ---- 4) Render ----
  const assPath = join(outDir, `${stem}.${template.name}.ass`);
  const outPath = join(outDir, `${stem}.${template.name}.captioned.mp4`);
  console.log(`[4/4] Rendering with template '${template.name}'…`);
  renderVideo(videoPath, doc, template, { assPath, outPath }, cfg, { quiet: true });

  console.log(`\n✅ Done.`);
  console.log(`   Video : ${outPath} (${(statSync(outPath).size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`   SRT   : ${srtPath}`);
  console.log(`   VTT   : ${vttPath}`);
  console.log(`\n   To fix any wrong words: edit "text" in ${basename(captionsPath)}, then re-run the same command.`);
}
