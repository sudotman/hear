import { buildStitchedWav, decodeWav, encodeWav, silentWav } from "./neural-audio.js";

// How much generated audio to keep ready ahead of the listener.
const LOOKAHEAD_SECONDS = 150;
// While paused (and visible) keep a modest head start so resuming is instant
// without generating an entire book in the background.
const PAUSED_LOOKAHEAD_SECONDS = 40;
// A playback window is one stitched WAV. Longer windows mean fewer source
// swaps; the cap bounds memory (≈ 11 MB at 24 kHz / 16-bit).
const MAX_WINDOW_SECONDS = 240;
const MAX_WINDOW_SEGMENTS = 80;
const KEEP_BEHIND_SEGMENTS = 24;
const MAX_STORED_SEGMENTS = 320;
const ESTIMATED_WORDS_PER_SECOND = 170 / 60;
const PLAY_TIMEOUT_MS = 15_000;
const SKIPPED_SEGMENT_SECONDS = 0.3;
// Start (or resume after a stall) only with this much contiguous audio
// ready, so a short title or heading is not followed straight by a gap.
const START_BUFFER_SECONDS = 3;
// Every window ends with this much extra silence so the next window can take
// over while the element is still playing. iOS refuses to start new media
// from an `ended` handler once the screen is locked.
const HANDOFF_PAD_SECONDS = 1;
// Expected delay between noticing the handoff point (timeupdate fires every
// ≤250 ms) and the next window starting; taken out of the final pause.
const HANDOFF_LEAD_SECONDS = 0.15;

function windowLocate(win, seconds) {
  const sample = Math.max(0, seconds) * win.sampleRate;
  let low = 0;
  let high = win.offsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (win.offsets[mid] <= sample) low = mid;
    else high = mid - 1;
  }
  const speech = win.speech[low] || 1;
  return {
    index: win.start + low,
    fraction: Math.min(1, Math.max(0, (sample - win.offsets[low]) / speech)),
  };
}

function windowTime(win, index, fraction = 0) {
  const local = index - win.start;
  return (win.offsets[local] + Math.min(1, Math.max(0, fraction)) * win.speech[local]) / win.sampleRate;
}

/**
 * Plays locally synthesised speech through one real <audio> element so iOS
 * Control Center, the lock screen, and Media Session keep working.
 *
 * - One synthesis job runs at a time, always for the earliest missing
 *   sentence after the playhead. Seeking just changes what "earliest missing"
 *   means; finished jobs are kept, so nothing is thrown away.
 * - Ready sentences are stitched into a single WAV with their pauses baked in,
 *   so playback crosses sentence boundaries without swapping sources or
 *   relying on timers that iOS freezes on the lock screen.
 * - While waiting for audio, a silent loop keeps the audio session alive.
 *
 * engine:  { identity(), ready(), synthesize(text, identity) → { samples: Int16Array, sampleRate, identity? } }
 * cache:   { key(text, identity), get(key) → ArrayBuffer|null, put(key, wavBuffer, seconds) }
 */
export class NeuralPlayer {
  constructor({ audio, engine, cache, callbacks = {} }) {
    this.audio = audio;
    this.engine = engine;
    this.cache = cache;
    this.callbacks = callbacks;
    this.segments = [];
    this.store = new Map();
    this.durations = new Map();
    this.failures = new Map();
    this.generation = 0;
    this.window = null;
    this.role = "none";
    this.mode = "idle";
    this.cursor = { index: 0, fraction: 0 };
    this.waiting = null;
    this.job = null;
    this.token = 0;
    this.playSerial = 0;
    this.switching = false;
    this.pendingSeek = null;
    this.currentUrl = null;
    this.silentUrl = null;
    this.rate = 1;
    this.recoveries = 0;
    this.bindAudioEvents();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => this.pump());
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  load(segments, word = 0) {
    this.halt();
    this.generation += 1;
    this.segments = segments;
    this.store.clear();
    this.durations.clear();
    this.pace = undefined;
    this.failures.clear();
    this.cursor = this.locateWord(word);
    this.setMode("idle", {}, { emit: false });
  }

