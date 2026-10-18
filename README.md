# yourCaption

A local video captioning tool for Urdu / Hindi creators.
Built module by module. Runs entirely on a MacBook Air M1 (8GB) — no cloud, no accounts.

---

## How to use this file

This is my daily working document. Each day:

1. Open this README and find the module I'm on.
2. Copy that module's **prompt block** into Claude Code (inside the `yourCaption` folder).
3. Let it do **only that module**, then stop.
4. Test the result using the module's "How I test it" line.
5. If it works, tick the box and move to the next module. If not, paste the error back to Claude Code.

**Rule: one module per session.** Never let the agent run ahead to the next module — it keeps things stable on 8GB and keeps every piece testable.

> Note: REA is not used for this project. This is a *build*, not a reverse-engineer. The caption engine, audio model, and rendering all come from open tools.

---

## Honest scope

This gets me a **real, working captioning tool** for my own videos: accurate Urdu/Hindi captions, audio cleanup, animated customizable templates, and SRT/VTT export.

It will **not** fully equal Kalakar — they're a funded team with server GPUs, a trained audio model, a cloud render farm, and NLE plugins. That's a business, not a feature set. What I'm building matches the ~90% that actually matters for a solo creator, and runs free on my own machine.

---

## Phases

**Phase 1 — Local (now):** Run everything on my M1 and make captioned videos for myself. This is what the 10 modules below deliver. Get it accurate and good-looking first.

**Phase 2 — Cloud (later):** Once the local tool works well, move the heavy steps (transcription, rendering) to a server so others could use it from a browser. This is a rebuild of *where* it runs, not *what* it does — the JSON caption model and templates carry straight over. Don't start this until Phase 1 is genuinely good.

> Why local first: I prove the engine, the Urdu/Hindi accuracy, and the templates with zero hosting cost. Cloud only earns its complexity once the thing is worth shipping. (And honestly — first job is making my own videos. lol)

---

## Reference & benchmark

**kalakar.io** — my quality bar and competitor. I study it to know what "good" looks like, not to copy it.

Learn from it (match the *bar*, build my own version):
- **Caption look** — watch their template showcase clips (Beast, Bubble, Ali Abdaal, Hormozi styles) for timing, highlight color, positioning. Recreate the *style*, design my own presets.
- **Feature set** — Urdu/Hindi/regional accuracy, audio enhancement, per-template customization, SRT/alpha export. That's my target checklist.
- **UX ideas** — one-click templates, fast preview, edit-before-render.

Don't: scrape their proprietary templates, assets, or code. It wouldn't even work (their engine is server-side, not on my machine), and it's an IP problem. The win is matching the *results* with my own build.

