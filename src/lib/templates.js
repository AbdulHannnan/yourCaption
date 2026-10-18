// templates.js — Module 6: load + resolve style templates (DATA, not code).
//
// A template is a JSON file in templates/. It is merged over DEFAULT_TEMPLATE,
// so templates can be partial — they only override what they care about.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePath } from "./project.js";

// Every field a template can set, with safe defaults. Sizes are % of video height.
export const DEFAULT_TEMPLATE = {
  name: "default",
  description: "Built-in fallback style",
  font: {
    family: "Arial",
    familyByLang: { ur: "Geeza Pro", hi: "Devanagari Sangam MN" },
    sizePct: 6.0,
    bold: false,
    italic: false,
  },
  position: {
    align: "bottom", // top | middle | bottom
    marginVPct: 6.0,
    marginHPct: 4.0,
  },
  colors: {
    text: "#FFFFFF",
    outline: "#000000",
    highlight: "#FFD400", // active-word colour (used in Module 7)
    shadow: "#000000A0",
    box: "#000000B0",     // caption-box fill when outline.style = "box"
  },
  outline: {
    style: "outline",     // "outline" (text outline) or "box" (filled bubble)
    widthPct: 0.4,
    shadowPct: 0.15,
  },
  animation: "none",
  maxWordsOnScreen: 5,
};

// Deep-merge plain objects (override wins); arrays/scalars replace.
function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (typeof base !== "object" || Array.isArray(base) || typeof override !== "object" || Array.isArray(override)) {
    return override;
  }
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

export function listTemplates(cfg) {
  const dir = resolvePath(cfg.paths?.templates || "templates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

/**
 * Load a template by name from templates/<name>.json and merge over defaults.
 * Throws a helpful error (listing available templates) if not found.
 */
export function loadTemplate(name, cfg) {
  const dir = resolvePath(cfg.paths?.templates || "templates");
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) {
    const available = listTemplates(cfg);
    throw new Error(
      `Template '${name}' not found at ${path}.` +
        (available.length ? `\nAvailable templates: ${available.join(", ")}` : `\nNo templates found in ${dir}/`)
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Template '${name}' is not valid JSON: ${err.message}`);
  }
  const merged = deepMerge(DEFAULT_TEMPLATE, raw);
  merged.name = raw.name || name;
  return merged;
}

/** Pick the right font family for the caption language. */
export function resolveFontFamily(template, language) {
  const byLang = template.font?.familyByLang || {};
  const lang = (language || "").toLowerCase();
  return byLang[lang] || template.font?.family || "Arial";
}

// Animation flags with safe defaults ("off" = static line, the Module 5/6 look).
const ANIM_OFF = { reveal: false, highlight: false, pop: false, fade: false, popScale: 130, popMs: 120, fadeMs: 120 };

/**
 * Normalize a template's `animation` field (string preset OR object of flags)
 * into a flat flags object the renderer can use.
 */
export function normalizeAnimation(anim) {
  if (!anim || anim === "none") return { ...ANIM_OFF };
  if (typeof anim === "string") {
    switch (anim.toLowerCase()) {
      case "reveal":  return { ...ANIM_OFF, reveal: true, highlight: true, pop: true };
      case "karaoke": return { ...ANIM_OFF, highlight: true, pop: true };
      case "pop":     return { ...ANIM_OFF, reveal: true, pop: true };
      case "fade":    return { ...ANIM_OFF, reveal: true, fade: true };
      default:        return { ...ANIM_OFF };
    }
  }
  if (typeof anim === "object") return { ...ANIM_OFF, ...anim };
  return { ...ANIM_OFF };
}
