import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { phonemize } from "phonemizer";

// WebKit compatibility: ReadableStream async iteration is missing on
// Safari / iOS Safari < ~16 despite supporting ReadableStream. Phonemizer's
// bundled espeak-ng loader uses `for await (const c of stream)` which throws
// `TypeError: undefined is not a function` on WebKit. Polyfill if needed.
if (typeof ReadableStream !== "undefined" && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

const SAMPLE_RATE = 24_000;
const DEFAULT_MODEL_ROOT = "https://huggingface.co/onnx-community/KittenTTS-Nano-v0.8-ONNX/resolve/main";
const DEFAULT_MODEL_ID = "onnx-community/KittenTTS-Nano-v0.8-ONNX";
const SYMBOLS = [
  "$",
  ...';:,.!?¡¿—…"«»"" ',
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  ..."ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ",
];
const SYMBOL_IDS = new Map(SYMBOLS.map((symbol, index) => [symbol, index]));

function basic_english_tokenize(text) {
  // Python parity: re.findall(r"\w+|[^\w\s]", text) with re.UNICODE.
  // Py \w = Unicode letters/numbers/underscore (includes IPA letters + Lm like ˈˌː).
  // JS \w is ASCII-only, so use Unicode property escapes to match Python.
  return text.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || [];
}

function tokenize(phonemes) {
  const tokens = [...phonemes].flatMap((character) => SYMBOL_IDS.has(character) ? [SYMBOL_IDS.get(character)] : []);
  // Python reference: [0, ...tokens, 10, 0] where 10 is "…" used as EOS separator.
  // Guard against Expand shape errors on mini/micro/nano: voices shape is (400,256) so style index max 399,
  // and ONNX graph Expand expects seq_len <= 400-510. Truncate to 400 to avoid invalid expand shape on long segments (e.g. 333 chars).
  const ids = [0, ...tokens, 10, 0];
  if (ids.length > 400) {
    // Keep BOS 0, 398 tokens, EOS marker 10,0 -> 400 total, preserving style EOS semantics
    return [...ids.slice(0, 398), 10, 0];
  }
  return ids;
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
  // Prefer native DecompressionStream (Safari 16.4+), fallback to fflate for WebKit without it
  if (typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {}
  }
  // Fallback: fflate raw inflate (voices.npz per-file deflate-raw)
  const { inflateSync } = await import("fflate");
  // fflate inflateSync expects raw deflate bytes
  return inflateSync(bytes);
}

async function loadNpzVoices(url, onProgress) {
  onProgress?.({ status: "progress", file: "voices.npz", loaded: 0, total: 0, progress: 0 });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Kitten voices (${response.status}).`);
  const buffer = await response.arrayBuffer();
  onProgress?.({ status: "progress", file: "voices.npz", loaded: buffer.byteLength, total: buffer.byteLength, progress: 50 });
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

async function fetchWithProgress(url, onProgress, fileLabel = "onnx/model.onnx") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${fileLabel} (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const buf = await response.arrayBuffer();
    onProgress?.({ status: "progress", file: fileLabel, loaded: buf.byteLength, total: buf.byteLength, progress: 100 });
    return buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ status: "progress", file: fileLabel, loaded, total, progress: total ? (loaded / total) * 100 : null });
  }
  const joined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  // Ensure final 100% is reported
  onProgress?.({ status: "progress", file: fileLabel, loaded, total: loaded, progress: 100 });
  return joined.buffer;
}

async function fetchWithProgressAndLabel(url, onProgress, label) {
  return fetchWithProgress(url, onProgress, label);
}

export class KittenRuntime {
  constructor({ onProgress, model } = {}) {
    this.onProgress = onProgress;
    this.modelId = model || DEFAULT_MODEL_ID;
    this.modelRoot = `https://huggingface.co/${this.modelId}/resolve/main`;
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
    // Try kitten_config.json first, fallback to config.json for other repos
    let config = null;
    let configUrl = `${this.modelRoot}/kitten_config.json`;
    let configResponse = await fetch(configUrl);
    if (!configResponse.ok) {
      configUrl = `${this.modelRoot}/config.json`;
      configResponse = await fetch(configUrl);
    }
    if (!configResponse.ok) throw new Error(`Could not load Kitten config for ${this.modelId} (${configResponse.status}).`);
    config = await configResponse.json();
    // Kitten ONNX models use different keys: kitten_config has voices/model_file, config.json may not
    this.config = {
      voices: config.voices || "voices.npz",
      model_file: config.model_file || config.modelFile || "onnx/model.onnx",
      voice_aliases: config.voice_aliases || config.voiceAliases || {},
      speed_priors: config.speed_priors || config.speedPriors || {},
    };
    // HF's kitten_config.json for Nano 0.8 points to "kitten_tts_nano_v0_8.onnx"
    // at the repo root, but the actual XET asset lives at "onnx/model.onnx".
    // Normalize to avoid the 404 that Safari logs as a failed resource.
    if (this.config.model_file === "kitten_tts_nano_v0_8.onnx") {
      this.config.model_file = "onnx/model.onnx";
    }
    // Resolve model file path
    const modelPath = this.config.model_file.startsWith("http") ? this.config.model_file : `${this.modelRoot}/${this.config.model_file}`;
    const voicesPath = this.config.voices.startsWith("http") ? this.config.voices : `${this.modelRoot}/${this.config.voices}`;
    // Report voices download too
    const voicesProgress = (status, file, loaded, total) => this.onProgress?.({ status, file, loaded, total, progress: total ? (loaded / total) * 100 : null });
    const voicesFetch = (async () => {
      voicesProgress("progress", "voices.npz", 0, 0);
      const v = await loadNpzVoices(voicesPath, this.onProgress);
      this.onProgress?.({ status: "progress", file: "voices.npz", loaded: 1, total: 1, progress: 100 });
      return v;
    })();
    const modelFetch = fetchWithProgress(modelPath, this.onProgress, "onnx/model.onnx").catch(async () => {
        const alt = `${this.modelRoot}/onnx/model.onnx`;
        if (alt === modelPath) throw new Error(`Could not download Kitten model at ${modelPath}`);
        return fetchWithProgress(alt, this.onProgress, "onnx/model.onnx");
      });
    const [model, voices] = await Promise.all([modelFetch, voicesFetch]);
    this.voices = voices;
    this.onProgress?.({ status: "loading", file: "onnx/model.onnx", progress: null });
    this.session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    this.onProgress?.({ status: "ready", file: "", progress: 100 });
  }

  async generate(text, { voice = "Bella", speed = 1 } = {}) {
    if (!this.session || !this.config || !this.voices) throw new Error("Kitten WASM is not loaded.");
    const voiceId = this.config.voice_aliases?.[voice] || voice;
    const voiceData = this.voices[voiceId];
    if (!voiceData) throw new Error(`Kitten voice “${voice}” is unavailable.`);
    // Convert explicit line breaks (preserved by library.js for verse/<br>) into punctuation pauses
    // so Kitten keeps Python parity (single EspeakBackend call) but renders line breaks as audible pauses.
    // Double newline -> sentence break (period), single -> comma-like pause.
    let normalizedText = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (normalizedText.includes("\n")) {
      normalizedText = normalizedText
        .replace(/\n{3,}/g, "\n\n")
        // Use placeholder to avoid double conversion of the newline left after paragraph break
        .replace(/\n\n/g, " __PARA__ ")
        // If line already ends with punctuation, keep that pause instead of adding a period
        .replace(/([.!?;:,…])\s*\n/g, "$1 ")
        .replace(/\n/g, " . ")
        .replace(/__PARA__/g, " . ")
        // Collapse duplicate periods (e.g. ".." -> ".")
        .replace(/\.\s*\./g, ".")
        .replace(/\s{2,}/g, " ")
        .trim();
      text = normalizedText;
    }
    // Exact Python parity: single espeak call + basic_english_tokenize + TextCleaner
    const phonemesList = await new Promise((resolve, reject) => {
      // phonemizer espeak backend – preserve punctuation & stress like Python's EspeakBackend
      phonemize(text, "en-us").then(resolve, reject);
    });
    const rawPhonemes = Array.isArray(phonemesList) ? phonemesList.join(" ") : String(phonemesList);
    const phonemes = basic_english_tokenize(rawPhonemes).join(" ");
    const inputIds = tokenize(phonemes);
    const styleIndex = Math.min(text.length, voiceData.shape[0] - 1);
    const styleSize = voiceData.shape[1];
    const style = voiceData.data.slice(styleIndex * styleSize, (styleIndex + 1) * styleSize);
    const adjustedSpeed = speed * (this.config.speed_priors?.[voiceId] || 1);
    let result;
    try {
      result = await this.session.run({
        input_ids: new ort.Tensor("int64", BigInt64Array.from(inputIds, BigInt), [1, inputIds.length]),
        style: new ort.Tensor("float32", style, [1, styleSize]),
        speed: new ort.Tensor("float32", new Float32Array([adjustedSpeed]), [1]),
      });
    } catch (err) {
      const msg = err?.message || String(err);
      if (msg.includes("Expand") || msg.includes("invalid expand") || msg.includes("ERROR_CODE: 2")) {
        throw new Error(`Kitten ${this.modelId} failed: invalid expand shape for ${inputIds.length} tokens (text ${text.length} chars). Try Nano 0.8 default, shorter passage, or different voice. Original: ${msg}`);
      }
      throw err;
    }
    const waveform = result[this.session.outputNames[0]].data;
    if (!waveform.length || !Number.isFinite(waveform[0])) throw new Error("Kitten produced invalid audio on this device.");
    // Python always slices last 5000 samples (tail noise)
    const trimmed = waveform.length > 5000 ? waveform.slice(0, waveform.length - 5000) : waveform;
    return { audio: trimmed, samplingRate: SAMPLE_RATE };
  }

  async dispose() {
    await this.session?.release?.();
    this.session = null;
    this.voices = null;
  }
}
