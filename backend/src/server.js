// server.js — yourCaption backend API.
//
// Endpoints:
//   POST /jobs                 upload a video + { language, template } -> { jobId }
//   GET  /jobs/:id             job status (queued|processing|done|error) + progress
//   GET  /jobs/:id/download    the finished captioned video
//   GET  /templates            templates available from the engine
//   GET  /health               server + queue + engine health
//
// Jobs run ONE AT A TIME through an in-memory serial queue (SerialQueue) so an
// 8GB machine is never asked to caption two videos at once. A job that fails
// (bad file, engine error) is recorded as "error" and never crashes the server.

import express from "express";
import multer from "multer";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";

import { ENGINE_DIR, ENGINE_CLI, listTemplates, runCaption } from "./engine.js";
import { SerialQueue } from "./queue.js";
import { createJob, updateJob, getJob, publicJob, loadJobsFromDisk } from "./jobs.js";

const PORT = process.env.PORT || 4000;
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(SRC_DIR, "..", "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- Uploads (multer): store on disk with a unique name ----
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    // Unique filename -> unique engine output stem -> no collisions between jobs.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB cap
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith("video/") || VIDEO_EXTS.has(extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Unsupported file type — please upload a video"), ok);
  },
});

// ---- App + queue ----
const app = express();
app.use(express.json());

const queue = new SerialQueue();
loadJobsFromDisk();

// ---- GET /health ----
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    engineFound: existsSync(ENGINE_CLI),
    queue: { pending: queue.pending, active: queue.active },
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// ---- GET /templates ----
app.get("/templates", async (_req, res) => {
  try {
    res.json({ templates: await listTemplates() });
  } catch (err) {
    res.status(502).json({ error: `Could not list templates: ${err.message}` });
  }
});

// ---- POST /jobs ----
// multer runs first; we wrap it so an upload error (bad type, too big) returns
// a clean 400 instead of bubbling up and crashing the process.
app.post("/jobs", (req, res) => {
  upload.single("video")(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded (field name must be 'video')" });
    }

    // Validate template against what the engine actually offers.
    let available;
    try {
      available = await listTemplates();
    } catch (err) {
      return res.status(502).json({ error: `Engine unavailable: ${err.message}` });
    }
    const names = available.map((t) => t.name);
    const template = req.body.template || (names.includes("clean") ? "clean" : names[0]);
    const language = req.body.language || "hinglish";

    if (!names.includes(template)) {
      return res.status(400).json({ error: `Unknown template '${template}'. Available: ${names.join(", ")}` });
    }

    const job = createJob({
      language,
      template,
      originalName: req.file.originalname,
      uploadPath: req.file.path,
    });

    // Hand the actual work to the serial queue; respond immediately.
    queue.enqueue(async () => {
      updateJob(job.id, { status: "processing", progress: 5, message: "Starting" });
      try {
        const { outputPath } = await runCaption({
          videoPath: job.uploadPath,
          language,
          template,
          onProgress: (patch) => updateJob(job.id, patch),
        });
        updateJob(job.id, { status: "done", progress: 100, message: "Completed", outputPath });
      } catch (err) {
        updateJob(job.id, { status: "error", message: `Captioning failed: ${err.message}`, error: err.message });
      }
    });

    res.status(202).json({ jobId: job.id, status: job.status });
  });
});

// ---- GET /jobs/:id ----
app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(publicJob(job));
});

// ---- GET /jobs/:id/download ----
app.get("/jobs/:id/download", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "done" || !job.outputPath) {
    return res.status(409).json({ error: `Job is '${job.status}', not ready for download` });
  }
  if (!existsSync(job.outputPath)) {
    return res.status(410).json({ error: "Output file is no longer available" });
  }
  // Give the browser a friendly filename based on the original upload.
  const base = basename(job.originalName, extname(job.originalName));
  const niceName = `${base}.${job.template}.captioned.mp4`;
  res.download(job.outputPath, niceName);
});

// ---- Fallback error handler (last resort; keeps the server alive) ----
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error:", err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

// Fail-soft if the engine is missing.
if (!existsSync(ENGINE_CLI)) {
  console.warn(`⚠️  Engine CLI not found at ${ENGINE_CLI} — jobs will fail until it exists.`);
}

app.listen(PORT, () => {
  console.log(`yourCaption backend listening on http://localhost:${PORT}`);
  console.log(`Engine : ${ENGINE_DIR}`);
  console.log(`Uploads: ${UPLOAD_DIR}`);
});
