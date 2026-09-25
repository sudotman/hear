// PCM helpers for locally generated speech. Everything here is pure so the
// playback pipeline can be unit-tested outside a browser.

const SILENCE_THRESHOLD = 0.004; // ≈ −48 dBFS
const LEAD_MS = 25;
const TAIL_MS = 45;

export function floatToInt16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

// Models pad their output inconsistently, which made the gap between two
// sentences vary from nothing to half a second. Trim to the audible speech
// (with a small margin so soft onsets survive) and let the player add
// deliberate pauses instead.
export function trimSilence(samples, sampleRate, { threshold = SILENCE_THRESHOLD } = {}) {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < threshold) first += 1;
  if (first >= samples.length) return samples.subarray(0, 0);
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < threshold) last -= 1;
  const start = Math.max(0, first - Math.round((LEAD_MS / 1000) * sampleRate));
  const end = Math.min(samples.length, last + 1 + Math.round((TAIL_MS / 1000) * sampleRate));
  return samples.subarray(start, end);
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function writeWavHeader(view, sampleCount, sampleRate) {
  const dataLength = sampleCount * 2;
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  writeWavHeader(new DataView(buffer), samples.length, sampleRate);
  new Int16Array(buffer, 44, samples.length).set(samples);
  return buffer;
}

// Reads the WAVs Hear has cached over time: 16-bit PCM from Kitten and the
// player, and 32-bit float from kokoro-js' RawAudio.toWav().
export function decodeWav(buffer) {
  const view = new DataView(buffer);
  const tag = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (buffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("Cached audio is not a WAV file.");
  }
  let offset = 12;
  let format = 0;
  let channels = 1;
  let sampleRate = 24_000;
  let bitsPerSample = 16;
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      const length = Math.min(size, buffer.byteLength - body);
      const frames = Math.floor(length / (channels * (bitsPerSample / 8)));
      const samples = new Int16Array(frames);
      const stride = channels * (bitsPerSample / 8);
      for (let frame = 0; frame < frames; frame += 1) {
        const at = body + frame * stride;
        if (format === 3 && bitsPerSample === 32) {
          const value = Math.max(-1, Math.min(1, view.getFloat32(at, true)));
          samples[frame] = value < 0 ? value * 0x8000 : value * 0x7fff;
        } else if (bitsPerSample === 16) {
          samples[frame] = view.getInt16(at, true);
        } else if (bitsPerSample === 8) {
          samples[frame] = (view.getUint8(at) - 128) << 8;
        } else {
          throw new Error(`Unsupported cached audio format (${format}/${bitsPerSample}).`);
        }
      }
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("Cached audio has no data chunk.");
}

// Stitches consecutive sentences into one WAV with their pauses baked in.
// Playing a single longer file avoids a src swap (and its audible gap, and
// iOS's reluctance to start new media in the background) between every
// sentence. offsets/speech let the caller map currentTime back to text.
export function buildStitchedWav(parts, sampleRate) {
  let total = 0;
  const offsets = [];
  const speech = [];
  for (const part of parts) {
    offsets.push(total);
    speech.push(part.samples.length);
    total += part.samples.length + Math.max(0, Math.round(part.pauseSamples || 0));
  }
  const buffer = new ArrayBuffer(44 + total * 2);
  writeWavHeader(new DataView(buffer), total, sampleRate);
  const pcm = new Int16Array(buffer, 44, total);
  parts.forEach((part, index) => pcm.set(part.samples, offsets[index]));
  return { buffer, offsets, speech, totalSamples: total };
}

export function silentWav(seconds = 1, sampleRate = 24_000) {
  return encodeWav(new Int16Array(Math.round(seconds * sampleRate)), sampleRate);
}