  // Voice or model identity changed: drop generated audio but keep position.
  invalidate() {
    const cursor = this.currentCursor();
    const wasActive = this.mode === "playing" || this.mode === "buffering";
    this.halt();
    this.generation += 1;
    this.store.clear();
    this.durations.clear();
    this.pace = undefined;
    this.failures.clear();
    this.cursor = cursor;
    if (wasActive) this.startAt(cursor.index, cursor.fraction);
    else if (this.mode !== "idle") this.setMode("paused");
  }

  play() {
    if (!this.segments.length || this.mode === "playing" || this.mode === "buffering") return;
    if (this.mode === "paused" && this.role === "window" && this.window) {
      this.setMode("playing");
      this.playAudio();
      this.pump();
      return;
    }
    const from = this.mode === "ended" ? { index: 0, fraction: 0 } : this.waiting || this.cursor;
    this.startAt(from.index, from.fraction);
  }

  pause() {
    if (this.mode !== "playing" && this.mode !== "buffering") return;
    this.cursor = this.currentCursor();
    this.playSerial += 1;
    this.setMode("paused");
    this.audio.pause();
  }

  stop() {
    this.cursor = this.currentCursor();
    this.halt();
    this.setMode("idle", {}, { emit: false });
  }

  seekToWord(word, { play = this.mode === "playing" || this.mode === "buffering" } = {}) {
    if (!this.segments.length) return;
    const target = this.locateWord(word);
    this.seekTo(target.index, target.fraction, { play });
  }

  skip(seconds) {
    if (!this.segments.length) return;
    const play = this.mode === "playing" || this.mode === "buffering";
    if (this.role === "window" && this.window) {
      const time = this.audio.currentTime + seconds;
      if (time >= 0 && time < this.window.duration - 0.05) {
        this.audio.currentTime = time;
        this.emitPosition();
        return;
      }
    }
    const from = this.currentCursor();
    const target = this.walk(from.index, from.fraction, seconds);
    this.seekTo(target.index, target.fraction, { play });
  }

  setRate(rate) {
    this.rate = rate;
    this.audio.defaultPlaybackRate = rate;
    this.audio.playbackRate = rate;
  }

  positionWord() {
    if (this.mode === "ended") return this.segments.at(-1)?.endWord || 0;
    const { index, fraction } = this.currentCursor();
    const segment = this.segments[index];
    return segment ? segment.startWord + fraction * segment.wordCount : 0;
  }

  currentSegmentIndex() {
    return this.currentCursor().index;
  }

  // The voice's measured pace (including pauses), so the on-screen clock
  // and lock-screen position match the audio rather than a fixed estimate.
  secondsPerWord() {
    if (this.pace === undefined) {
      let seconds = 0;
      let words = 0;
      for (const [index, duration] of this.durations) {
        const segment = this.segments[index];
        if (!segment?.wordCount) continue;
        seconds += duration;
        words += segment.wordCount;
      }
      this.pace = words >= 30 ? seconds / words : null;
    }
    return this.pace;
  }

  bufferedAheadSeconds() {
    const { index } = this.currentCursor();
    let seconds = 0;
    for (let cursor = index; this.store.has(cursor); cursor += 1) seconds += this.durations.get(cursor) || 0;
    return seconds;
  }

