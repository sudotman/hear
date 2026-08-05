let tts = null;
let initialization = null;
let generationQueue = Promise.resolve();

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_OPTIONS = { dtype: "q8", device: "wasm" };

async function initialize() {
  if (tts) return tts;
  if (initialization) return initialization;

  initialization = (async () => {
    self.postMessage({ type: "progress", status: "starting", file: "", progress: null });
    const { KokoroTTS } = await import("kokoro-js");
    const progress_callback = (progress) => {
      const value = Number.isFinite(progress.progress)
        ? progress.progress
        : progress.total > 0
          ? (progress.loaded / progress.total) * 100
          : null;
      self.postMessage({
        type: "progress",
        status: progress.status,
        file: progress.file || "",
        progress: value,
      });
    };

    // Safari can expose WebGPU even when its mobile memory/runtime limits make a
    // large fp16 model unreliable. q8/WASM is smaller, broadly supported, and
    // still runs entirely off the main thread.
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      ...MODEL_OPTIONS,
      progress_callback,
    });
    self.postMessage({ type: "ready", model: MODEL_ID, ...MODEL_OPTIONS });
    return tts;
  })().catch((error) => {
    initialization = null;
    self.postMessage({ type: "fatal", message: error.message || "The natural voice could not be loaded." });
    throw error;
  });

  return initialization;
}

async function generate({ id, text, voice }) {
  const model = await initialize();
  self.postMessage({ type: "generating", id });
  const audio = await model.generate(text, { voice, speed: 1 });
  const buffer = audio.toWav();
  self.postMessage(
    {
      type: "audio",
      id,
      buffer,
      duration: audio.audio.length / audio.sampling_rate,
    },
    [buffer],
  );
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    initialize().catch(() => {});
    return;
  }

  if (message.type === "generate") {
    generationQueue = generationQueue
      .then(() => generate(message))
      .catch((error) => {
        self.postMessage({
          type: "generation-error",
          id: message.id,
          message: error.message || "This passage could not be spoken.",
        });
      });
  }
});
