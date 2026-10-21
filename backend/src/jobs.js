// jobs.js — the job store. Jobs live in memory (a Map) AND on disk (one JSON
// file per job under backend/data/jobs/). No database, as required.
//
// Disk persistence means job records survive a server restart. On startup any
// job that was mid-flight (queued/processing) is marked "error", because the
// in-memory queue that was running it is gone.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(SRC_DIR, "..", "data", "jobs");

// Valid states: queued | processing | done | error
const TERMINAL = new Set(["done", "error"]);

/** @type {Map<string, object>} */
const jobs = new Map();

mkdirSync(DATA_DIR, { recursive: true });

function jobFile(id) {
  return join(DATA_DIR, `${id}.json`);
}

function persist(job) {
  try {
    writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2), "utf8");
  } catch (err) {
    console.error(`[jobs] could not persist ${job.id}:`, err.message);
  }
}

/**
 * Create a new job record (status "queued") and persist it.
 * @param {{language:string, template:string, originalName:string, uploadPath:string}} info
 */
export function createJob(info) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    status: "queued",
    progress: 0,
    message: "Queued — waiting for a free worker",
    language: info.language,
    template: info.template,
    originalName: info.originalName,
    uploadPath: info.uploadPath,
    outputPath: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  persist(job);
  return job;
}

/** Merge a patch into a job, bump updatedAt, persist, and return it. */
export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  persist(job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return [...jobs.values()];
}

/**
 * The public view of a job (what the API returns) — hides internal disk paths.
 */
export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    language: job.language,
    template: job.template,
    originalName: job.originalName,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    downloadReady: job.status === "done" && !!job.outputPath,
  };
}

/**
 * Load persisted jobs on startup. Any job left in a non-terminal state was
 * interrupted by the restart, so mark it as errored.
 */
export function loadJobsFromDisk() {
  if (!existsSync(DATA_DIR)) return;
  for (const file of readdirSync(DATA_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const job = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
      if (!TERMINAL.has(job.status)) {
        job.status = "error";
        job.message = "Interrupted by a server restart";
        job.error = "Interrupted by a server restart";
        job.updatedAt = new Date().toISOString();
        persist(job);
      }
      jobs.set(job.id, job);
    } catch (err) {
      console.error(`[jobs] skipping unreadable ${file}:`, err.message);
    }
  }
}
