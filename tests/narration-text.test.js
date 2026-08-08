import { describe, expect, it } from "vitest";
import { segmentNarrationSentences } from "../narration-text.js";

describe("segmentNarrationSentences", () => {
  it("keeps a person's initials with the surrounding sentence", () => {
    expect(segmentNarrationSentences(
      "V. P. Menon was an Indian civil servant. He later became a constitutional adviser.",
      "en",
    )).toEqual([
      "V. P. Menon was an Indian civil servant.",
      "He later became a constitutional adviser.",
    ]);
  });

  it("keeps titles and longer initial sequences together", () => {
    expect(segmentNarrationSentences(
      "Dr. A. P. J. Abdul Kalam met V. P. Menon. Their work continued.",
      "en",
    )).toEqual([
      "Dr. A. P. J. Abdul Kalam met V. P. Menon.",
      "Their work continued.",
    ]);
  });
});
