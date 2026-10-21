// server.js — yourCaption backend entry point.
//
// Point 4 scope: just stand up the Express app and confirm it boots and can
// locate the engine it will drive. The real API surface (async jobs, uploads,
// /templates, /health, downloads) is added in point 5 — this file deliberately
// keeps only a single liveness route for now.

import express from "express";
import { existsSync } from "node:fs";
import { ENGINE_DIR, ENGINE_CLI } from "./engine.js";

const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.json());

// Minimal liveness route. (The full /health check lands in point 5.)
app.get("/", (_req, res) => {
  res.json({
    service: "yourCaption-backend",
    status: "up",
    engineFound: existsSync(ENGINE_CLI),
  });
});

// Fail fast with a clear message if the engine isn't where we expect it.
if (!existsSync(ENGINE_CLI)) {
  console.warn(`⚠️  Engine CLI not found at ${ENGINE_CLI} — the backend cannot run jobs.`);
}

app.listen(PORT, () => {
  console.log(`yourCaption backend listening on http://localhost:${PORT}`);
  console.log(`Engine: ${ENGINE_DIR}`);
});
