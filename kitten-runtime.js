import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { phonemize } from "phonemizer";

const SAMPLE_RATE = 24_000;
const MODEL_ROOT = "https://huggingface.co/onnx-community/KittenTTS-Nano-v0.8-ONNX/resolve/main";
const SYMBOLS = [
  "$",
  ...';:,.!?¡¿—…"«» ',
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  ..."ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ",
];
const SYMBOL_IDS = new Map(SYMBOLS.map((symbol, index) => [symbol, index]));

function tokenize(phonemes) {
  const tokens = [...phonemes].flatMap((character) => SYMBOL_IDS.has(character) ? [SYMBOL_IDS.get(character)] : []);
  return [0, ...tokens, 10, 0];
}

function parseNpy(bytes) {
  if (bytes[0] !== 0x93 || new TextDecoder().decode(bytes.slice(1, 6)) !== "NUMPY") {
    throw new Error("Kitten voice data is not a valid NPY file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerOffset = bytes[6] === 1 ? 10 : 12;
  const headerLength = bytes[6] === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const header = new TextDecoder().decode(bytes.slice(headerOffset, headerOffset + headerLength));
  const dtype = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1];
  const shape = header.match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1]
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite) || [];
  const raw = bytes.slice(headerOffset + headerLength);
  const aligned = raw.slice().buffer;
  if (dtype === "<f4") return { data: new Float32Array(aligned), shape };
  if (dtype === "<f8") return { data: Float32Array.from(new Float64Array(aligned)), shape };
  throw new Error(`Unsupported Kitten voice dtype: ${dtype}`);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadNpzVoices(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Kitten voices (${response.status}).`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Could not read the Kitten voice archive.");

  const count = view.getUint16(endOffset + 10, true);
  let directoryOffset = view.getUint32(endOffset + 16, true);
  const voices = {};
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(directoryOffset, true) !== 0x02014b50) break;
    const method = view.getUint16(directoryOffset + 10, true);
    const compressedSize = view.getUint32(directoryOffset + 20, true);
    const nameLength = view.getUint16(directoryOffset + 28, true);
    const extraLength = view.getUint16(directoryOffset + 30, true);
    const commentLength = view.getUint16(directoryOffset + 32, true);
    const localOffset = view.getUint32(directoryOffset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(directoryOffset + 46, directoryOffset + 46 + nameLength));
    if (name.endsWith(".npy")) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      const file = method === 0 ? compressed : await inflateRaw(compressed);
      const parsed = parseNpy(file);
      voices[name.replace(/\.npy$/, "")] = {
        data: parsed.data,
        shape: [parsed.shape[0] || 1, parsed.shape[1] || parsed.data.length],
      };
    }
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }
  return voices;
}

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the Kitten model (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ status: "progress", file: "onnx/model.onnx", loaded, total, progress: total ? (loaded / total) * 100 : null });
  }
  const joined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined.buffer;
}

export class KittenRuntime {
  constructor({ onProgress } = {}) {
    this.onProgress = onProgress;
    this.session = null;
    this.voices = null;
    this.config = null;
  }

  async load() {
    ort.env.wasm.wasmPaths = {
      wasm: wasmUrl,
      mjs: wasmModuleUrl,
    };
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, Math.floor((self.navigator?.hardwareConcurrency || 2) / 2)))
      : 1;
    this.onProgress?.({ status: "starting", file: "", progress: null });
    const configResponse = await fetch(`${MODEL_ROOT}/kitten_config.json`);
    if (!configResponse.ok) throw new Error("Could not load the Kitten model configuration.");
    this.config = await configResponse.json();
    const [model, voices] = await Promise.all([
      fetchWithProgress(`${MODEL_ROOT}/onnx/model.onnx`, this.onProgress),
      loadNpzVoices(`${MODEL_ROOT}/${this.config.voices}`),
    ]);
    this.voices = voices;
    this.session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  }

  async generate(text, { voice = "Bella", speed = 1 } = {}) {
    if (!this.session || !this.config || !this.voices) throw new Error("Kitten WASM is not loaded.");
    const voiceId = this.config.voice_aliases?.[voice] || voice;
    const voiceData = this.voices[voiceId];
    if (!voiceData) throw new Error(`Kitten voice “${voice}” is unavailable.`);
    const phonemeParts = await Promise.all(text.split(/([;:,.!?¡¿—…"«»()\[\]{}]+)/g).map(async (part, index) => {
      if (index % 2 === 1) return part;
      return (await phonemize(part, "en-us")).join(" ");
    }));
    const inputIds = tokenize(phonemeParts.join(""));
    const styleIndex = Math.min(text.length, voiceData.shape[0] - 1);
    const styleSize = voiceData.shape[1];
    const style = voiceData.data.slice(styleIndex * styleSize, (styleIndex + 1) * styleSize);
    const adjustedSpeed = speed * (this.config.speed_priors?.[voiceId] || 1);
    const result = await this.session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(inputIds, BigInt), [1, inputIds.length]),
      style: new ort.Tensor("float32", style, [1, styleSize]),
      speed: new ort.Tensor("float32", new Float32Array([adjustedSpeed]), [1]),
    });
    const waveform = result[this.session.outputNames[0]].data;
    if (!waveform.length || !Number.isFinite(waveform[0])) throw new Error("Kitten produced invalid audio on this device.");
    return { audio: waveform.length > SAMPLE_RATE ? waveform.slice(0, -5000) : waveform, samplingRate: SAMPLE_RATE };
  }

  async dispose() {
    await this.session?.release?.();
    this.session = null;
    this.voices = null;
  }
}
