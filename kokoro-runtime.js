import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { phonemize } from "phonemizer";
import { KOKORO_MODEL_FILES } from "./app-config.js";
import { fetchModelFile } from "./model-fetch.js";

// Kokoro 82M on the plain onnxruntime-web WASM build.
//
// kokoro-js runs through transformers.js, which loads ONNX Runtime's JSEP /
// asyncify builds; on iOS 26.2+ those grow memory until Safari kills the page
// (microsoft/onnxruntime#26827, WebKit 304810). This runtime reproduces
// kokoro-js 1.2.1 (Apache-2.0) exactly — text normalisation, phonemisation,
// tokenisation and style selection — on the same WASM build Kitten uses.
// It keeps transformers.js' cache keys so earlier downloads are reused.

const SAMPLE_RATE = 24_000;
const MODEL_CACHE = "transformers-cache";
const VOICE_CACHE = "kokoro-voices";
const MAX_TOKENS = 512;

// ── kokoro-js phonemize.js ─────────────────────────────────────────────────

function splitNum(match) {
  if (match.includes(".")) return match;
  if (match.includes(":")) {
    const [hours, minutes] = match.split(":").map(Number);
    if (minutes === 0) return `${hours} o'clock`;
    if (minutes < 10) return `${hours} oh ${minutes}`;
    return `${hours} ${minutes}`;
  }
  const year = Number.parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = Number.parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function flipMoney(match) {
  const bill = match[0] === "$" ? "dollar" : "pound";
  if (Number.isNaN(Number(match.slice(1)))) return `${match.slice(1)} ${bill}s`;
  if (!match.includes(".")) {
    const plural = match.slice(1) === "1" ? "" : "s";
    return `${match.slice(1)} ${bill}${plural}`;
  }
  const [whole, fraction] = match.slice(1).split(".");
  const cents = Number.parseInt(fraction.padEnd(2, "0"), 10);
  const coins = match[0] === "$" ? (cents === 1 ? "cent" : "cents") : cents === 1 ? "penny" : "pence";
  return `${whole} ${bill}${whole === "1" ? "" : "s"} and ${cents} ${coins}`;
}

function pointNum(match) {
  const [whole, fraction] = match.split(".");
  return `${whole} point ${fraction.split("").join(" ")}`;
}

function normalizeText(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
    .replace(/\d*\.\d+/g, pointNum)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (match) => match.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_PATTERN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`, "g");

function splitWithMatches(text, pattern) {
  const parts = [];
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (previous < match.index) parts.push({ match: false, text: text.slice(previous, match.index) });
    if (value.length > 0) parts.push({ match: true, text: value });
    previous = match.index + value.length;
  }
  if (previous < text.length) parts.push({ match: false, text: text.slice(previous) });
  return parts;
}

export async function phonemizeForKokoro(text, language = "a") {
  const normalized = normalizeText(text);
  const espeakLanguage = language === "a" ? "en-us" : "en";
  const pieces = await Promise.all(splitWithMatches(normalized, PUNCTUATION_PATTERN).map(async ({ match, text: piece }) => (
    match ? piece : (await phonemize(piece, espeakLanguage)).join(" ")
  )));
  let phonemes = pieces.join("")
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (language === "a") phonemes = phonemes.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return phonemes.trim();
}

// ── Runtime ───────────────────────────────────────────────────────────────

export class KokoroRuntime {
  constructor({ model, dtype = "q8", onProgress } = {}) {
    this.model = model;
    this.dtype = KOKORO_MODEL_FILES[dtype] ? dtype : "q8";
    this.onProgress = onProgress;
    this.root = `https://huggingface.co/${model}/resolve/main`;
    this.session = null;
    this.vocab = null;
    this.voices = new Map();
  }

  async load() {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, Math.floor((self.navigator?.hardwareConcurrency || 2) / 2)))
      : 1;
    this.onProgress?.({ status: "starting", file: "", progress: null });
    const file = KOKORO_MODEL_FILES[this.dtype];
    const [modelBuffer, tokenizerBuffer] = await Promise.all([
      fetchModelFile(`${this.root}/${file}`, { cacheName: MODEL_CACHE, file, onProgress: this.onProgress }),
      fetchModelFile(`${this.root}/tokenizer.json`, { cacheName: MODEL_CACHE, file: "tokenizer.json" }),
    ]);
    const tokenizer = JSON.parse(new TextDecoder().decode(tokenizerBuffer));
    this.vocab = new Map(Object.entries(tokenizer.model?.vocab || {}));
    if (!this.vocab.size) throw new Error("Kokoro tokenizer has no vocabulary.");
    this.onProgress?.({ status: "loading", file, progress: null });
    this.session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), { executionProviders: ["wasm"] });
    this.onProgress?.({ status: "ready", file: "", progress: 100 });
  }

  // tokenizer.json: drop symbols outside the vocabulary, one id per
  // character, wrapped in "$" (id 0), truncated to model_max_length.
  tokenize(phonemes) {
    const ids = [];
    for (const symbol of phonemes) {
      const id = this.vocab.get(symbol);
      if (id !== undefined) ids.push(id);
    }
    return [0, ...ids.slice(0, MAX_TOKENS - 2), 0];
  }

  async voice(name) {
    if (this.voices.has(name)) return this.voices.get(name);
    const file = `voices/${name}.bin`;
    const buffer = await fetchModelFile(`${this.root}/${file}`, { cacheName: VOICE_CACHE, file, onProgress: this.onProgress });
    const data = new Float32Array(buffer);
    this.voices.set(name, data);
    return data;
  }

  async generate(text, { voice = "af_heart", speed = 1, onStage = null } = {}) {
    if (!this.session) throw new Error("Kokoro is not loaded.");
    onStage?.("phonemize");
    const [phonemes, voiceData] = await Promise.all([phonemizeForKokoro(text, voice.at(0)), this.voice(voice)]);
    const ids = this.tokenize(phonemes);
    const offset = 256 * Math.min(Math.max(ids.length - 2, 0), 509);
    const style = voiceData.slice(offset, offset + 256);
    onStage?.("synthesize");
    const result = await this.session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, 256]),
      speed: new ort.Tensor("float32", new Float32Array([speed]), [1]),
    });
    const waveform = (result.waveform || result[this.session.outputNames[0]]).data;
    if (!waveform.length || !Number.isFinite(waveform[0])) throw new Error("Kokoro produced invalid audio on this device.");
    return { audio: waveform, samplingRate: SAMPLE_RATE };
  }

  async dispose() {
    await this.session?.release?.();
    this.session = null;
  }
}
