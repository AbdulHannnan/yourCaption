// engine.js — the ONLY bridge between the backend and the caption engine.
//
// Design rule: the backend never imports or re-implements any engine logic.
// It treats the engine as a separate, self-contained CLI living in ../engine
// and talks to it by spawning `node src/cli.js <command> ...` as a child
// process. The engine resolves all of its own paths (config, model, templates,
// input, output) relative to its own location, so running it with cwd set to
// the engine folder behaves exactly like running it by hand from inside engine/.
//
// This module only knows HOW to launch the engine. WHAT to launch (job queue,
// uploads, endpoints) is built on top of it in point 5.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// This file is backend/src/engine.js, so the repo root is two levels up and the
// engine lives beside the backend folder.
const BACKEND_SRC = dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = join(BACKEND_SRC, "..", "..", "engine");
export const ENGINE_CLI = join(ENGINE_DIR, "src", "cli.js");

/**
 * Run one engine CLI command as a child process.
 *
 * @param {string[]} args            CLI args, e.g. ["caption", "clip.mp4", "--template", "bold"]
 * @param {object}   [opts]
 * @param {(line:string, stream:"stdout"|"stderr")=>void} [opts.onLog]
 *        Called for every line the engine prints — used by the job queue to
 *        surface progress. Optional.
 * @param {string}   [opts.cwd]      Working directory for the engine (default: ENGINE_DIR).
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 *          Resolves on exit. A non-zero exit code is returned, not thrown, so
 *          callers can decide how to report engine failures without crashing.
 */
export function runEngine(args, { onLog, cwd = ENGINE_DIR } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENGINE_CLI, ...args], {
      cwd,
      // Inherit the environment so PATH (ffmpeg, whisper-cli) is available.
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const pump = (chunk, stream) => {
      const text = chunk.toString();
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (onLog) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog(line, stream);
        }
      }
    };

    child.stdout.on("data", (c) => pump(c, "stdout"));
    child.stderr.on("data", (c) => pump(c, "stderr"));

    // A spawn failure (e.g. node missing) is a real error — reject it.
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Ask the engine for its list of templates by running `cli.js templates` and
 * parsing the output. Each printed entry is two leading spaces, the name, then
 * its description. Going through the CLI keeps template discovery owned by the
 * engine — the backend never reads the engine's template files itself.
 * @returns {Promise<Array<{name:string, description:string}>>}
 */
export async function listTemplates() {
  const { code, stdout, stderr } = await runEngine(["templates"]);
  if (code !== 0) {
    throw new Error(`engine 'templates' failed: ${stderr.trim() || `exit ${code}`}`);
  }
  const templates = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^ {2}(\S+)\s+(.*)$/);
    if (m) templates.push({ name: m[1], description: m[2].trim() });
  }
  return templates;
}

// Map the engine's step markers to a coarse progress %. The transcription step
// is by far the slowest, so the jump from 40 -> 85 covers most of the wait.
const STEP_PROGRESS = [
  { re: /\[1\/4\]/, progress: 10, message: "Extracting audio" },
  { re: /\[2\/4\]/, progress: 25, message: "Preparing audio" },
  { re: /\[3\/4\]/, progress: 40, message: "Transcribing (this is the slow step)" },
  { re: /\[1-3\]/, progress: 40, message: "Reusing existing captions" },
  { re: /\[4\/4\]/, progress: 85, message: "Rendering captions onto the video" },
];

/**
 * Run the full caption pipeline for one video via the engine CLI.
 *
 * @param {object} params
 * @param {string} params.videoPath   Absolute path to the uploaded video.
 * @param {string} params.language    Language code (e.g. "ur", "hi").
 * @param {string} params.template    Template name.
 * @param {(patch:{progress?:number,message?:string})=>void} [params.onProgress]
 *        Called as the engine advances through its steps.
 * @returns {Promise<{outputPath:string}>}
 * @throws  Error with a clean message if the engine fails or produces nothing.
 */
export async function runCaption({ videoPath, language, template, onProgress }) {
  const args = ["caption", videoPath, "--template", template, "--lang", language];

  const { code, stdout, stderr } = await runEngine(args, {
    onLog: (line) => {
      if (!onProgress) return;
      for (const step of STEP_PROGRESS) {
        if (step.re.test(line)) {
          onProgress({ progress: step.progress, message: step.message });
          break;
        }
      }
    },
  });

  const combined = `${stdout}\n${stderr}`;

  if (code !== 0) {
    // The engine exits 2 when there is no audio / no caption lines — surface a
    // friendly reason; otherwise fall back to whatever it printed.
    const reason = stderr.trim() || stdout.trim() || `engine exited with code ${code}`;
    throw new Error(reason.split("\n").slice(-3).join(" ").trim());
  }

  // The engine prints the finished file as:  "   Video : /abs/path.mp4 (45.3 MB)"
  const m = combined.match(/Video\s*:\s*(.+?\.mp4)\s*\(/);
  if (!m) {
    throw new Error("engine finished but no output video path was found in its output");
  }
  return { outputPath: m[1].trim() };
}
