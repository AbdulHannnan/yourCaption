import React, { useEffect, useRef, useState } from "react";

// Languages the engine supports.
const LANGUAGES = [
  { code: "hinglish", label: "Hinglish (Roman Urdu/Hindi)" },
  { code: "ur", label: "Urdu (script)" },
  { code: "hi", label: "Hindi (script)" },
];

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function App() {
  const [templates, setTemplates] = useState([]);
  const [file, setFile] = useState(null);
  const [language, setLanguage] = useState("hinglish");
  const [template, setTemplate] = useState("");
  const [job, setJob] = useState(null); // { id, status, progress, message }
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef(null);
  const inputRef = useRef(null);

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

  const busy = job && job.status !== "done" && job.status !== "error";

  function pickFile(f) {
    if (!f) return;
    setError("");
    setFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("video/")) pickFile(f);
    else if (f) setError("That doesn't look like a video file.");
  }

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

  const progress = Math.max(0, Math.min(100, job?.progress ?? 0));
  const statusKind =
    job?.status === "done" ? "is-done" : job?.status === "error" ? "is-error" : "is-active";
  // Show an indeterminate bar while active but no real progress reported yet.
  const indeterminate = busy && progress === 0;

  return (
    <div className="page">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 8-6 4 6 4V8Z" />
            <rect x="2" y="6" width="14" height="12" rx="2" />
          </svg>
        </div>
        <h1 className="h1">your<span className="accent">Caption</span></h1>
      </div>
      <p className="sub">
        Upload a video, pick a language and style, and get captions burned right in.
      </p>

      <form onSubmit={handleSubmit} className="card form">
        {/* File dropzone */}
        <div className="field">
          <span className="field-label">Video</span>
          <div
            className={[
              "dropzone",
              dragging ? "dragging" : "",
              file ? "has-file" : "",
              busy ? "disabled" : "",
            ].join(" ").trim()}
            role="button"
            tabIndex={busy ? -1 : 0}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !busy) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              onChange={(e) => pickFile(e.target.files[0] || null)}
              disabled={busy}
            />

            {file ? (
              <div className="file-row">
                <div className="file-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 8-6 4 6 4V8Z" />
                    <rect x="2" y="6" width="14" height="12" rx="2" />
                  </svg>
                </div>
                <div className="file-meta">
                  <div className="file-name">{file.name}</div>
                  <div className="file-size">{formatBytes(file.size)}</div>
                </div>
                {!busy && (
                  <button
                    type="button"
                    className="file-clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="dz-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="dz-title">Drop a video here</div>
                <div className="dz-hint">
                  or <span className="dz-browse">browse</span> to upload
                </div>
              </>
            )}
          </div>
        </div>

        {/* Language */}
        <div className="field">
          <label className="field-label" htmlFor="language">Language</label>
          <select
            id="language"
            className="select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        {/* Template */}
        <div className="field">
          <label className="field-label" htmlFor="template">Caption style</label>
          <select
            id="template"
            className="select"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={busy || !templates.length}
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name} — {t.description}</option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={busy} className="button">
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Working…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 18, height: 18 }}>
                <path d="M5 3 19 12 5 21 5 3Z" />
              </svg>
              Caption it
            </>
          )}
        </button>
      </form>

      {error && (
        <div className="alert alert-error" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {job && (
        <div className="status">
          <div className="status-head">
            <span className={`status-badge ${statusKind}`}>
              <span className={`dot ${busy ? "pulse" : ""}`} />
              {job.status}
            </span>
            {job.status !== "error" && <span className="status-pct">{progress}%</span>}
          </div>

          {job.status !== "error" && (
            <div className="progress">
              <div
                className={`progress-bar ${indeterminate ? "indeterminate" : ""}`}
                style={indeterminate ? undefined : { width: `${progress}%` }}
              />
            </div>
          )}

          {job.status === "error" ? (
            <div className="status-msg" style={{ color: "var(--err)" }}>
              {job.error || job.message || "Something went wrong while processing."}
            </div>
          ) : (
            job.message && <div className="status-msg">{job.message}</div>
          )}

          {job.status === "done" && (
            <a href={`/jobs/${job.id}/download`} className="download">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download captioned video
            </a>
          )}
        </div>
      )}

      <p className="footer">Powered by Whisper · burned-in captions</p>
    </div>
  );
}
