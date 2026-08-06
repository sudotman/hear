import * as ort from "onnxruntime-web/wasm";
import { unzipSync } from "fflate";
import { phonemize } from "phonemizer";

let session = null;
let voices = null;
let initialization = null;
let generationQueue = Promise.resolve();

const MODEL_ID = "onnx-community/KittenTTS-Nano-v0.8-ONNX";
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model.onnx`;
const VOICES_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices.npz`;
const SAMPLE_RATE = 24_000;
const VOICE_ALIASES = {
  Bella: "expr-voice-2-f",
  Jasper: "expr-voice-2-m",
  Luna: "expr-voice-3-f",
  Bruno: "expr-voice-3-m",
  Rosie: "expr-voice-4-f",
  Hugo: "expr-voice-4-m",
  Kiki: "expr-voice-5-f",
  Leo: "expr-voice-5-m",
};
const SPEED_PRIORS = {
  "expr-voice-2-f": 0.8,
  "expr-voice-2-m": 0.8,
  "expr-voice-3-f": 0.8,
  "expr-voice-3-m": 0.8,
  "expr-voice-4-f": 0.8,
  "expr-voice-4-m": 0.9,
  "expr-voice-5-f": 0.8,
  "expr-voice-5-m": 0.8,
};

const PAD = "$";
const PUNCTUATION = ';:,.!?¡¿—…"«»"" ';
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const IPA_LETTERS =
  "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
const TOKEN_BY_CHARACTER = new Map([...PAD, ...PUNCTUATION, ...LETTERS, ...IPA_LETTERS].map((character, index) => [character, index]));

function tokenize(phonemes) {
  const tokens = [];
  for (const character of phonemes) {
    const token = TOKEN_BY_CHARACTER.get(character);
    if (token !== undefined) tokens.push(token);
  }
  tokens.unshift(0);
  tokens.push(10, 0);
  return tokens;
}

function parseNpy(bytes) {
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== "NUMPY") {
    throw new Error("The natural voice data is invalid.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVersion = bytes[6];
  const headerOffset = majorVersion === 1 ? 10 : 12;
  const headerLength = majorVersion === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const header = new TextDecoder().decode(bytes.slice(headerOffset, headerOffset + headerLength));
  const dtype = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  const shape = header
    .match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1]
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite) || [];
  const raw = bytes.slice(headerOffset + headerLength);
  const aligned = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

  let data;
  if (dtype === "<f4" || dtype === "float32") {
    data = new Float32Array(aligned);
  } else if (dtype === "<f8" || dtype === "float64") {
    data = Float32Array.from(new Float64Array(aligned));
  } else {
    throw new Error(`Unsupported voice data type: ${dtype || "unknown"}`);
  }

  return { data, shape: [shape[0] || 1, shape[1] || data.length] };
}

