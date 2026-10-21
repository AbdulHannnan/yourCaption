// caption.js — Module 9/10: the full pipeline, end to end.
//
//   extract -> (enhance) -> transcribe -> caption model -> render  (+ srt/vtt)
//
// Usage: caption <video> [--template <name>] [--lang ur|hi]
//                        [--enhance] [--ai] [--edit] [--retranscribe] [--preview [sec]]

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

/**
 * Core: run the whole pipeline for one already-resolved video.
 * @returns {{status:'rendered'|'edit'|'empty', outPath?, srtPath, vttPath, captionsPath, lines, reused, previewSeconds}}
 */
export function runPipeline(videoPath, opts, cfg, { quiet = false } = {}) {
  const say = quiet ? () => {} : (...a) => console.log(...a);
  const {
    templateName = cfg.render?.defaultTemplate || "clean",
    lang = cfg.whisper?.defaultLanguage || "ur",
    enhance = false,
    ai = false,
    edit = false,
    retranscribe = false,
    previewSeconds = null,
  } = opts;

  const template = loadTemplate(templateName, cfg); // throws if missing
  const outDir = resolvePath(cfg.paths?.output || "output");
  const stem = basename(videoPath, extname(videoPath));
  const captionsPath = join(outDir, `${stem}.captions.json`);

  // ---- Captions: reuse edited file, or produce fresh ----
  let doc;
  let reused = false;
  if (existsSync(captionsPath) && !retranscribe) {
    doc = loadCaptionDoc(captionsPath);
    syncWordsToText(doc);
    saveCaptionDoc(captionsPath, doc);
    reused = true;
    say(`[1-3] Reusing captions: ${basename(captionsPath)} (${doc.lines.length} lines; edits kept)`);
  } else {
    const wavPath = join(outDir, `${stem}.wav`);
    say(`[1/4] Extracting audio`);
    extractAudio(videoPath, wavPath, cfg);

    let audioForTranscribe = wavPath;
    if (enhance) {
      const enhPath = join(outDir, `${stem}.enhanced.wav`);
      say(`[2/4] Enhancing audio${ai ? " (AI)" : ""}`);
      enhanceAudio(wavPath, enhPath, cfg, { useAI: ai, quiet: true });
      audioForTranscribe = enhPath;
    } else {
      say(`[2/4] Enhancement skipped`);
    }

    say(`[3/4] Transcribing (${lang})… slow step`);
    const { words } = transcribeWords(audioForTranscribe, lang, cfg, { quiet: true });
    doc = buildCaptionDoc(
      words,
      { audio: audioForTranscribe, language: lang, model: cfg.whisper?.model },
      cfg.captions || {}
    );
    saveCaptionDoc(captionsPath, doc);
    say(`      ${words.length} words in ${doc.lines.length} lines`);
  }

  if (!doc.lines || doc.lines.length === 0) {
    return { status: "empty", captionsPath, lines: 0, reused };
  }

  // ---- Exports (reflect edits to line text) ----
  const srtPath = join(outDir, `${stem}.srt`);
  const vttPath = join(outDir, `${stem}.vtt`);
  exportSrt(doc, srtPath);
  exportVtt(doc, vttPath);

  if (edit) {
    return { status: "edit", srtPath, vttPath, captionsPath, lines: doc.lines.length, reused };
  }

  // ---- Render (full or preview) ----
  const suffix = previewSeconds ? `${template.name}.preview` : template.name;
  const assPath = join(outDir, `${stem}.${suffix}.ass`);
  const outPath = join(outDir, `${stem}.${suffix}.captioned.mp4`);
  say(`[4/4] Rendering '${template.name}'${previewSeconds ? ` (preview ${previewSeconds}s)` : ""}…`);
  renderVideo(videoPath, doc, template, { assPath, outPath }, cfg, { quiet: true, previewSeconds });

  return { status: "rendered", outPath, srtPath, vttPath, captionsPath, lines: doc.lines.length, reused, previewSeconds };
}

// ---- CLI wrapper ----

function parseArgs(args) {
  const positional = [];
  const opts = { enhance: false, ai: false, edit: false, retranscribe: false, previewSeconds: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--template" || a === "-t") opts.templateName = args[++i];
    else if (a.startsWith("--template=")) opts.templateName = a.slice(11);
    else if (a === "--lang" || a === "-l") opts.lang = args[++i];
    else if (a.startsWith("--lang=")) opts.lang = a.slice(7);
    else if (a === "--enhance") opts.enhance = true;
    else if (a === "--ai") { opts.ai = true; opts.enhance = true; }
    else if (a === "--edit") opts.edit = true;
    else if (a === "--retranscribe") opts.retranscribe = true;
    else if (a === "--preview") {
      // optional numeric value follows
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) { opts.previewSeconds = parseInt(next, 10); i++; }
      else opts.previewSeconds = 10;
    } else if (a.startsWith("--preview=")) {
      opts.previewSeconds = parseInt(a.slice(10), 10) || 10;
    } else positional.push(a);
  }
  return { positional, opts };
}

export async function caption(args) {
  const cfg = loadConfig();
  const { positional, opts } = parseArgs(args);
  const videoArg = positional[0];
  if (!videoArg) {
    console.error("Usage: caption <video> [--template <name>] [--lang ur|hi] [--enhance] [--ai] [--edit] [--retranscribe] [--preview [sec]]");
    process.exit(1);
  }
  const videoPath = resolveMediaPath(videoArg, ["input"], cfg);
  if (!videoPath) {
    console.error(`Input video not found: ${videoArg}`);
    process.exit(1);
  }

  const templateName = opts.templateName || cfg.render?.defaultTemplate || "clean";
  const lang = opts.lang || cfg.whisper?.defaultLanguage || "ur";
  console.log(`\n=== yourCaption pipeline: ${basename(videoPath)} ===`);
  console.log(`template=${templateName}  lang=${lang}  enhance=${opts.enhance}${opts.ai ? " (ai)" : ""}${opts.previewSeconds ? `  preview=${opts.previewSeconds}s` : ""}\n`);

  let result;
  try {
    result = runPipeline(videoPath, { ...opts, templateName, lang }, cfg);
  } catch (err) {
    console.error(err.noAudio ? `${err.message}\nNothing to caption.` : `Pipeline failed: ${err.message}`);
    process.exit(err.noAudio ? 2 : 1);
  }

  if (result.status === "empty") {
    console.error(`No caption lines — nothing to render.`);
    process.exit(2);
  }
  if (result.status === "edit") {
    console.log(`\n✋ Edit pass. Fix wording in each line's "text":`);
    console.log(`     ${result.captionsPath}`);
    console.log(`   Then re-run the same command (without --edit) to render.`);
    console.log(`   Exported now: ${basename(result.srtPath)}, ${basename(result.vttPath)}`);
    return;
  }

  console.log(`\n✅ Done.`);
  console.log(`   Video : ${result.outPath} (${(statSync(result.outPath).size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`   SRT   : ${result.srtPath}`);
  console.log(`   VTT   : ${result.vttPath}`);
  if (result.previewSeconds) {
    console.log(`\n   This is a ${result.previewSeconds}s preview. Re-run without --preview for the full video.`);
  } else {
    console.log(`\n   To fix wrong words: edit "text" in ${basename(result.captionsPath)}, then re-run.`);
  }
}
