import { installReadableStreamAsyncIterator } from "./stream-compat.js";
import { floatToInt16, trimSilence } from "./neural-audio.js";

// This must run before importing either neural runtime. Older WebKit supports
// ReadableStream but not its async iterator; phonemizer initializes an async
// stream at module evaluation time and otherwise rejects before synthesis.
installReadableStreamAsyncIterator();

let runtime = null;
let initialization = null;
let backend = null;
let processing = false;
const queue = [];
const downloadProgress = new Map();
const kokoroVoicePrefetches = new Map();

async function downloadKokoroVoice(model, voice) {
  if (!voice || typeof caches === "undefined") return;
  const url = `https://huggingface.co/${model}/resolve/main/voices/${voice}.bin`;
  const file = `voices/${voice}.bin`;
  let cache;
  try {
    cache = await caches.open("kokoro-voices");
  } catch {
    return;
  }
  const cached = await cache.match(url);
  if (cached) {
    const size = Number(cached.headers.get("content-length")) || 0;
    postProgress({ status: "cached", file, loaded: size, total: size, progress: 100, cached: true });
    return;
  }
  postProgress({ status: "progress", file, loaded: 0, total: 0, progress: 0 });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Kokoro voice ${voice} (${response.status}).`);
  const buffer = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  if (!headers.has("content-length")) headers.set("content-length", String(buffer.byteLength));
  await cache.put(url, new Response(buffer, { headers })).catch(() => {});
  postProgress({ status: "progress", file, loaded: buffer.byteLength, total: buffer.byteLength, progress: 100 });
}

function prefetchKokoroVoice(model, voice) {
  const key = `${model}:${voice}`;
  if (kokoroVoicePrefetches.has(key)) return kokoroVoicePrefetches.get(key);
  const pending = downloadKokoroVoice(model, voice).finally(() => {
    if (kokoroVoicePrefetches.get(key) === pending) kokoroVoicePrefetches.delete(key);
  });
  kokoroVoicePrefetches.set(key, pending);
  return pending;
}

function postProgress(progress) {
  const fileProgress = Number.isFinite(progress.progress)
    ? progress.progress
    : progress.total > 0
      ? (progress.loaded / progress.total) * 100
      : null;
  let value = fileProgress;
  if (progress.file && (progress.status === "progress" || progress.status === "cached")) {
    downloadProgress.set(progress.file, {
      loaded: Number(progress.loaded) || 0,
      total: Number(progress.total) || 0,
      progress: fileProgress,
    });
    const entries = [...downloadProgress.values()];
    const total = entries.reduce((sum, entry) => sum + entry.total, 0);
    const loaded = entries.reduce((sum, entry) => sum + Math.min(entry.loaded, entry.total || entry.loaded), 0);
    const finite = entries.map((entry) => entry.progress).filter(Number.isFinite);
    value = total > 0 && entries.every((entry) => entry.total > 0)
      ? (loaded / total) * 100
      : finite.length === entries.length
        ? finite.reduce((sum, entry) => sum + entry, 0) / finite.length
        : null;
  }
  self.postMessage({
    type: "progress",
    status: progress.status,
    file: progress.file || "",
    progress: value,
    fileProgress,
    loaded: Number(progress.loaded) || 0,
    total: Number(progress.total) || 0,
    cached: !!progress.cached,
  });
}

async function initialize(config = backend) {
  if (runtime) return runtime;
  if (initialization) return initialization;
  backend = config;
  initialization = (async () => {
    postProgress({ status: "starting", file: "", progress: null });
    if (backend.id === "kitten-wasm") {
      const { KittenRuntime } = await import("./kitten-runtime.js");
      runtime = new KittenRuntime({ onProgress: postProgress, model: backend.model, dtype: backend.dtype });
      await runtime.load();
    } else if (backend.id === "kokoro-wasm") {
      // Plain WASM build: transformers.js' JSEP build is unstable on iOS 26.
      const { KokoroRuntime } = await import("./kokoro-runtime.js");
      runtime = new KokoroRuntime({ onProgress: postProgress, model: backend.model, dtype: backend.dtype });
      await Promise.all([
        runtime.load(),
        runtime.voice(backend.defaultVoice).catch((error) => console.warn("[Hear TTS] could not prefetch Kokoro voice", error)),
      ]);
    } else {
      // WebGPU needs transformers.js' WebGPU-enabled ONNX Runtime.
      const { KokoroTTS } = await import("kokoro-js");
      const runtimePromise = KokoroTTS.from_pretrained(backend.model, {
        dtype: backend.dtype,
        device: backend.device,
        progress_callback: postProgress,
      });
      const voicePromise = prefetchKokoroVoice(backend.model, backend.defaultVoice).catch((error) => {
        console.warn("[Hear TTS] could not prefetch Kokoro voice", error);
      });
      const [loadedRuntime] = await Promise.all([runtimePromise, voicePromise]);
      runtime = loadedRuntime;
    }
    self.postMessage({
      type: "ready",
      backend: backend.id,
      model: backend.model,
      dtype: backend.dtype,
      device: backend.device,
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
      cores: self.navigator?.hardwareConcurrency || null,
    });
    return runtime;
  })().catch((error) => {
    initialization = null;
    self.postMessage({ type: "fatal", message: error.message || `${backend?.label || "TTS"} could not be loaded.` });
    throw error;
  });
  return initialization;
}

async function generate(job) {
  const startedAt = performance.now();
  const postStage = (stage) => self.postMessage({ type: "generating", id: job.id, backend: backend.id, stage });
  const baseMetrics = {
    backend: backend.id,
    model: backend.model,
    dtype: backend.dtype,
    textLength: job.text.length,
    queueWaitSeconds: (startedAt - job.enqueuedAt) / 1000,
  };
  try {
    const model = await initialize();
    let audio;
    let sampleRate;
    if (backend.id === "kitten-wasm" || backend.id === "kokoro-wasm") {
      const output = await model.generate(job.text, { voice: job.voice, speed: job.speed, onStage: postStage });
      audio = output.audio;
      sampleRate = output.samplingRate;
    } else {
      postStage("synthesize");
      await prefetchKokoroVoice(backend.model, job.voice);
      const output = await model.generate(job.text, { voice: job.voice, speed: job.speed });
      audio = output.audio;
      sampleRate = output.sampling_rate;
    }
    postStage("encoding");
    const samples = floatToInt16(trimSilence(audio, sampleRate));
    if (!samples.length) throw new Error("The voice produced no audible speech for this passage.");
    const duration = samples.length / sampleRate;
    const generationSeconds = (performance.now() - startedAt) / 1000;
    const metrics = {
      ...baseMetrics,
      generationSeconds,
      audioDurationSeconds: duration,
      rtf: duration > 0 ? generationSeconds / duration : Infinity,
      failure: null,
      timestamp: new Date().toISOString(),
    };
    self.postMessage({ type: "metric", metric: metrics });
    self.postMessage({ type: "audio", id: job.id, samples, sampleRate, duration, metrics }, [samples.buffer]);
  } catch (error) {
    const metrics = {
      ...baseMetrics,
      generationSeconds: (performance.now() - startedAt) / 1000,
      audioDurationSeconds: 0,
      rtf: Infinity,
      failure: error.message || "Generation failed",
      timestamp: new Date().toISOString(),
    };
    self.postMessage({ type: "metric", metric: metrics });
    self.postMessage({ type: "generation-error", id: job.id, message: metrics.failure });
  }
}

// The page sends one sentence at a time and keeps the scheduling itself, so
// this is a plain FIFO (a voice preview may briefly queue behind a sentence).
async function drainQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) await generate(queue.shift());
  } finally {
    processing = false;
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    backend = message.backend;
    initialize(message.backend).catch(() => {});
    return;
  }
  if (message.type === "prefetch-voice") {
    if (backend?.id === "kokoro-wasm" && runtime?.voice) {
      runtime.voice(message.voice).catch((error) => console.warn("[Hear TTS] could not prefetch Kokoro voice", error));
    } else if (backend?.id?.startsWith("kokoro-")) {
      prefetchKokoroVoice(backend.model, message.voice).catch((error) => {
        console.warn("[Hear TTS] could not prefetch Kokoro voice", error);
      });
    }
    return;
  }
  if (message.type === "generate") {
    queue.push({ ...message, enqueuedAt: performance.now() });
    drainQueue().catch((error) => {
      self.postMessage({ type: "fatal", message: error.message || "The local voice worker stopped unexpectedly." });
    });
    return;
  }
  if (message.type === "dispose") {
    queue.length = 0;
    runtime?.dispose?.();
    runtime = null;
    initialization = null;
    close();
  }
});
