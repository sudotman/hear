export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KITTEN_DEFAULT_MODEL = "onnx-community/KittenTTS-Nano-v0.8-ONNX";

export const KOKORO_DTYPES = ["fp32", "fp16", "q8", "q4", "q4f16", "uint8"];
export const KITTEN_DTYPES = ["fp32"];
export const KITTEN_MODELS = [
  KITTEN_DEFAULT_MODEL,
  "KittenML/kitten-tts-mini-0.8",
  "KittenML/kitten-tts-micro-0.8",
  "onnx-community/kitten-tts-nano-0.1-ONNX",
];
export const KITTEN_VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"];

const KOKORO_DOWNLOAD_MB = {
  fp32: 326,
  fp16: 163,
  q8: 92,
  q4: 305,
  q4f16: 154,
  uint8: 177,
};

const KITTEN_DOWNLOAD_MB = {
  [KITTEN_DEFAULT_MODEL]: 80,
  "KittenML/kitten-tts-mini-0.8": 80,
  "KittenML/kitten-tts-micro-0.8": 50,
  "onnx-community/kitten-tts-nano-0.1-ONNX": 40,
};

export function getModelDownloadDetails({ backend, kokoroDevice = "wasm", kokoroDtype = "q8", kittenModel = KITTEN_DEFAULT_MODEL }) {
  if (backend === "kokoro") {
    const dtype = kokoroDevice === "webgpu" ? "fp32" : (KOKORO_DTYPES.includes(kokoroDtype) ? kokoroDtype : "q8");
    return {
      model: KOKORO_MODEL,
      label: `Kokoro 82M · ${dtype} · ${kokoroDevice === "webgpu" ? "WebGPU" : "WASM"}`,
      sizeMb: KOKORO_DOWNLOAD_MB[dtype],
      estimated: false,
    };
  }

  const model = KITTEN_MODELS.includes(kittenModel) ? kittenModel : KITTEN_DEFAULT_MODEL;
  return {
    model,
    label: `Kitten ${model.split("/").pop()} · fp32 · WASM`,
    sizeMb: KITTEN_DOWNLOAD_MB[model] || 80,
    estimated: true,
  };
}

export function formatMegabytes(value) {
  return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString()} MB`;
}
