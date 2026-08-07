import { AutoTokenizer, StyleTextToSpeech2Model, Tensor } from "@huggingface/transformers";
import { phonemize } from "phonemizer";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";
const TEXT = "A short sentence should sound clear on every consecutive generation.";

function encodeWav(samples, sampleRate = 24_000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
  return buffer;
}

async function run() {
  if (!("gpu" in navigator)) throw new Error("WebGPU is unavailable in this browser.");
  self.postMessage({ type: "status", message: "Loading Kokoro FP32 and the Heart voice…" });
  const [model, tokenizer, voiceResponse] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL, { device: "webgpu", dtype: "fp32" }),
    AutoTokenizer.from_pretrained(MODEL),
    fetch(`https://huggingface.co/${MODEL}/resolve/main/voices/${VOICE}.bin`),
  ]);
  if (!voiceResponse.ok) throw new Error(`Voice download failed (${voiceResponse.status}).`);
  const voices = new Float32Array(await voiceResponse.arrayBuffer());
  const phonemes = (await phonemize(TEXT, "en-us")).join(" ").replace(/r/g, "ɹ").replace(/x/g, "k");
  const { input_ids } = tokenizer(phonemes, { truncation: true });
  const styleOffset = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
  const inputs = {
    input_ids,
    style: new Tensor("float32", voices.slice(styleOffset, styleOffset + 256), [1, 256]),
    speed: new Tensor("float32", [1], [1]),
  };
  const runs = [];
  let lastAudio;
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    const { waveform } = await model(inputs);
    const generationSeconds = (performance.now() - startedAt) / 1000;
    const duration = waveform.data.length / 24_000;
    const record = { run: index + 1, generationSeconds, audioDurationSeconds: duration, rtf: generationSeconds / duration };
    runs.push(record);
    lastAudio = encodeWav(waveform.data);
    self.postMessage({ type: "progress", completed: index + 1, latest: record, runs });
  }
  const summary = {
    model: MODEL,
    dtype: "fp32",
    device: "webgpu",
    transformersVersion: "4.2.0",
    runs: runs.length,
    averageRtf: runs.reduce((sum, item) => sum + item.rtf, 0) / runs.length,
    worstRtf: Math.max(...runs.map((item) => item.rtf)),
    crossOriginIsolated: self.crossOriginIsolated,
  };
  self.postMessage({ type: "complete", runs, summary, lastAudio }, [lastAudio]);
  await model.dispose?.();
}

self.addEventListener("message", (event) => {
  if (event.data.type !== "run") return;
  run().catch((error) => self.postMessage({ type: "failure", message: error.message, stack: error.stack }));
});
