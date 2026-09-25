import { describe, expect, it } from "vitest";
import { PAUSES_MS, createNeuralSegments } from "../neural-segments.js";
import { countWords } from "../narration-text.js";

function chunksFrom(entries) {
  let word = 0;
  return entries.map(([text, blockId, extra = {}]) => {
    const chunk = { text, blockId, startWord: word, wordCount: countWords(text), ...extra };
    word += chunk.wordCount;
    return chunk;
  });
}

describe("createNeuralSegments", () => {
  it("keeps word ranges contiguous across split long sentences", () => {
    const long = `${"The committee reviewed every proposal carefully, ".repeat(6)}and then it adjourned.`;
    const chunks = chunksFrom([["Title", null, { kind: "title" }], [long, "p1"], ["Next sentence here.", "p2"]]);
    const segments = createNeuralSegments(chunks);
    expect(segments.every((segment) => segment.text.length <= 220)).toBe(true);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].startWord).toBe(segments[index - 1].endWord);
    }
    const last = chunks.at(-1);
    expect(segments.at(-1).endWord).toBe(last.startWord + last.wordCount);
  });

  it("assigns pauses by structure", () => {
    const chunks = chunksFrom([
      ["A Title", null, { kind: "title" }],
      ["First sentence of the opening paragraph is here.", "p1"],
      ["Second sentence of the opening paragraph follows.", "p1"],
      ["Background.", "h1", { kind: "heading" }],
      ["A new paragraph begins after the heading here.", "p2"],
    ]);
    const segments = createNeuralSegments(chunks, { mergeShort: false });
    expect(segments.map((segment) => segment.pauseAfterMs)).toEqual([
      PAUSES_MS.afterTitle,
      PAUSES_MS.sentence,
      PAUSES_MS.beforeHeading,
      PAUSES_MS.afterHeading,
      0,
    ]);
  });

  it("merges very short sentences only when allowed and within a paragraph", () => {
    const chunks = chunksFrom([
      ["Yes.", "p1"],
      ["She had already decided to leave the house that night.", "p1"],
      ["No.", "p2"],
    ]);
    expect(createNeuralSegments(chunks).map((segment) => segment.text)).toEqual([
      "Yes. She had already decided to leave the house that night.",
      "No.",
    ]);
    expect(createNeuralSegments(chunks, { mergeShort: false })).toHaveLength(3);
  });
});
