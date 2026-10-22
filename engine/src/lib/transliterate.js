// transliterate.js — Devanagari → Roman/Latin "Hinglish" conversion.
//
// Why this exists: Whisper cannot reliably emit Roman script for Hindi/Urdu.
// The reliable, fully-local path to Hinglish captions is to transcribe into
// Devanagari (which, unlike Urdu script, preserves short vowels) and then
// transliterate here. English words already written in Latin pass through
// untouched, so "mera naya phone kaafi acha hai" comes out naturally.
//
// Pipeline, applied per Devanagari run (Latin/English runs are left verbatim):
//   1) Schwa deletion — Hindi drops many inherent 'a' vowels ("bahut", not
//      "bahuta"). We do it on the Devanagari by inserting a virama (halant)
//      so the downstream romanizer simply produces no vowel there.
//   2) Nukta syllables (फ़ क़ ज़ ड़ ढ़ ख़ ग़ य़) are converted by hand, because
//      Sanscript leaves the nukta sign dangling and mangles the vowel.
//   3) The rest goes through Sanscript (Devanagari → ITRANS), then a cleanup
//      pass maps long vowels to single letters, strips ITRANS control marks,
//      and lowercases — giving casual, readable Hinglish.

import Sanscript from "@indic-transliteration/sanscript";

// ---- Unicode ranges (Devanagari) ----
const NUKTA = "़";
const VIRAMA = "्";
const ANUSVARA = "ं";
const VISARGA = "ः";
const CHANDRABINDU = "ँ";

const isConsonant = (c) =>
  (c >= "क" && c <= "ह") || (c >= "क़" && c <= "य़");
const isIndependentVowel = (c) =>
  (c >= "ऄ" && c <= "औ") || c === "ॠ" || c === "ॡ";
const isMatra = (c) =>
  (c >= "ा" && c <= "ौ") || c === "ॢ" || c === "ॣ";
const isDevanagari = (c) => c >= "ऀ" && c <= "ॿ";

// Nukta consonant -> Latin consonant (no inherent vowel). Covers precomposed
// codepoints (U+0958–U+095F) and the decomposed base-consonant form.
const NUKTA_CONS = {
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z",
  "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y",
};
const BASE_FOR_NUKTA = {
  "क": "q", "ख": "kh", "ग": "gh", "ज": "z",
  "ड": "r", "ढ": "rh", "फ": "f", "य": "y",
};

// Independent vowels -> Latin. Initial long 'aa' reads far better than 'a'
// ("aaj", "aapka"); the rest stay single-letter for a consistent casual look.
const INDEP_VOWEL = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "i",
  "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai",
  "ओ": "o", "औ": "au", "ऋ": "ri",
};

// Candra vowel signs (ऑ/ऍ, used for English-ish sounds) -> nearest standard matra.
const CANDRA_MATRA = { "ॉ": "ो", "ॊ": "ो", "ॅ": "े", "ॆ": "े" };

// Dependent vowel signs (matras) -> Latin vowel (single-letter, casual style).
const MATRA = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};

// ---- Stage 1: schwa deletion over a single Devanagari word ----

// Parse a Devanagari word into units. Each unit tracks whether it is a
// consonant carrying an inherent schwa (consonant with no matra/virama).
function parseUnits(word) {
  const units = [];
  for (let i = 0; i < word.length; ) {
    const c = word[i];
    if (isConsonant(c)) {
      const u = { type: "cons", start: i, nukta: false, matra: false, virama: false, nasal: false };
      i++;
      if (word[i] === NUKTA) { u.nukta = true; i++; }
      if (isMatra(word[i])) { u.matra = true; i++; }
      else if (word[i] === VIRAMA) { u.virama = true; i++; }
      if (word[i] === ANUSVARA || word[i] === CHANDRABINDU || word[i] === VISARGA) { u.nasal = true; i++; }
      u.end = i;
      u.inherentSchwa = !u.matra && !u.virama; // pronounced 'a' unless deleted
      units.push(u);
    } else if (isIndependentVowel(c)) {
      units.push({ type: "vowel", start: i, end: i + 1 });
      i++;
    } else {
      units.push({ type: "other", start: i, end: i + 1 });
      i++;
    }
  }
  return units;
}

// Decide which inherent schwas to drop, then rebuild the word with viramas
// inserted at those positions. Rules (a practical subset of Hindi schwa
// deletion): drop a trailing schwa; drop a medial schwa when the next unit is
// vowel-bearing — but never the very first consonant (protects "bahut", not
// "bhut"). Processed right-to-left so downstream deletions are known.
function deleteSchwas(word) {
  const units = parseUnits(word);
  let lastConsIdx = -1;
  for (let i = units.length - 1; i >= 0; i--) {
    if (units[i].type === "cons") { lastConsIdx = i; break; }
  }
  const deleted = new Array(units.length).fill(false);

  const bearsVowel = (j) => {
    const u = units[j];
    if (!u) return false;
    if (u.type === "vowel") return true;
    if (u.type === "cons") return u.matra || u.nasal || (u.inherentSchwa && !deleted[j]);
    return false;
  };

  // Right-to-left so later deletions are known when judging a medial schwa.
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.type !== "cons" || !u.inherentSchwa || u.nasal) continue;
    if (i === 0) continue;                      // protect a word-initial consonant ("bahut", not "bhut")
    if (i === lastConsIdx) { deleted[i] = true; continue; } // trailing schwa ("ham", "par")
    if (bearsVowel(i + 1)) deleted[i] = true;   // medial schwa before a vowel ("aapka")
  }

  // Rebuild, appending a virama after each schwa-deleted consonant.
  let out = "";
  for (let i = 0; i < units.length; i++) {
    out += word.slice(units[i].start, units[i].end);
    if (deleted[i]) out += VIRAMA;
  }
  return out;
}

