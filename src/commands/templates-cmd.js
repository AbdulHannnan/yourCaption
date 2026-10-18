// templates-cmd.js — Module 10: list templates and scaffold new ones.
//
//   templates                 list available templates
//   new-template <name>       create templates/<name>.json from a full starter

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolvePath } from "../lib/project.js";
import { listTemplates, loadTemplate, DEFAULT_TEMPLATE } from "../lib/templates.js";

export async function templates(args) {
  const cfg = loadConfig();
  const names = listTemplates(cfg);
  if (names.length === 0) {
    console.log("No templates found in templates/.");
    return;
  }
  console.log(`\nAvailable templates (templates/):\n`);
  for (const name of names.sort()) {
    let desc = "";
    try { desc = loadTemplate(name, cfg).description || ""; } catch { /* ignore */ }
    console.log(`  ${name.padEnd(10)} ${desc}`);
  }
  console.log(`\nUse one with:  caption <video> --template <name>\n`);
}

export async function newTemplate(args) {
  const cfg = loadConfig();
  const name = args[0];
  if (!name) {
    console.error("Usage: new-template <name>");
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    console.error(`Invalid name '${name}'. Use letters, digits, '-' and '_'.`);
    process.exit(1);
  }

  const dir = resolvePath(cfg.paths?.templates || "templates");
  const path = join(dir, `${name}.json`);
  if (existsSync(path)) {
    console.error(`Template already exists: ${path}`);
    process.exit(1);
  }

  // Scaffold a FULL template (all fields) so the user only tweaks values.
  const starter = {
    ...structuredClone(DEFAULT_TEMPLATE),
    name,
    description: `My ${name} caption style`,
  };
  writeFileSync(path, JSON.stringify(starter, null, 2) + "\n", "utf8");

  console.log(`\n✅ Created templates/${name}.json\n`);
  console.log(`It's DATA — just edit the values, no code needed. Fields:`);
  console.log(`  font.sizePct        text size as % of video height (e.g. 6 = small, 8 = big)`);
  console.log(`  font.bold/italic    true/false`);
  console.log(`  font.familyByLang   per-language fonts (ur/hi already set correctly)`);
  console.log(`  position.align      "bottom" | "middle" | "top"`);
  console.log(`  position.marginVPct distance from the edge, % of height`);
  console.log(`  colors.text/outline/highlight/shadow/box   hex (#RRGGBB or #RRGGBBAA)`);
  console.log(`  outline.style       "outline" (text outline) or "box" (filled bubble)`);
  console.log(`  outline.widthPct    outline thickness, % of height`);
  console.log(`  animation           "none" | "reveal" | "karaoke" | "pop" | "fade"`);
  console.log(`                      (or an object: {reveal,highlight,pop,fade,popScale,popMs})`);
  console.log(`\nThen:  caption <video> --template ${name}\n`);
}
