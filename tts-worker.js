let tts = null;
let initialization = null;
let generationQueue = Promise.resolve();

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

async function initialize() {
  if (tts) return tts;
  if (initialization) return initialization;

  initialization = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    const gpuAdapter = await globalThis.navigator?.gpu?.requestAdapter().catch(() => null);
    const dtype = gpuAdapter ? "fp16" : "q8";
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

    const options = {
      dtype,
      device: gpuAdapter ? "webgpu" : "wasm",
      progress_callback,
    };

    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, options);
    } catch (error) {
      if (!gpuAdapter) throw error;
      self.postMessage({ type: "progress", status: "fallback", file: "", progress: null });
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device: "wasm",
        progress_callback,
      });
    }
    self.postMessage({ type: "ready" });
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
    initialize();
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
