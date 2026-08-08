import { installReadableStreamAsyncIterator } from "./stream-compat.js";

// This must run before importing either neural runtime. Older WebKit supports
// ReadableStream but not its async iterator; phonemizer initializes an async
// stream at module evaluation time and otherwise rejects before synthesis.
installReadableStreamAsyncIterator();

let runtime = null;
let initialization = null;
let backend = null;
let activeEpoch = 0;
let processing = false;
const queue = [];
const downloadProgress = new Map();

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
    cached: !!progress.cached,
  });
}

function encodeWav(samples, sampleRate) {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
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
    } else {
      const { KokoroTTS } = await import("kokoro-js");
      runtime = await KokoroTTS.from_pretrained(backend.model, {
        dtype: backend.dtype,
        device: backend.device,
        progress_callback: postProgress,
      });
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
  const queueWaitSeconds = (startedAt - job.enqueuedAt) / 1000;
  const postStage = (stage) => self.postMessage({
    type: "generating",
    id: job.id,
    epoch: job.epoch,
    priority: job.priority,
    segmentKey: job.segmentKey,
    backend: backend.id,
    stage,
  });
  try {
    const model = await initialize();
    if (job.epoch !== activeEpoch) return;
    let buffer;
    let duration;
    if (backend.id === "kitten-wasm") {
      const output = await model.generate(job.text, { voice: job.voice, speed: job.speed, onStage: postStage });
      duration = output.audio.length / output.samplingRate;
      postStage("encoding");
      buffer = encodeWav(output.audio, output.samplingRate);
    } else {
      postStage("synthesize");
      const output = await model.generate(job.text, { voice: job.voice, speed: job.speed });
      duration = output.audio.length / output.sampling_rate;
      postStage("encoding");
      buffer = output.toWav();
    }
    const generationSeconds = (performance.now() - startedAt) / 1000;
    const metrics = {
      backend: backend.id,
      model: backend.model,
      dtype: backend.dtype,
      textLength: job.text.length,
      queueWaitSeconds,
      generationSeconds,
      audioDurationSeconds: duration,
      rtf: duration > 0 ? generationSeconds / duration : Infinity,
      failure: null,
      timestamp: new Date().toISOString(),
    };
    self.postMessage({ type: "metric", metric: metrics });
    if (job.epoch !== activeEpoch) return;
    self.postMessage({ type: "audio", id: job.id, epoch: job.epoch, buffer, duration, metrics }, [buffer]);
  } catch (error) {
    const generationSeconds = (performance.now() - startedAt) / 1000;
    const metrics = {
      backend: backend.id,
      model: backend.model,
      dtype: backend.dtype,
      textLength: job.text.length,
      queueWaitSeconds,
      generationSeconds,
      audioDurationSeconds: 0,
      rtf: Infinity,
      failure: error.message || "Generation failed",
      timestamp: new Date().toISOString(),
    };
    self.postMessage({ type: "metric", metric: metrics });
    if (job.epoch === activeEpoch) {
      self.postMessage({ type: "generation-error", id: job.id, epoch: job.epoch, message: metrics.failure });
    }
  }
}

async function drainQueue() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length) {
      queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      const job = queue.shift();
      if (job.epoch !== activeEpoch) continue;
      await generate(job);
    }
  } finally {
    processing = false;
  }
}

let sequence = 0;
self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    backend = message.backend;
    initialize(message.backend).catch(() => {});
    return;
  }
  if (message.type === "epoch") {
    activeEpoch = message.epoch;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].epoch !== activeEpoch) queue.splice(index, 1);
    }
    return;
  }
  if (message.type === "generate") {
    queue.push({ ...message, priority: message.priority ?? 2, enqueuedAt: performance.now(), sequence: sequence++ });
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
