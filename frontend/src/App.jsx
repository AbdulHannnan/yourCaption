import React, { useEffect, useRef, useState } from "react";

// Languages the engine supports.
const LANGUAGES = [
  { code: "hinglish", label: "Hinglish (Roman Urdu/Hindi)" },
  { code: "ur", label: "Urdu (script)" },
  { code: "hi", label: "Hindi (script)" },
];

export default function App() {
  const [templates, setTemplates] = useState([]);
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState("hinglish");
  const [template, setTemplate] = useState("");
  const [job, setJob] = useState(null); // { id, status, progress, message }
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  // Load templates from the backend on mount.
  useEffect(() => {
    fetch("/templates")
      .then((r) => r.json())
      .then((data) => {
        const list = data.templates || [];
        setTemplates(list);
        if (list.length) setTemplate(list[0].name);
      })
      .catch(() => setError("Could not load templates — is the backend running?"));
  }, []);

  // Poll job status while a job is active; stop on done/error or unmount.
  useEffect(() => {
    if (!job?.id) return;
    if (job.status === "done" || job.status === "error") return;

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/jobs/${job.id}`);
        const data = await r.json();
        setJob(data);
      } catch {
        /* transient; keep polling */
      }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [job?.id, job?.status]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Please choose a video file.");
      return;
    }
    const form = new FormData();
    form.append("video", file);
    form.append("language", language);
    form.append("template", template);

    try {
      const r = await fetch("/jobs", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      setJob({ id: data.jobId, status: data.status, progress: 0, message: "Queued" });
    } catch {
      setError("Could not reach the backend.");
    }
  }

  const busy = job && job.status !== "done" && job.status !== "error";

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>yourCaption</h1>
      <p style={styles.sub}>Upload a video, pick a language and style, and get captions burned in.</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Video
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files[0] || null)}
            disabled={busy}
          />
        </label>

        <label style={styles.label}>
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Template
          <select value={template} onChange={(e) => setTemplate(e.target.value)} disabled={busy || !templates.length}>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name} — {t.description}</option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={busy} style={styles.button}>
          {busy ? "Working…" : "Caption it"}
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      {job && (
        <div style={styles.status}>
          <div><strong>Status:</strong> {job.status}</div>
          <div><strong>Progress:</strong> {job.progress ?? 0}%</div>
          {job.message && <div style={styles.msg}>{job.message}</div>}

          {job.status === "done" && (
            <a href={`/jobs/${job.id}/download`} style={styles.download}>⬇ Download captioned video</a>
          )}
          {job.status === "error" && <p style={styles.error}>{job.error || job.message}</p>}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { maxWidth: 520, margin: "48px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif", color: "#1a1a1a" },
  h1: { margin: 0, fontSize: 28 },
  sub: { color: "#666", marginTop: 4 },
  form: { display: "flex", flexDirection: "column", gap: 16, marginTop: 24 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontWeight: 600, fontSize: 14 },
  button: { padding: "10px 16px", fontSize: 16, fontWeight: 600, border: "none", borderRadius: 8, background: "#2563eb", color: "#fff", cursor: "pointer" },
  status: { marginTop: 24, padding: 16, border: "1px solid #e5e5e5", borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 },
  msg: { color: "#666", fontSize: 14 },
  download: { marginTop: 8, fontWeight: 600, color: "#2563eb" },
  error: { color: "#dc2626", fontWeight: 600 },
};
