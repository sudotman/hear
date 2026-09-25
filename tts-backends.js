import { KITTEN_DEFAULT_MODEL, KITTEN_DTYPES, KITTEN_MODELS, KOKORO_DTYPES, KOKORO_MODEL } from "./app-config.js";

const WORKER_INIT_TIMEOUT_MS = 180_000;
const GENERATION_TIMEOUT_MS = 120_000;
const BENCHMARK_TEXT = "A clear voice makes every good sentence easier to follow.";

/**
 * @typedef {Object} SpeechResult
 * @property {Int16Array} samples
 * @property {number} sampleRate
 * @property {number} duration
 * @property {Object} metrics
 */

class WorkerTtsBackend {
  constructor(config, callbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
    this.worker = null;
    this.loadPromise = null;
    this.requests = new Map();
    this.requestId = 0;
  }

  get id() {
    return this.config.id;
  }

  get cacheIdentity() {
    return {
      model: `${this.config.model}@${this.config.version}`,
      dtype: this.config.dtype,
    };
  }

  async load() {
    if (this.worker && this.loadPromise) return this.loadPromise;
    this.worker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
    this.loadPromise = new Promise((resolve, reject) => {
      // dispose() during a download must settle this promise, or callers
      // awaiting the engine would wait forever.
      this.rejectLoad = reject;
      const timer = window.setTimeout(() => {
        const error = new Error(`${this.config.label} took too long to load.`);
        error.name = "TimeoutError";
        error.fatal = true;
        reject(error);
        this.dispose();
      }, WORKER_INIT_TIMEOUT_MS);

      this.worker.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "progress") {
          this.callbacks.onProgress?.({ ...message, backend: this.id });
          return;
        }
        if (message.type === "ready") {
          window.clearTimeout(timer);
          this.rejectLoad = null;
          this.callbacks.onReady?.(message);
          resolve();
          return;
        }
        if (message.type === "generating") {
          this.callbacks.onGenerating?.(message);
          return;
        }
        if (message.type === "audio" || message.type === "generation-error") {
          this.finishRequest(message);
          return;
        }
        if (message.type === "metric") this.callbacks.onMetric?.(message.metric);
        if (message.type === "fatal") {
          window.clearTimeout(timer);
          const error = new Error(message.message || `${this.config.label} stopped unexpectedly.`);
          error.fatal = true;
          reject(error);
          this.rejectAll(error);
          this.callbacks.onFatal?.(error);
        }
      });

      this.worker.addEventListener("error", (event) => {
        window.clearTimeout(timer);
        const error = new Error(event.message || `${this.config.label} stopped unexpectedly.`);
        error.fatal = true;
        reject(error);
        this.rejectAll(error);
        this.callbacks.onFatal?.(error);
      });

      this.worker.postMessage({ type: "init", backend: this.config });
    });
    return this.loadPromise;
  }

  finishRequest(message) {
    const request = this.requests.get(message.id);
    if (!request) return;
    this.requests.delete(message.id);
    window.clearTimeout(request.timer);
    if (message.type === "generation-error") {
      request.reject(new Error(message.message || "This passage could not be generated."));
      return;
    }
    request.resolve({
      samples: message.samples,
      sampleRate: message.sampleRate,
      duration: message.duration,
      metrics: message.metrics,
    });
  }

  async synthesize(text, { voice = this.config.defaultVoice, speed = 1 } = {}) {
    await this.load();
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!this.requests.has(id)) return;
        this.requests.delete(id);
        const error = new Error(`${this.config.label} took too long to generate this passage.`);
        error.name = "TimeoutError";
        reject(error);
      }, GENERATION_TIMEOUT_MS);
      this.requests.set(id, { resolve, reject, timer });
      this.worker.postMessage({ type: "generate", id, text, voice, speed });
    });
  }

  prefetchVoice(voice) {
    if (!voice || !this.worker || !this.id.startsWith("kokoro-")) return;
    this.worker.postMessage({ type: "prefetch-voice", voice });
  }

  async benchmark() {
    const result = await this.synthesize(BENCHMARK_TEXT);
    return result.metrics.rtf;
  }

  rejectAll(error) {
    for (const request of this.requests.values()) {
      window.clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
  }

  async dispose() {
    const error = new Error(`${this.config.label} was restarted.`);
    error.name = "BackendRestartError";
    this.rejectAll(error);
    this.rejectLoad?.(error);
    this.rejectLoad = null;
    this.worker?.postMessage({ type: "dispose" });
    this.worker?.terminate();
    this.worker = null;
    this.loadPromise = null;
  }
}

export const KOKORO_DTYPE_OPTIONS = KOKORO_DTYPES;
export const KITTEN_DTYPE_OPTIONS = KITTEN_DTYPES;
export const KITTEN_MODEL_OPTIONS = KITTEN_MODELS;

function kokoroLabel(device, dtype) {
  return `Kokoro ${device === "webgpu" ? "WebGPU" : "WASM"} ${dtype}`;
}

export class KokoroWebGPU extends WorkerTtsBackend {
  constructor(callbacks, opts = {}) {
    const dtype = "fp32";
    const model = opts.model || KOKORO_MODEL;
    super({
      id: "kokoro-webgpu",
      label: kokoroLabel("webgpu", dtype),
      model,
      version: "1.0",
      device: "webgpu",
      dtype,
      defaultVoice: opts.voice || "af_heart",
    }, callbacks);
  }
}

export class KokoroWasm extends WorkerTtsBackend {
  constructor(callbacks, opts = {}) {
    const dtype = KOKORO_DTYPE_OPTIONS.includes(opts.dtype) ? opts.dtype : "q8";
    const model = opts.model || KOKORO_MODEL;
    super({
      id: "kokoro-wasm",
      label: kokoroLabel("wasm", dtype),
      model,
      version: "1.0",
      device: "wasm",
      dtype,
      defaultVoice: opts.voice || "af_heart",
    }, callbacks);
  }
}

export class KittenWasm extends WorkerTtsBackend {
  constructor(callbacks, opts = {}) {
    const dtype = KITTEN_DTYPE_OPTIONS.includes(opts.dtype) ? opts.dtype : "fp32";
    const model = KITTEN_MODEL_OPTIONS.includes(opts.model) ? opts.model : KITTEN_DEFAULT_MODEL;
    const short = model.split("/").pop();
    super({
      id: "kitten-wasm",
      label: `Kitten ${short} ${dtype}`,
      model,
      version: model.includes("0.1") ? "0.1" : model.includes("int8") ? "0.8-int8" : "0.8",
      device: "wasm",
      dtype,
      defaultVoice: "Bella",
    }, callbacks);
  }
}
