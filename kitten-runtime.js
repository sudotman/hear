import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { phonemize } from "phonemizer";
import { fetchModelFile } from "./model-fetch.js";

const SAMPLE_RATE = 24_000;
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

const KITTEN_CACHE_NAME = "kitten-cache";

async function parseNpzVoices(buffer) {
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
  const entries = [];
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
      entries.push({ name, method, compressed: bytes.slice(dataOffset, dataOffset + compressedSize) });
    }
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }

  // Each NPY member is independent. Inflate them together so WebKit does not
  // wait through a serial chain of DecompressionStream reads.
  const parsedEntries = await Promise.all(entries.map(async ({ name, method, compressed }) => {
    const file = method === 0 ? compressed : await inflateRaw(compressed);
    const parsed = parseNpy(file);
    return [name.replace(/\.npy$/, ""), {
      data: parsed.data,
      shape: [parsed.shape[0] || 1, parsed.shape[1] || parsed.data.length],
    }];
  }));
  return Object.fromEntries(parsedEntries);
}

async function loadNpzVoices(url, onProgress) {
  const buffer = await fetchModelFile(url, { cacheName: KITTEN_CACHE_NAME, file: "voices.npz", onProgress });
  return parseNpzVoices(buffer);
}

async function fetchJson(url) {
  const buffer = await fetchModelFile(url, { cacheName: KITTEN_CACHE_NAME, file: url.split("/").pop() });
  return JSON.parse(new TextDecoder().decode(buffer));
}

// Python KittenTTS chunk_text() → ensure_punctuation(): a chunk that does not
// end in prosodic punctuation gets a trailing comma before synthesis.
function ensurePunctuation(text) {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return ".!?,;:".includes(trimmed.at(-1)) ? trimmed : `${trimmed},`;
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
    let config;
    try {
      config = await fetchJson(`${this.modelRoot}/kitten_config.json`);
    } catch {
      try {
        config = await fetchJson(`${this.modelRoot}/config.json`);
      } catch (error) {
        throw new Error(`Could not load Kitten config for ${this.modelId} (${error.message}).`);
      }
    }
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
    const voicesFetch = loadNpzVoices(voicesPath, this.onProgress);
    const fetchModel = (url) => fetchModelFile(url, { cacheName: KITTEN_CACHE_NAME, file: "onnx/model.onnx", onProgress: this.onProgress });
    const modelFetch = fetchModel(modelPath).catch(async () => {
      const alt = `${this.modelRoot}/onnx/model.onnx`;
      if (alt === modelPath) throw new Error(`Could not download Kitten model at ${modelPath}`);
      return fetchModel(alt);
    });
    const [model, voices] = await Promise.all([modelFetch, voicesFetch]);
    this.voices = voices;
    this.onProgress?.({ status: "loading", file: "onnx/model.onnx", progress: null });
    this.session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    this.onProgress?.({ status: "ready", file: "", progress: 100 });
  }

  async generate(text, { voice = "Bella", speed = 1, onStage = null } = {}) {
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
    text = ensurePunctuation(text);
    // Exact Python parity: single espeak call + basic_english_tokenize + TextCleaner
    onStage?.("phonemize");
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
      onStage?.("synthesize");
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
