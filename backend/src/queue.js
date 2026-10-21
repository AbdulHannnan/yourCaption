// queue.js — a dead-simple in-memory, one-at-a-time job queue.
//
// Captioning is heavy (ffmpeg + whisper) and this runs on an 8GB machine, so
// we MUST NOT run two jobs at once. This queue guarantees strict serial
// execution: enqueued tasks run in FIFO order, one after another, and a task
// that throws never stops the queue from moving on to the next one.

export class SerialQueue {
  constructor() {
    /** @type {Array<() => Promise<void>>} */
    this._tasks = [];
    this._running = false;
  }

  /** Number of tasks waiting (not counting the one currently running). */
  get pending() {
    return this._tasks.length;
  }

  /** 1 while a task is executing, else 0. */
  get active() {
    return this._running ? 1 : 0;
  }

  /**
   * Add a task (an async function). It will run after all previously enqueued
   * tasks finish. Rejections are swallowed here on purpose — the task itself is
   * responsible for recording its own failure (e.g. marking the job "error").
   */
  enqueue(task) {
    this._tasks.push(task);
    this._drain();
  }

  async _drain() {
    if (this._running) return;
    this._running = true;
    try {
      while (this._tasks.length > 0) {
        const task = this._tasks.shift();
        try {
          await task();
        } catch (err) {
          // Should not happen (tasks handle their own errors), but we never let
          // one bad task crash the worker loop or the server process.
          console.error("[queue] task threw (ignored):", err?.message || err);
        }
      }
    } finally {
      this._running = false;
    }
  }
}
