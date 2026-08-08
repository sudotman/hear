import { describe, expect, it, vi } from "vitest";
import {
  selectLookaheadSegmentIndices,
  selectNeuralCacheEvictions,
  shareInFlight,
} from "../tts-scheduling.js";

describe("shareInFlight", () => {
  it("shares duplicate work and upgrades its priority", async () => {
    const work = new Map();
    const start = vi.fn(async () => "audio");
    const ownerPriorityUpgrade = vi.fn();
    const joiningPriorityUpgrade = vi.fn();

    const background = shareInFlight(work, "epoch:segment", {
      priority: 2,
      start,
      onPriorityUpgrade: ownerPriorityUpgrade,
    });
    const foreground = shareInFlight(work, "epoch:segment", {
      priority: 0,
      start,
      onPriorityUpgrade: joiningPriorityUpgrade,
    });

    expect(foreground).toBe(background);
    await expect(foreground).resolves.toBe("audio");
    expect(start).toHaveBeenCalledTimes(1);
    expect(ownerPriorityUpgrade).toHaveBeenCalledWith(0, 2);
    expect(joiningPriorityUpgrade).not.toHaveBeenCalled();
    expect(work.size).toBe(0);
  });
});

describe("selectLookaheadSegmentIndices", () => {
  it("fills an estimated time horizon without creating an unbounded queue", () => {
    const segments = Array.from({ length: 40 }, () => ({ wordCount: 10 }));
    expect(selectLookaheadSegmentIndices(segments, 3, 12)).toEqual([3, 4, 5, 6]);
    expect(selectLookaheadSegmentIndices(segments, 0, 600)).toHaveLength(24);
  });
});

describe("selectNeuralCacheEvictions", () => {
  it("keeps the current and nearest future segments", () => {
    const entries = Array.from({ length: 7 }, (_, index) => [
      `key-${index}`,
      { url: `blob:${index}`, segmentKey: String(index) },
    ]);
    expect(selectNeuralCacheEvictions(entries, {
      currentSegmentIndex: 2,
      currentAudioUrl: "blob:2",
      maxEntries: 4,
    })).toEqual(["key-0", "key-1", "key-6"]);
  });
});
