// captions.js — Module 4: the caption data model.
//
// This is the backbone contract between transcription and everything after it.
// Shape of a caption document (version 1):
//
//   {
//     version: 1,
//     source:   { audio, language, model, createdAt },
//     grouping: { maxWordsPerLine, maxLineDuration, maxGapSeconds },
//     lines: [
//       { index, start, end, text, words: [ {word,start,end,confidence}, ... ] }
//     ]
//   }

import { readFileSync, writeFileSync } from "node:fs";

export const CAPTION_SCHEMA_VERSION = 1;

// Sentence-ending punctuation across English, Urdu and Hindi.
//   .  !  ?   ۔ (U+06D4 Urdu full stop)   ؟ (U+061F)   । (U+0964 Devanagari danda)
const SENTENCE_END = /[.!?۔؟।]+["'”’)]?\s*$/u;

function endsSentence(word) {
  return SENTENCE_END.test(word || "");
}

// Default grouping rules; callers pass overrides from config.json.
const DEFAULT_RULES = {
  maxWordsPerLine: 5,
  maxLineDuration: 3.0,
  maxGapSeconds: 0.6,
};

/**
 * Group a flat list of words into readable caption lines.
 * A new line starts when ANY rule says so (see README Module 4).
 * @param {Array<{word,start,end,confidence}>} words
 * @param {object} rules
 * @returns {Array<Array>} array of word-groups
 */
export function groupIntoLines(words, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  const groups = [];
  let current = [];

  for (const w of words) {
    if (current.length === 0) {
      current.push(w);
      continue;
    }

    const first = current[0];
    const prev = current[current.length - 1];
    const gap = w.start - prev.end;
    const spanIfAdded = w.end - first.start;

    let breakBefore = false;
    if (current.length >= r.maxWordsPerLine) breakBefore = true;
    else if (spanIfAdded > r.maxLineDuration) breakBefore = true;
    else if (gap > r.maxGapSeconds) breakBefore = true;
    else if (endsSentence(prev.word)) breakBefore = true;

    if (breakBefore) {
      groups.push(current);
      current = [w];
    } else {
      current.push(w);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Build a full caption document from parsed words + source metadata.
 * @param {Array} words  parsed words from transcription
 * @param {object} source  { audio, language, model }
 * @param {object} rules   grouping rules
 */
export function buildCaptionDoc(words, source = {}, rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  const groups = groupIntoLines(words, r);

  const lines = groups.map((group, index) => {
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const text = group.map((w) => w.word).join(" ");
    return { index, start, end, text, words: group };
  });

  return {
    version: CAPTION_SCHEMA_VERSION,
    source: {
      audio: source.audio ?? null,
      language: source.language ?? null,
      model: source.model ?? null,
      createdAt: new Date().toISOString(),
    },
    grouping: r,
    lines,
  };
}

export function saveCaptionDoc(path, doc) {
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

/**
 * Load and validate a caption document. Throws a clear error if the file
 * is not a well-formed caption doc, so later stages can trust its shape.
 */
export function loadCaptionDoc(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not read/parse caption file ${path}: ${err.message}`);
  }
  validateCaptionDoc(doc, path);
  return doc;
}

export function validateCaptionDoc(doc, label = "caption doc") {
  const fail = (msg) => {
    throw new Error(`Invalid ${label}: ${msg}`);
  };

  if (typeof doc !== "object" || doc === null) fail("not an object");
  if (typeof doc.version !== "number") fail("missing numeric 'version'");
  if (doc.version > CAPTION_SCHEMA_VERSION) {
    fail(`version ${doc.version} is newer than this tool supports (${CAPTION_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(doc.lines)) fail("'lines' must be an array");

  doc.lines.forEach((line, i) => {
    if (typeof line.start !== "number" || typeof line.end !== "number") {
      fail(`line ${i} missing numeric start/end`);
    }
    if (typeof line.text !== "string") fail(`line ${i} missing 'text'`);
    if (!Array.isArray(line.words)) fail(`line ${i} missing 'words' array`);
    line.words.forEach((w, j) => {
      if (typeof w.word !== "string") fail(`line ${i} word ${j} missing 'word'`);
      if (typeof w.start !== "number" || typeof w.end !== "number") {
        fail(`line ${i} word ${j} missing numeric start/end`);
      }
    });
  });

  return true;
}
