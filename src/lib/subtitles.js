// subtitles.js — Module 9: export the caption doc to .srt and .vtt.
// Line-level timing + text (the human-facing field), so edits are reflected.

import { writeFileSync } from "node:fs";

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

// seconds -> HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT)
function formatTime(sec, msSep) {
  let ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000);   ms -= m * 60000;
  const s = Math.floor(ms / 1000);    ms -= s * 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(ms, 3)}`;
}

export function toSrt(doc) {
  const lines = doc.lines || [];
  return lines
    .map((line, i) => {
      const t = `${formatTime(line.start, ",")} --> ${formatTime(line.end, ",")}`;
      return `${i + 1}\n${t}\n${String(line.text).trim()}\n`;
    })
    .join("\n");
}

export function toVtt(doc) {
  const lines = doc.lines || [];
  const body = lines
    .map((line) => {
      const t = `${formatTime(line.start, ".")} --> ${formatTime(line.end, ".")}`;
      return `${t}\n${String(line.text).trim()}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function exportSrt(doc, path) {
  writeFileSync(path, toSrt(doc), "utf8");
}

export function exportVtt(doc, path) {
  writeFileSync(path, toVtt(doc), "utf8");
}
