export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KITTEN_DEFAULT_MODEL = "onnx-community/KittenTTS-Nano-v0.8-ONNX";

// Measured on the plain WASM build: q8's int8 convolutions are the slow part.
// uint8f16 keeps 8-bit matmul weights but leaves convolutions unquantised,
// so it runs about as fast as fp32 (≈2× q8 with four threads) at a third of
// the download, for ≈190 MB more memory. Phones default to q8 (memory is
// what gets tabs killed); computers default to uint8f16. Retired choices
// (fp16, q4, q4f16, uint8, q8f16) migrate to the device default.
export const KOKORO_DTYPES = ["q8", "uint8f16", "fp32"];
export const KOKORO_MODEL_FILES = Object.freeze({
  q8: "onnx/model_quantized.onnx",
  uint8f16: "onnx/model_uint8f16.onnx",
  fp32: "onnx/model.onnx",
});
export const KITTEN_DTYPES = ["fp32"];
export const KITTEN_MODELS = [
  KITTEN_DEFAULT_MODEL,
  "KittenML/kitten-tts-micro-0.8",
  "KittenML/kitten-tts-mini-0.8",
];
export const KITTEN_VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"];

// First-play download: model weights and voices from Hugging Face plus the
// on-device speech runtime (ONNX Runtime WASM + espeak-ng) Hear serves itself.
const RUNTIME_MB = 14;
const KOKORO_VOICE_MB = 0.5;
const KOKORO_WEIGHTS_MB = { q8: 92, uint8f16: 114, fp32: 326 };
// WebGPU additionally loads transformers.js and its WebGPU runtime.
const KOKORO_WEBGPU_EXTRA_MB = 23;
const KITTEN_WEIGHTS_MB = {
  "KittenML/kitten-tts-micro-0.8": 41,
  [KITTEN_DEFAULT_MODEL]: 57,
  "KittenML/kitten-tts-mini-0.8": 78,
};
const KITTEN_VOICES_MB = 3.3;

function kokoroSize(dtype, device = "wasm") {
  const weights = KOKORO_WEIGHTS_MB[device === "webgpu" ? "fp32" : dtype] || KOKORO_WEIGHTS_MB.q8;
  return Math.round(weights + KOKORO_VOICE_MB + RUNTIME_MB + (device === "webgpu" ? KOKORO_WEBGPU_EXTRA_MB : 0));
}

function kittenSize(model) {
  return Math.round((KITTEN_WEIGHTS_MB[model] || KITTEN_WEIGHTS_MB[KITTEN_DEFAULT_MODEL]) + KITTEN_VOICES_MB + RUNTIME_MB);
}

export const SPEECH_ENGINES = Object.freeze([
  {
    id: "system",
    name: "System voice",
    detail: "Starts instantly with a voice already on this device.",
    defaultChoice: "system",
  },
  {
    id: "kitten",
    name: "Kitten",
    detail: "Small and quick. Clear, if a little synthetic.",
    defaultChoice: `kitten:${KITTEN_DEFAULT_MODEL}`,
  },
  {
    id: "kokoro",
    name: "Kokoro",
    detail: "The most natural voice. Best on recent devices.",
    defaultChoice: "kokoro:wasm:q8",
  },
]);

const KITTEN_VARIANTS = [
  ["KittenML/kitten-tts-micro-0.8", "Micro 0.8", "40M parameters · experimental"],
  [KITTEN_DEFAULT_MODEL, "Nano 0.8", "15M parameters · recommended"],
  ["KittenML/kitten-tts-mini-0.8", "Mini 0.8", "80M parameters · experimental"],
];

const KOKORO_VARIANTS = [
  ["wasm", "q8", "Standard", "Lightest on memory · best for phones"],
  ["wasm", "uint8f16", "Faster", "About twice as fast · best for computers"],
  ["wasm", "fp32", "Full precision", "Largest download"],
  ["webgpu", "fp32", "Graphics chip (WebGPU)", "Desktop browsers · experimental"],
];

export const SPEECH_MODEL_CHOICES = Object.freeze([
  {
    id: "system",
    engine: "system",
    name: "System voice",
    detail: "Installed on this device",
    repository: "Browser / operating-system voice",
    sizeMb: 0,
    backend: "system",
    device: "system",
    dtype: "native",
  },
  ...KITTEN_VARIANTS.map(([model, name, detail]) => ({
    id: `kitten:${model}`,
    engine: "kitten",
    name,
    detail,
    repository: model,
    sizeMb: kittenSize(model),
    backend: "kitten",
    device: "wasm",
    dtype: "fp32",
    model,
  })),
  ...KOKORO_VARIANTS.map(([device, dtype, name, detail]) => ({
    id: `kokoro:${device}:${dtype}`,
    engine: "kokoro",
    name,
    detail,
    repository: KOKORO_MODEL,
    sizeMb: kokoroSize(dtype, device),
    backend: "kokoro",
    device,
    dtype,
    model: KOKORO_MODEL,
  })),
]);

// Phones and tablets (including iPadOS, which reports a Mac user agent).
export function prefersLowMemory(nav = globalThis.navigator) {
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  const agent = nav.userAgent || "";
  return /iPhone|iPad|iPod|Android|Mobile/i.test(agent) || (/Macintosh/.test(agent) && nav.maxTouchPoints > 1);
}

export function defaultKokoroDtype(nav = globalThis.navigator) {
  return prefersLowMemory(nav) ? "q8" : "uint8f16";
}

export function getModelDownloadDetails({ backend, kokoroDevice = "wasm", kokoroDtype = "q8", kittenModel = KITTEN_DEFAULT_MODEL }) {
  if (backend === "kokoro") {
    const device = kokoroDevice === "webgpu" ? "webgpu" : "wasm";
    const dtype = device === "webgpu" ? "fp32" : (KOKORO_DTYPES.includes(kokoroDtype) ? kokoroDtype : "q8");
    return {
      model: KOKORO_MODEL,
      engineName: "Kokoro",
      label: `Kokoro 82M · ${dtype} · ${device === "webgpu" ? "WebGPU" : "WASM"}`,
      sizeMb: kokoroSize(dtype, device),
    };
  }

  const model = KITTEN_MODELS.includes(kittenModel) ? kittenModel : KITTEN_DEFAULT_MODEL;
  return {
    model,
    engineName: "Kitten",
    label: `Kitten ${model.split("/").pop()} · fp32 · WASM`,
    sizeMb: kittenSize(model),
  };
}

export function formatMegabytes(value) {
  return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()} MB`;
}
