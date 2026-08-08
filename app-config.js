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

const KITTEN_MODEL_LABELS = {
  "onnx-community/kitten-tts-nano-0.1-ONNX": ["Kitten Nano 0.1", "Legacy release"],
  "KittenML/kitten-tts-micro-0.8": ["Kitten Micro 0.8", "Compact · experimental"],
  [KITTEN_DEFAULT_MODEL]: ["Kitten Nano 0.8", "15M · supported default"],
  "KittenML/kitten-tts-mini-0.8": ["Kitten Mini 0.8", "Larger · experimental"],
};

const sortedKittenModels = [
  "onnx-community/kitten-tts-nano-0.1-ONNX",
  "KittenML/kitten-tts-micro-0.8",
  KITTEN_DEFAULT_MODEL,
  "KittenML/kitten-tts-mini-0.8",
];

const sortedKokoroDtypes = [...KOKORO_DTYPES].sort((left, right) => KOKORO_DOWNLOAD_MB[left] - KOKORO_DOWNLOAD_MB[right]);

export const SPEECH_MODEL_CHOICES = Object.freeze([
  {
    id: "system",
    group: "Instant",
    name: "System voice",
    detail: "Installed on this device · starts immediately",
    repository: "Browser / operating-system voice",
    sizeMb: 0,
    backend: "system",
    device: "system",
    dtype: "native",
  },
  ...sortedKittenModels.map((model) => ({
    id: `kitten:${model}`,
    group: "Kitten · efficient",
    name: KITTEN_MODEL_LABELS[model][0],
    detail: KITTEN_MODEL_LABELS[model][1],
    repository: model,
    sizeMb: KITTEN_DOWNLOAD_MB[model],
    estimated: true,
    backend: "kitten",
    device: "wasm",
    dtype: "fp32",
    model,
  })),
  ...sortedKokoroDtypes.map((dtype) => ({
    id: `kokoro:wasm:${dtype}`,
    group: "Kokoro · higher fidelity",
    name: `Kokoro 82M · ${dtype}`,
    detail: `${dtype === "q8" ? "Recommended balance" : "WASM precision option"} · local generation`,
    repository: KOKORO_MODEL,
    sizeMb: KOKORO_DOWNLOAD_MB[dtype],
    backend: "kokoro",
    device: "wasm",
    dtype,
    model: KOKORO_MODEL,
  })),
  {
    id: "kokoro:webgpu:fp32",
    group: "Kokoro · higher fidelity",
    name: "Kokoro 82M · fp32 WebGPU",
    detail: "Experimental · probed only after confirmation",
    repository: KOKORO_MODEL,
    sizeMb: KOKORO_DOWNLOAD_MB.fp32,
    backend: "kokoro",
    device: "webgpu",
    dtype: "fp32",
    model: KOKORO_MODEL,
  },
]);

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