async function fetchArrayBuffer(url, { file = "", reportProgress = false } = {}) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Voice download failed (${response.status}).`);
  if (!response.body) return response.arrayBuffer();

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  let loaded = 0;
  let target = total ? new Uint8Array(total) : null;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (target) target.set(value, loaded);
    else chunks.push(value);
    loaded += value.byteLength;
    if (reportProgress) {
      self.postMessage({
        type: "progress",
        status: "download",
        file,
        progress: total ? (loaded / total) * 100 : null,
        loaded,
        total,
      });
    }
  }

  if (target) return target.buffer;
  target = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    target.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return target.buffer;
}

async function loadVoices() {
  const archive = await fetchArrayBuffer(VOICES_URL);
  const entries = unzipSync(new Uint8Array(archive));
  const loadedVoices = {};
  for (const [file, bytes] of Object.entries(entries)) {
    if (!file.endsWith(".npy")) continue;
    loadedVoices[file.replace(/\.npy$/, "")] = parseNpy(bytes);
  }
  if (!Object.keys(loadedVoices).length) throw new Error("The natural voices could not be read.");
  return loadedVoices;
}

async function initialize() {
  if (session && voices) return;
  if (initialization) return initialization;

  initialization = (async () => {
    self.postMessage({ type: "progress", status: "starting", file: "", progress: null });

    // iOS Safari is especially sensitive to ONNX Runtime's JSEP build and
    // multi-threaded/shared WASM memory. The pure WASM entry point plus a
    // single sequential thread keeps both compilation and peak memory bounded.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.initTimeout = 45_000;

    const [modelBuffer, loadedVoices] = await Promise.all([
      fetchArrayBuffer(MODEL_URL, { file: "onnx/model.onnx", reportProgress: true }),
      loadVoices(),
    ]);

    self.postMessage({ type: "progress", status: "initializing", file: "", progress: null });
    const loadedSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
      executionMode: "sequential",
      graphOptimizationLevel: "all",
      enableCpuMemArena: false,
      enableMemPattern: false,
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
    });

    session = loadedSession;
    voices = loadedVoices;
    self.postMessage({ type: "ready", model: MODEL_ID, dtype: "fp32", device: "wasm" });
  })().catch((error) => {
    initialization = null;
    session = null;
    voices = null;
    self.postMessage({ type: "fatal", message: error.message || "The natural voice could not be loaded." });
    throw error;
  });

  return initialization;
}

function basicTokenize(text) {
  return text.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || [];
}

async function phonemizeWithPunctuation(text) {
  const punctuationPattern = /(\s*[;:,.!?¡¿—…“”«»"()\[\]{}]+\s*)+/g;
  const sections = [];
  let lastIndex = 0;
  for (const match of text.matchAll(punctuationPattern)) {
    if (lastIndex < match.index) sections.push({ punctuation: false, text: text.slice(lastIndex, match.index) });
    sections.push({ punctuation: true, text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) sections.push({ punctuation: false, text: text.slice(lastIndex) });

  const parts = await Promise.all(sections.map(async (section) => {
    if (section.punctuation) return section.text;
    return (await phonemize(section.text, "en-us")).join(" ");
  }));
  return basicTokenize(parts.join("")).join(" ");
}

async function synthesize(text, voiceName) {
  const voiceId = VOICE_ALIASES[voiceName] || VOICE_ALIASES.Bella;
  const voice = voices[voiceId];
  if (!voice) throw new Error(`Voice “${voiceName}” is unavailable.`);

  const phonemeText = await phonemizeWithPunctuation(text);
  const inputIds = tokenize(phonemeText);
  const referenceIndex = Math.min(text.length, voice.shape[0] - 1);
  const styleSize = voice.shape[1];
  const style = voice.data.slice(referenceIndex * styleSize, (referenceIndex + 1) * styleSize);
  const speed = SPEED_PRIORS[voiceId] || 0.8;

  const results = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(inputIds, BigInt), [1, inputIds.length]),
    style: new ort.Tensor("float32", style, [1, styleSize]),
    speed: new ort.Tensor("float32", new Float32Array([speed]), [1]),
  });
  const output = results[session.outputNames[0]]?.data;
  if (!(output instanceof Float32Array) || !output.length || !Number.isFinite(output[0])) {
    throw new Error("The natural voice produced invalid audio.");
  }
  return output.length > SAMPLE_RATE ? output.slice(0, -5000) : output;
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let peak = 1;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const scale = 0.98 / peak;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] * scale));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

async function generate({ id, text, voice }) {
  await initialize();
  self.postMessage({ type: "generating", id });
  const samples = await synthesize(text.trim().replace(/[^.!?…]$/, "$&."), voice);
  const buffer = encodeWav(samples);
  self.postMessage({ type: "audio", id, buffer, duration: samples.length / SAMPLE_RATE }, [buffer]);
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "init") {
    initialize().catch(() => {});
    return;
  }
  if (message.type !== "generate") return;

  generationQueue = generationQueue
    .then(() => generate(message))
    .catch((error) => {
      self.postMessage({
        type: "generation-error",
        id: message.id,
        message: error.message || "This passage could not be spoken.",
      });
    });
});
