import { expect, test } from "vitest";
import { selectAudioEvictions } from "../cache-policy.js";

test("audio eviction removes least recently used entries until under budget", () => {
  const entries = [
    { key: "old", size: 60, lastAccessed: 1 },
    { key: "middle", size: 50, lastAccessed: 2 },
    { key: "new", size: 40, lastAccessed: 3 },
  ];
  expect(selectAudioEvictions(entries, 100)).toEqual(["old"]);
  expect(selectAudioEvictions(entries, 45)).toEqual(["old", "middle"]);
});
