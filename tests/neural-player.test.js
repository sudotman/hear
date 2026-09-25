import { describe, expect, it } from "vitest";
import { NeuralPlayer } from "../neural-player.js";

const RATE = 1000;

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = "";
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.readyState = 0;
    this.loop = false;
    this.muted = false;
    this.playbackRate = 1;
    this.defaultPlaybackRate = 1;
    this.plays = [];
  }

  play() {
    this.paused = false;
    this.ended = false;
    this.readyState = 4;
    this.plays.push(this.src);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event("pause")));
  }

  finish() {
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(texts, { cache: cacheOverride } = {}) {
  const audio = new FakeAudio();
  const requests = [];
  const engine = {
    identity: () => ({ model: "test", dtype: "fp32", voice: "a" }),
    synthesize(text) {
      const job = deferred();
      requests.push({ text, ...job });
      return job.promise;
    },
  };
  const cache = cacheOverride || { key: async (text) => text, get: async () => null, put: async () => {} };
  const events = { states: [], skipped: [], ended: 0 };
  const player = new NeuralPlayer({
    audio,
    engine,
    cache,
    callbacks: {
      onState: (mode) => events.states.push(mode),
      onSkipped: (index) => events.skipped.push(index),
      onEnded: () => { events.ended += 1; },
    },
  });
  let word = 0;
  const segments = texts.map((text) => {
    const segment = { text, startWord: word, endWord: word + 10, wordCount: 10, pauseAfterMs: 100 };
    word += 10;
    return segment;
  });
  player.load(segments, 0);
  const speech = (seconds) => ({ samples: new Int16Array(Math.round(seconds * RATE)).fill(1000), sampleRate: RATE });
  return { audio, player, requests, events, speech };
}

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("NeuralPlayer", () => {
  it("keeps the audio session alive until the first sentence is ready, then plays it", async () => {
    const { audio, player, requests, events, speech } = setup(["one", "two", "three"]);
    player.play();
    expect(player.mode).toBe("buffering");
    expect(audio.loop).toBe(true);
    expect(audio.paused).toBe(false);
    await flush();
    expect(requests.map((request) => request.text)).toEqual(["one"]);

    requests[0].resolve(speech(4));
    await flush();
    expect(player.mode).toBe("playing");
    expect(player.window).toMatchObject({ start: 0, end: 1 });
    expect(audio.loop).toBe(false);
    // Only one synthesis job is in flight at a time.
    expect(requests.map((request) => request.text)).toEqual(["one", "two"]);
    expect(events.states).toEqual(["buffering", "playing"]);
  });

  it("stitches every ready sentence into the next window", async () => {
    const { audio, player, requests, speech } = setup(["one", "two", "three", "four"]);
    player.play();
    await flush();
    requests[0].resolve(speech(4));
    await flush();
    requests[1].resolve(speech(2));
    await flush();
    requests[2].resolve(speech(2));
    await flush();

    audio.finish();
    await flush();
    expect(player.mode).toBe("playing");
    expect(player.window).toMatchObject({ start: 1, end: 3 });
    expect(player.window.duration).toBeCloseTo(4.2, 5);
  });

  it("waits for a few seconds of audio before starting after a short title", async () => {
    const { player, requests, speech } = setup(["Title", "A long first sentence.", "More."]);
    player.play();
    await flush();
    requests[0].resolve(speech(0.6));
    await flush();
    expect(player.mode).toBe("buffering");
    requests[1].resolve(speech(5));
    await flush();
    expect(player.mode).toBe("playing");
    expect(player.window).toMatchObject({ start: 0, end: 2 });
  });

  it("hands off to the next window before the current one ends", async () => {
    const { audio, player, requests, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].resolve(speech(4));
    await flush();
    requests[1].resolve(speech(4));
    await flush();
    const first = audio.src;
    // Window 0 = 4 s speech + 0.1 s pause + 1 s padding; hand off inside the pause.
    expect(player.window.handoffAt).toBeCloseTo(4, 5);
    audio.currentTime = 4.02;
    audio.dispatchEvent(new Event("timeupdate"));
    expect(audio.ended).toBe(false);
    expect(audio.src).not.toBe(first);
    expect(player.window).toMatchObject({ start: 1, end: 2 });
    expect(player.mode).toBe("playing");
  });

  it("buffers on a stall and resumes where it left off", async () => {
    const { audio, player, requests, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].resolve(speech(4));
    await flush();
    audio.finish();
    await flush();
    expect(player.mode).toBe("buffering");
    expect(audio.loop).toBe(true);
    requests[1].resolve(speech(1));
    await flush();
    expect(player.mode).toBe("playing");
    expect(player.window).toMatchObject({ start: 1, end: 2 });
  });

  it("skips a sentence that fails twice instead of ending the session", async () => {
    const { player, requests, events, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].reject(new Error("bad input"));
    await flush();
    expect(requests).toHaveLength(2);
    requests[1].reject(new Error("bad input"));
    await flush();
    expect(events.skipped).toEqual([0]);
    // The skipped passage becomes a short silence; playback carries on once
    // the next sentence is ready.
    expect(player.mode).toBe("buffering");
    requests[2].resolve(speech(4));
    await flush();
    expect(player.mode).toBe("playing");
    expect(player.window).toMatchObject({ start: 0, end: 2 });
  });

  it("maps playback time back to words, including across a window", async () => {
    const { audio, player, requests, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].resolve(speech(1));
    await flush();
    requests[1].resolve(speech(1));
    await flush();
    audio.currentTime = 0.5;
    expect(player.positionWord()).toBeCloseTo(5, 5);
    // In the baked pause after the sentence, position rests at its end.
    audio.currentTime = 1.05;
    expect(player.positionWord()).toBeCloseTo(10, 5);
  });

  it("seeks inside the current window without regenerating", async () => {
    const { audio, player, requests, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].resolve(speech(4));
    await flush();
    const before = requests.length;
    player.seekToWord(5, { play: true });
    expect(audio.currentTime).toBeCloseTo(2, 5);
    expect(player.mode).toBe("playing");
    expect(requests.length).toBe(before);
  });

  it("pauses and resumes the same window", async () => {
    const { audio, player, requests, speech } = setup(["one"]);
    player.play();
    await flush();
    requests[0].resolve(speech(1));
    await flush();
    const src = audio.src;
    player.pause();
    expect(player.mode).toBe("paused");
    await flush();
    expect(player.mode).toBe("paused");
    player.play();
    expect(player.mode).toBe("playing");
    expect(audio.src).toBe(src);
  });

  it("keeps the listener's place when a voice preview interrupts playback", async () => {
    const { audio, player, requests, speech } = setup(["one", "two"]);
    player.play();
    await flush();
    requests[0].resolve(speech(4));
    await flush();
    audio.currentTime = 2;
    const preview = player.preview("A sample.");
    await flush();
    requests.at(-1).resolve(speech(1));
    await preview;
    audio.finish();
    await flush();
    expect(player.mode).toBe("paused");
    expect(player.positionWord()).toBeCloseTo(5, 5);
  });

  it("regenerates a passage whose cached audio cannot be read", async () => {
    const cache = { key: async (text) => text, get: async () => new ArrayBuffer(8), put: async () => {} };
    const { player, requests, speech } = setup(["one"], { cache });
    player.play();
    await flush();
    expect(requests.map((request) => request.text)).toEqual(["one"]);
    requests[0].resolve(speech(1));
    await flush();
    expect(player.mode).toBe("playing");
  });

  it("finishes after the last window", async () => {
    const { audio, player, requests, events, speech } = setup(["one"]);
    player.play();
    await flush();
    requests[0].resolve(speech(1));
    await flush();
    audio.finish();
    await flush();
    expect(player.mode).toBe("ended");
    expect(events.ended).toBe(1);
  });
});