Research habit: before building each visual/audio feature, look at how the pros do it (Kalakar's output, plus open references like CapCut / Submagic styles), note what makes it look clean, then implement from first principles for the best result.

---

## Architecture

Single pipeline. Each stage is independent — I can improve one without breaking the others.

```
INPUT VIDEO
   |
   v
[1] Audio extraction     -> ffmpeg pulls a clean .wav
   |
   v
[2] Audio enhancement    -> denoise / normalize (ffmpeg, later AI denoiser)
   |
   v
[3] Transcription        -> whisper.cpp -> text + word-level timestamps (Urdu/Hindi)
   |
   v
[4] Caption data model   -> normalized JSON: words, timings, line grouping
   |
   v
[5] Template engine      -> JSON style preset -> styled .ass subtitle file
   |
   v
[6] Render               -> ffmpeg burns styled captions onto video
   |
   v
OUTPUT VIDEO  (+ SRT / VTT export)
```

**Key design choice:** captions become plain **JSON** in the middle. Transcription writes it; the template engine reads it. This is what lets me add templates forever without touching the Whisper side, and swap the CLI for a UI later without rewriting the engine.

**Stack:** Node.js + whisper.cpp + ffmpeg. Templates are JSON. Everything local.

**Folders:**
```
yourCaption/
  input/       # videos I drop in
  output/      # captioned videos + srt/vtt
  templates/   # JSON style presets
  src/         # the code
  config.json
  README.md    # this file
```

---

## Progress tracker

- [ ] M1 — Foundation & setup
- [ ] M2 — Audio extraction
- [ ] M3 — Transcription core
- [ ] M4 — Caption data model
- [ ] M5 — Basic rendering (first captions on screen)
- [ ] M6 — Template engine
- [ ] M7 — Animated styles (the "look")
- [ ] M8 — Audio enhancement
- [ ] M9 — Full pipeline + editing
- [ ] M10 — Polish & expand

---

## The daily prompt template

Paste this at the top of any module prompt if I want to remind the agent of context:

```
I'm building "yourCaption", a local Node.js CLI video captioning tool, on a MacBook Air M1
(8GB RAM, macOS, Apple Silicon). It uses whisper.cpp for Urdu/Hindi transcription and ffmpeg
for audio and rendering. Everything runs locally — no cloud, no accounts. We work ONE module
at a time: do only the module I give you, explain each command before running it, keep it light
on RAM, then STOP and wait for me to test. Do not start the next module.
```

---

## Module 1 — Foundation & setup

**Tasks:** install tools · scaffold project · doctor command
**How I test it:** run the doctor command — it prints OK for ffmpeg, whisper.cpp, and the model.

```
[context: see daily prompt template above]

Do ONLY Module 1, then stop.

Module 1 — Foundation & setup:
1. Install ffmpeg and whisper.cpp on this Mac (Apple Silicon). Download a Whisper model that
   handles Urdu and Hindi well (small or medium — tell me the tradeoff for 8GB). Show me each
   command before running it.
2. Scaffold the project: create folders input/, output/, templates/, src/, and a config.json.
3. Build a "doctor" npm command that checks ffmpeg, whisper.cpp, and the model are present and
   working, and prints a clear OK / MISSING report.

Explain what each step does. Then stop — do not start Module 2.
```

---

## Module 2 — Audio extraction

**Tasks:** extract to .wav · handle edge cases · `extract` command
**How I test it:** run `extract` on a test video, get a clean .wav in output.

```
[context: see daily prompt template above]

Do ONLY Module 2, then stop.

Module 2 — Audio extraction:
1. Use ffmpeg to extract audio from any input video into a standardized .wav (the format/sample
   rate whisper.cpp wants).
2. Handle edge cases: video with no audio track, unusual codecs, wrong sample rate.
3. Add a CLI command `extract <video>` that writes the clean audio to output/.

Explain the ffmpeg settings. Then stop.
```

---

## Module 3 — Transcription core

**Tasks:** run whisper · parse output · `transcribe` command
**How I test it:** `transcribe <audio> --lang ur` prints Urdu text with timings.

```
[context: see daily prompt template above]

Do ONLY Module 3, then stop.

Module 3 — Transcription core:
1. Run whisper.cpp on an audio file for Urdu/Hindi, WITH word-level timestamps.
2. Parse its output into clean objects: each word with start time, end time, confidence.
3. Add a CLI command `transcribe <audio> --lang ur` (and hi) that outputs the raw transcript.

Keep model settings light for 8GB. Then stop.
```

---

## Module 4 — Caption data model

**Tasks:** JSON schema · group words into lines · save/load
**How I test it:** transcription produces a caption .json with grouped, readable lines.

```
[context: see daily prompt template above]

Do ONLY Module 4, then stop.

Module 4 — Caption data model:
1. Define a JSON schema for captions: words, start/end times, confidence, and line grouping.
2. Group words into readable caption lines using rules (max words per line, max duration).
3. Save and load this caption JSON. This file is the backbone everything else reads.

This is the core contract between transcription and rendering — make it clean. Then stop.
```

---

## Module 5 — Basic rendering (first captions on screen)

**Tasks:** JSON -> .ass · ffmpeg burn · `render` command
**How I test it:** `render <video>` produces a video with captions burned on. First real result.

```
[context: see daily prompt template above]

Do ONLY Module 5, then stop.

Module 5 — Basic rendering:
1. Convert the caption JSON into a basic .ass subtitle file.
2. Use ffmpeg to burn that .ass onto the video.
3. Add a CLI command `render <video>` that outputs the captioned video to output/.

Keep styling plain for now (readable white text, outline). Then stop.
```

---

## Module 6 — Template engine

**Tasks:** template JSON format · renderer reads templates · 2 starter templates
**How I test it:** `render <video> --template clean` vs `--template bold` look different.

```
[context: see daily prompt template above]

Do ONLY Module 6, then stop.

Module 6 — Template engine:
1. Define a template JSON format: font, size, position, text color, highlight color, outline,
   animation style, max words on screen.
2. Make the renderer read a template file and apply its styling to the .ass output.
3. Ship 2 starter templates (one clean, one bold) and a `--template <name>` flag.

Templates are DATA, not code — adding a new one later must mean writing a new JSON file only.
Then stop.
```

---

## Module 7 — Animated styles (the "look")

**Tasks:** word-by-word reveal · active-word highlight · pop/fade
**How I test it:** a template shows words appearing one by one with the active word highlighted.

```
[context: see daily prompt template above]

Do ONLY Module 7, then stop.

Module 7 — Animated caption styles:
1. Add word-by-word reveal timing in the .ass output (words appear as they're spoken).
2. Add an active-word highlight (karaoke-style color sweep — the "Beast" effect).
3. Add pop/scale and fade animations as reusable options a template can turn on.

These are the styles that make captions look modern. Expose them as template settings. Then stop.
```

---

## Module 8 — Audio enhancement

**Tasks:** ffmpeg cleanup chain · optional AI denoiser · `enhance` command
**How I test it:** `enhance <audio>` produces noticeably cleaner audio.

```
[context: see daily prompt template above]

Do ONLY Module 8, then stop.

Module 8 — Audio enhancement:
1. Build an ffmpeg cleanup chain: noise reduction, high-pass filter, loudness normalization.
2. Add an OPTIONAL AI denoiser (DeepFilterNet) as an upgrade toggle — note the RAM cost.
3. Add a CLI command `enhance <audio>` and wire it as an optional step in the pipeline.

Default to the light ffmpeg version so it stays fast on 8GB. Then stop.
```

---

## Module 9 — Full pipeline + editing

**Tasks:** one-command pipeline · transcript edit pass · export options
**How I test it:** `caption <video> --template beast --lang ur` runs the whole chain end to end.

```
[context: see daily prompt template above]

Do ONLY Module 9, then stop.

Module 9 — Full pipeline + editing:
1. Add one command that runs the whole chain: caption <video> --template <name> --lang <ur|hi>
   (extract -> enhance -> transcribe -> model -> render).
2. Add an edit pass: let me fix transcription errors in the caption JSON before the final render
   (Whisper is ~90%, not perfect, especially names).
3. Add export options: the burned video PLUS .srt / .vtt files.

Make the edit step simple — open the JSON, fix text, re-render. Then stop.
```

---

## Module 10 — Polish & expand

**Tasks:** batch processing · template gallery · preview mode
**How I test it:** process a folder of videos; add a new template easily; preview a 10s sample.

```
[context: see daily prompt template above]

Do ONLY Module 10, then stop.

Module 10 — Polish & expand:
1. Add batch processing: caption every video in a folder in one run.
2. Build an easy "add a new template" workflow and ship 2-3 more looks (bubble, minimal, etc.).
3. Add a preview mode: render a 10-second sample before committing to the full video.

After this module, yourCaption is a complete tool. Then stop.
```

---

## What "done" looks like

Drop a video into `input/` → clean the audio → get Urdu/Hindi captions → pick a template →
styled captioned video in `output/`, plus an SRT file. A real tool I actually use.

## Things to have ready

- A 30–60 second test video with **clear Urdu or Hindi speech** (for first runs — short = fast to test).
- Patience on Module 1: installing whisper.cpp + model is the slowest step. After that it's quick.

## Notes / log

(Keep a running log here: what worked, what broke, which module I'm on, model I chose, etc.)

-
-
-
