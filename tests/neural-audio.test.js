import { describe, expect, it } from "vitest";
import { buildStitchedWav, decodeWav, encodeWav, floatToInt16, trimSilence } from "../neural-audio.js";

describe("neural audio helpers", () => {
  it("round-trips 16-bit PCM through a WAV", () => {
    const samples = Int16Array.from([0, 1200, -1200, 32767, -32768]);
    const decoded = decodeWav(encodeWav(samples, 24_000));
    expect(decoded.sampleRate).toBe(24_000);
    expect([...decoded.samples]).toEqual([...samples]);
  });

  it("reads 32-bit float WAVs written by kokoro-js", () => {
    const floats = Float32Array.from([0, 0.5, -0.5]);
    const buffer = new ArrayBuffer(44 + floats.byteLength);
    const view = new DataView(buffer);
    const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    ascii(0, "RIFF");
    view.setUint32(4, 36 + floats.byteLength, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint32(28, 24_000 * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 32, true);
    ascii(36, "data");
    view.setUint32(40, floats.byteLength, true);
    floats.forEach((value, index) => view.setFloat32(44 + index * 4, value, true));
    const decoded = decodeWav(buffer);
    expect([...decoded.samples]).toEqual([0, 16383, -16384]);
  });

  it("trims padding around speech but keeps a margin", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(1000);
    samples.fill(0.2, 400, 600);
    const trimmed = trimSilence(samples, sampleRate);
    // 25 ms lead + 200 ms speech + 45 ms tail
    expect(trimmed.length).toBe(270);
    expect(trimSilence(new Float32Array(50), sampleRate).length).toBe(0);
  });

  it("stitches sentences with baked-in pauses and reports offsets", () => {
    const one = floatToInt16(Float32Array.from([0.1, 0.1, 0.1]));
    const two = floatToInt16(Float32Array.from([0.2, 0.2]));
    const stitched = buildStitchedWav([{ samples: one, pauseSamples: 4 }, { samples: two, pauseSamples: 1 }], 8000);
    expect(stitched.offsets).toEqual([0, 7]);
    expect(stitched.speech).toEqual([3, 2]);
    expect(stitched.totalSamples).toBe(10);
    const decoded = decodeWav(stitched.buffer);
    expect([...decoded.samples.slice(3, 7)]).toEqual([0, 0, 0, 0]);
    expect(decoded.samples[7]).toBe(two[0]);
  });
});
