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