// ---- Stage 2: nukta syllables -> Latin ----

function emitNuktaSyllable(cons, str, i) {
  const nextCh = str[i];
  if (nextCh === VIRAMA) return { latin: cons, next: i + 1 };
  if (MATRA[nextCh]) return { latin: cons + MATRA[nextCh], next: i + 1 };
  if (nextCh === ANUSVARA || nextCh === CHANDRABINDU) return { latin: cons + "an", next: i + 1 };
  return { latin: cons + "a", next: i }; // inherent schwa (kept)
}

function preprocessNukta(str) {
  let out = "";
  for (let i = 0; i < str.length; ) {
    const ch = str[i];
    if (INDEP_VOWEL[ch]) { out += INDEP_VOWEL[ch]; i++; continue; }
    if (NUKTA_CONS[ch]) {
      const { latin, next } = emitNuktaSyllable(NUKTA_CONS[ch], str, i + 1);
      out += latin; i = next; continue;
    }
    if (BASE_FOR_NUKTA[ch] && str[i + 1] === NUKTA) {
      const { latin, next } = emitNuktaSyllable(BASE_FOR_NUKTA[ch], str, i + 2);
      out += latin; i = next; continue;
    }
    out += ch; i++;
  }
  return out;
}

// ---- Stage 3: ITRANS cleanup -> casual Hinglish ----

function cleanupHinglish(s) {
  let t = s;
  t = t.replace(/RRI|RRi|R\^i/g, "ri").replace(/LLI|LLi/g, "li");
  t = t.replace(/~N|~n|N\^|\.n|\.m|\.N|M/g, "n");          // nasals / anusvara -> n
  t = t.replace(/\.c|\.h/g, "").replace(/[~_^]/g, "");
  t = t.replace(/\|\|?/g, ".");                            // danda -> .
  // Candra vowel signs (used for English-ish ऑ/ऍ sounds) Sanscript leaves raw.
  t = t.replace(/[ॉॊ]/g, "o").replace(/[ॅॆ]/g, "e");
  t = t.replace(/[़‍‌']/g, "");             // stray marks
  // Long vowels -> single letters (ITRANS marks them with capitals).
  t = t.replace(/A/g, "a").replace(/I/g, "i").replace(/U/g, "u");
  t = t.replace(/E/g, "e").replace(/O/g, "o");
  t = t.toLowerCase();
  t = t.replace(/([a-z])\1{2,}/g, "$1$1");                 // cap triple letters
  return t;
}

// Romanize one Devanagari-only run (no Latin inside).
function romanizeRun(run) {
  let deSchwa = deleteSchwas(run.normalize("NFC"));
  deSchwa = deSchwa.replace(/[ॉॊॅॆ]/g, (c) => CANDRA_MATRA[c]);
  const pre = preprocessNukta(deSchwa);
  let roman;
  try {
    roman = Sanscript.t(pre, "devanagari", "itrans");
  } catch {
    roman = pre;
  }
  return cleanupHinglish(roman);
}

// Common English loanwords that Whisper writes phonetically in Devanagari.
// After romanization they come out spelled by sound ("sekshan", "mobail"); a
// Hinglish creator expects the real English spelling. Keyed by the romanized
// form -> English. Kept conservative (clear, multi-syllable tech/CS words) so
// it never rewrites a genuine Hindi/Urdu word. Extend freely for your niche.
const ENGLISH_FIXUPS = {
  sekshan: "section", sikshan: "section", seKshan: "section",
  bloks: "blocks", blok: "block", rimuv: "remove", rimoov: "remove",
  mobail: "mobile", mobaail: "mobile", sabsakraib: "subscribe", sabskraib: "subscribe",
  kveshchan: "question", kvschan: "question", chainal: "channel", chainel: "channel",
  vidiyo: "video", viidiyo: "video", intarnet: "internet", kampyutar: "computer",
  onlain: "online", bijnes: "business", bizanes: "business", saksesh: "success", sakses: "success",
  podkast: "podcast", vebsait: "website", sarvar: "server", brauzar: "browser",
  daunlod: "download", aplod: "upload", kament: "comment", skrin: "screen",
  batan: "button", dizain: "design", projekt: "project", kantent: "content",
  notifikeshan: "notification", akaunt: "account", pej: "page", lingk: "link",
  // Very common Hindi function words that read more naturally this way
  // (none of these are English words, so there is no passthrough collision).
  vah: "wo", yah: "ye", hun: "hoon", nahi: "nahin",
};

function applyEnglishFixups(token) {
  const key = token.toLowerCase().replace(/[.,!?;:]+$/, "");
  const tail = token.slice(key.length); // keep trailing punctuation
  const fixed = ENGLISH_FIXUPS[key];
  return fixed ? fixed + tail : token;
}

/**
 * Romanize a mixed Devanagari/Latin string into Hinglish.
 * Devanagari runs are transliterated; everything else (English, digits,
 * punctuation, spaces) is preserved exactly.
 */
export function romanizeText(text) {
  if (!text) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (isDevanagari(text[i])) {
      let j = i;
      while (j < text.length && isDevanagari(text[j])) j++;
      out += romanizeRun(text.slice(i, j));
      i = j;
    } else {
      out += text[i];
      i++;
    }
  }
  // Restore real English spelling for common loanwords (token-wise).
  return out
    .split(/(\s+)/)
    .map((tok) => (/\s/.test(tok) ? tok : applyEnglishFixups(tok)))
    .join("");
}

/** Romanize each word object's `word` field in place; keeps timings/confidence. */
export function romanizeWords(words) {
  for (const w of words) {
    if (w && typeof w.word === "string") w.word = romanizeText(w.word);
  }
  return words;
}