  async preview(text) {
    this.halt();
    const token = this.token;
    this.setMode("buffering", { reason: "preview" });
    this.keepAlive();
    try {
      const identity = this.engine.identity();
      const result = await this.engine.synthesize(text, identity);
      if (token !== this.token) return;
      const { buffer } = buildStitchedWav([{ samples: result.samples, pauseSamples: 0 }], result.sampleRate);
      this.setSource(URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })), "clip");
      this.setMode("playing", { reason: "preview" });
      this.playAudio();
    } catch (error) {
      if (token === this.token) this.fail(error);
    }
  }

  // Frees generated audio held in memory (used when the audio cache is cleared).
  dropGeneratedAudio() {
    this.invalidate();
  }

  // ── Positioning ───────────────────────────────────────────────────────

  locateWord(word) {
    const safe = Math.max(0, Number(word) || 0);
    let low = 0;
    let high = Math.max(0, this.segments.length - 1);
    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      if (this.segments[mid].startWord <= safe) low = mid;
      else high = mid - 1;
    }
    const segment = this.segments[low];
    if (!segment) return { index: 0, fraction: 0 };
    return {
      index: low,
      fraction: Math.min(0.999, Math.max(0, (safe - segment.startWord) / Math.max(1, segment.wordCount))),
    };
  }

  currentCursor() {
    if (this.role === "window" && this.window) {
      const time = this.pendingSeek ?? this.audio.currentTime;
      return windowLocate(this.window, time);
    }
    return { ...(this.waiting || this.cursor) };
  }

  segmentSeconds(index) {
    if (this.durations.has(index)) return this.durations.get(index);
    const segment = this.segments[index];
    if (!segment) return 0;
    return segment.wordCount / ESTIMATED_WORDS_PER_SECOND + (segment.pauseAfterMs || 0) / 1000;
  }

  // Move through the timeline by media seconds, using real durations where
  // audio exists and a speaking-rate estimate elsewhere.
  walk(index, fraction, seconds) {
    let cursor = index;
    let time = this.segmentSeconds(cursor) * fraction + seconds;
    while (time < 0 && cursor > 0) {
      cursor -= 1;
      time += this.segmentSeconds(cursor);
    }
    if (time < 0) return { index: 0, fraction: 0 };
    while (cursor < this.segments.length - 1 && time >= this.segmentSeconds(cursor)) {
      time -= this.segmentSeconds(cursor);
      cursor += 1;
    }
    const length = Math.max(0.1, this.segmentSeconds(cursor));
    return { index: cursor, fraction: Math.min(0.999, time / length) };
  }

  seekTo(index, fraction, { play }) {
    if (this.window && this.role === "window" && index >= this.window.start && index < this.window.end) {
      this.cursor = { index, fraction };
      this.audio.currentTime = windowTime(this.window, index, fraction);
      if (play && this.mode === "paused") this.play();
      this.emitPosition();
      this.pump();
      return;
    }
    if (play) {
      this.startAt(index, fraction);
      return;
    }
    this.halt();
    this.cursor = { index, fraction };
    if (this.mode === "ended") this.setMode("paused");
    this.emitPosition();
    this.pump();
  }

  // ── Playback ──────────────────────────────────────────────────────────

  startAt(index, fraction = 0) {
    this.halt();
    this.cursor = { index, fraction };
    this.recoveries = 0;
    if (this.hasStartBuffer(index, fraction)) {
      this.playWindowFrom(index, fraction);
      return;
    }
    this.waitFor(index, fraction);
  }

  hasStartBuffer(index, fraction = 0) {
    if (!this.store.has(index)) return false;
    let ready = -(this.durations.get(index) || 0) * fraction;
    let cursor = index;
    while (cursor < this.segments.length && this.store.has(cursor)) {
      ready += this.durations.get(cursor) || 0;
      if (ready >= START_BUFFER_SECONDS) return true;
      cursor += 1;
    }
    return cursor >= this.segments.length;
  }

  waitFor(index, fraction) {
    this.waiting = { index, fraction };
    this.cursor = { index, fraction };
    this.setMode("buffering", { reason: "generating", index });
    // Called synchronously from a tap on first play, so this also satisfies
    // iOS's user-gesture requirement for later programmatic play() calls.
    this.keepAlive();
    this.pump();
  }

  playWindowFrom(index, fraction) {
    const win = this.buildWindow(index);
    this.waiting = null;
    this.window = win;
    this.setSource(win.url, "window");
    const seek = windowTime(win, index, fraction);
    this.pendingSeek = seek > 0.02 ? seek : null;
    if (this.pendingSeek !== null) this.trySeek();
    this.setMode("playing");
    this.playAudio();
    this.evict();
    this.pump();
  }

  buildWindow(start) {
    // Skipped passages are plain silence and take the rate of the audio
    // around them; the first real audio in the run sets the window's rate.
    let sampleRate = 0;
    for (let index = start; !sampleRate && this.store.has(index); index += 1) sampleRate = this.store.get(index).sampleRate;
    sampleRate ||= 24_000;
    const parts = [];
    let seconds = 0;
    let end = start;
    while (
      end < this.segments.length &&
      this.store.has(end) &&
      (!this.store.get(end).sampleRate || this.store.get(end).sampleRate === sampleRate) &&
      parts.length < MAX_WINDOW_SEGMENTS &&
      (parts.length === 0 || seconds < MAX_WINDOW_SECONDS)
    ) {
      const entry = this.store.get(end);
      const samples = entry.samples || new Int16Array(Math.round(entry.silenceSeconds * sampleRate));
      const pauseSamples = ((this.segments[end].pauseAfterMs || 0) / 1000) * sampleRate;
      parts.push({ samples, pauseSamples });
      seconds += (samples.length + pauseSamples) / sampleRate;
      end += 1;
    }
    const contentSamples = parts.reduce((sum, part) => sum + part.samples.length + Math.round(part.pauseSamples), 0);
    parts.push({ samples: new Int16Array(0), pauseSamples: HANDOFF_PAD_SECONDS * sampleRate });
    const { buffer, offsets, speech } = buildStitchedWav(parts, sampleRate);
    offsets.pop();
    speech.pop();
    const last = offsets.length - 1;
    const lastPause = (contentSamples - offsets[last] - speech[last]) / sampleRate;
    return {
      start,
      end,
      offsets,
      speech,
      sampleRate,
      duration: contentSamples / sampleRate,
      handoffAt: (offsets[last] + speech[last]) / sampleRate + Math.max(0, lastPause - HANDOFF_LEAD_SECONDS),
      url: URL.createObjectURL(new Blob([buffer], { type: "audio/wav" })),
    };
  }

  advance() {
    const next = this.window ? this.window.end : this.cursor.index + 1;
    this.window = null;
    this.cursor = { index: next, fraction: 0 };
    if (next >= this.segments.length) {
      this.finish();
      return;
    }
    if (this.hasStartBuffer(next)) {
      this.playWindowFrom(next, 0);
      return;
    }
    this.waitFor(next, 0);
  }

  finish() {
    this.halt();
    this.cursor = { index: Math.max(0, this.segments.length - 1), fraction: 1 };
    this.setMode("ended");
    this.callbacks.onEnded?.();
  }

  fail(error) {
    this.cursor = this.currentCursor();
    this.halt();
    this.setMode("error", { error });
    this.callbacks.onError?.(error);
  }

  // Stop audio output and forget the current window, keeping stored audio
  // and the listener's position.
  halt() {
    if (this.role === "window" && this.window) this.cursor = this.currentCursor();
    this.token += 1;
    this.playSerial += 1;
    this.waiting = null;
    this.window = null;
    this.pendingSeek = null;
    this.role = "none";
    this.switching = true;
    this.audio.pause();
    this.audio.loop = false;
    this.switching = false;
  }

  keepAlive() {
    if (!this.silentUrl) {
      this.silentUrl = URL.createObjectURL(new Blob([silentWav(1)], { type: "audio/wav" }));
    }
    if (this.role === "silence" && !this.audio.paused) return;
    this.setSource(this.silentUrl, "silence", { loop: true });
    this.playAudio();
  }

  setSource(url, role, { loop = false } = {}) {
    this.switching = true;
    this.role = role;
    const previous = this.currentUrl;
    this.audio.loop = loop;
    this.audio.muted = false;
    this.audio.src = url;
    this.currentUrl = url;
    this.audio.defaultPlaybackRate = this.rate;
    this.audio.playbackRate = this.rate;
    if (previous && previous !== url && previous !== this.silentUrl) URL.revokeObjectURL(previous);
  }

  playAudio() {
    const serial = ++this.playSerial;
    this.switching = true;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled || serial !== this.playSerial) return;
      this.switching = false;
      const error = new Error("The browser took too long to start the generated audio.");
      error.name = "TimeoutError";
      this.recover(error);
    }, PLAY_TIMEOUT_MS);
    let promise;
    try {
      promise = this.audio.play();
    } catch (error) {
      promise = Promise.reject(error);
    }
    Promise.resolve(promise).then(() => {
      settled = true;
      clearTimeout(timer);
      if (serial !== this.playSerial) return;
      this.switching = false;
      if (this.role === "window") this.recoveries = 0;
    }, (error) => {
      settled = true;
      clearTimeout(timer);
      if (serial !== this.playSerial) return;
      this.switching = false;
      if (error?.name === "AbortError") return;
      if (error?.name === "NotAllowedError") {
        this.cursor = this.currentCursor();
        this.halt();
        this.setMode("paused");
        this.callbacks.onError?.(error);
        return;
      }
      this.recover(error);
    });
  }

  // Rebuild the window at the current position once before giving up.
  recover(error) {
    if (this.role !== "window" || this.recoveries >= 1) {
      this.fail(error);
      return;
    }
    this.recoveries += 1;
    const cursor = this.currentCursor();
    console.warn("[Hear TTS] restarting playback window", error);
    this.halt();
    if (this.store.has(cursor.index)) this.playWindowFrom(cursor.index, cursor.fraction);
    else this.waitFor(cursor.index, cursor.fraction);
  }

  trySeek() {
    if (this.pendingSeek === null || this.audio.readyState < 1) return;
    try {
      this.audio.currentTime = this.pendingSeek;
      this.pendingSeek = null;
    } catch {}
  }

  setMode(mode, detail = {}, { emit = true } = {}) {
    this.mode = mode;
    if (emit) this.callbacks.onState?.(mode, detail);
  }

  emitPosition() {
    this.callbacks.onPosition?.(this.positionWord());
  }

  bindAudioEvents() {
    const audio = this.audio;
    audio.addEventListener("loadedmetadata", () => {
      audio.defaultPlaybackRate = this.rate;
      audio.playbackRate = this.rate;
      this.trySeek();
    });
    audio.addEventListener("timeupdate", () => {
      if (this.role !== "window" || this.mode !== "playing" || !this.window) return;
      if (this.pendingSeek === null && audio.currentTime >= this.window.handoffAt) {
        this.advance();
        return;
      }
      this.emitPosition();
    });
    audio.addEventListener("ended", () => {
      if (this.role === "window") this.advance();
      else if (this.role === "clip") {
        this.halt();
        this.setMode("paused");
      }
    });
    audio.addEventListener("pause", () => {
      // Pauses we did not ask for: a phone call, headphones removed, or the
      // OS media controls acting on the element directly.
      if (this.switching || !audio.paused || audio.ended) return;
      if (this.mode !== "playing" || (this.role !== "window" && this.role !== "clip")) return;
      this.cursor = this.currentCursor();
      this.setMode("paused");
    });
    audio.addEventListener("play", () => {
      if (this.switching || this.mode !== "paused" || this.role !== "window") return;
      this.setMode("playing");
      this.pump();
    });
    audio.addEventListener("error", () => {
      if (this.switching || this.role !== "window") return;
      this.recover(audio.error || new Error("Audio playback stopped."));
    });
  }

  // ── Generation ────────────────────────────────────────────────────────

  lookaheadTarget() {
    if (this.mode === "playing" || this.mode === "buffering") return LOOKAHEAD_SECONDS;
    // Paused prefetch only uses an engine that is already running; it must
    // never be the thing that starts a model download.
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    if (this.mode === "paused" && visible && this.engine.ready?.() !== false) return PAUSED_LOOKAHEAD_SECONDS;
    return 0;
  }

  pump() {
    if (this.job || !this.segments.length) return;
    const target = this.lookaheadTarget();
    if (target <= 0) return;
    const from = this.waiting?.index ?? this.currentCursor().index;
    let ahead = 0;
    for (let index = from; index < this.segments.length; index += 1) {
      if (!this.store.has(index)) {
        this.fetch(index);
        return;
      }
      ahead += this.durations.get(index) || 0;
      if (ahead >= target) return;
    }
  }

  fetch(index) {
    const generation = this.generation;
    const segment = this.segments[index];
    const job = { index, generation };
    this.job = job;
    (async () => {
      const identity = this.engine.identity();
      const key = await this.cache.key(segment.text, identity);
      const cached = await this.cache.get(key).catch(() => null);
      if (cached) {
        try {
          return decodeWav(cached);
        } catch (error) {
          console.warn("[Hear TTS] regenerating an unreadable cached passage", error);
        }
      }
      const result = await this.engine.synthesize(segment.text, identity);
      const actual = result.identity || identity;
      const storeKey = actual === identity ? key : await this.cache.key(segment.text, actual);
      this.cache.put(storeKey, encodeWav(result.samples, result.sampleRate), result.samples.length / result.sampleRate)
        .catch((error) => console.warn("[Hear TTS] could not persist generated audio", error));
      return result;
    })().then((entry) => {
      if (this.job === job) this.job = null;
      if (generation !== this.generation) {
        this.pump();
        return;
      }
      this.remember(index, entry);
      this.failures.delete(index);
      this.resumeIfWaiting();
      this.pump();
    }, (error) => {
      if (this.job === job) this.job = null;
      if (generation !== this.generation) {
        this.pump();
        return;
      }
      // The engine was restarted on purpose (cancel, model change); the next
      // play() asks for this sentence again.
      if (error?.name === "BackendRestartError") return;
      if (error?.fatal) {
        // The engine itself is unavailable; the next play() starts it again.
        if (this.waiting || this.mode === "playing") this.fail(error);
        return;
      }
      const attempts = (this.failures.get(index) || 0) + 1;
      this.failures.set(index, attempts);
      if (attempts >= 2) {
        // One bad sentence should not end the listening session.
        console.warn("[Hear TTS] skipping a passage that could not be voiced", error);
        this.remember(index, { samples: null, sampleRate: 0, silenceSeconds: SKIPPED_SEGMENT_SECONDS });
        this.callbacks.onSkipped?.(index, error);
        this.resumeIfWaiting();
      }
      this.pump();
    });
  }

  resumeIfWaiting() {
    if (!this.waiting || this.mode !== "buffering") return;
    const { index, fraction } = this.waiting;
    if (this.hasStartBuffer(index, fraction)) this.playWindowFrom(index, fraction);
  }

  remember(index, entry) {
    this.store.set(index, { samples: entry.samples, sampleRate: entry.sampleRate, silenceSeconds: entry.silenceSeconds });
    const pause = (this.segments[index]?.pauseAfterMs || 0) / 1000;
    const speech = entry.samples ? entry.samples.length / entry.sampleRate : entry.silenceSeconds;
    this.durations.set(index, speech + pause);
    this.pace = undefined;
    this.evict();
  }

  evict() {
    const current = this.currentCursor().index;
    const keys = [...this.store.keys()].sort((left, right) => left - right);
    let ahead = 0;
    for (const index of keys) {
      if (index < current - KEEP_BEHIND_SEGMENTS) {
        this.store.delete(index);
        continue;
      }
      if (index >= current) {
        ahead += this.durations.get(index) || 0;
        if (ahead > LOOKAHEAD_SECONDS * 2) this.store.delete(index);
      }
    }
    if (this.store.size > MAX_STORED_SEGMENTS) {
      const farthest = [...this.store.keys()].sort((left, right) => Math.abs(right - current) - Math.abs(left - current));
      farthest.slice(0, this.store.size - MAX_STORED_SEGMENTS).forEach((index) => this.store.delete(index));
    }
  }
}
