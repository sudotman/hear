import { countWords } from "./narration-text.js";

// Sentences are the unit of synthesis for both local models: short enough to
// start quickly after a seek, and each gets a fresh prosodic context (Kitten
// in particular runs adjacent sentences together otherwise).
const MAX_SEGMENT_CHARS = 220;
// Very short sentences ("Yes." "No.") are merged into a neighbour for models
// that handle multi-sentence input well; they sound clipped on their own.
const MIN_MERGE_CHARS = 48;

// Silence written into the audio after each segment, by what follows it.
export const PAUSES_MS = {
  afterTitle: 750,
  beforeHeading: 800,
  afterHeading: 480,
  verseLine: 260,
  paragraph: 420,
  sentence: 190,
  clause: 90,
};

const SENTENCE_END = /[.!?…]["”’')\]]*$/;

function splitForSynthesis(text, maxChars) {
  const pieces = [];
  let remainder = text.trim();
  while (remainder.length > maxChars) {
    const window = remainder.slice(0, maxChars + 1);
    const floor = Math.floor(maxChars * 0.45);
    let cut = -1;
    for (const separator of ["; ", ": ", " — ", " – ", ", "]) {
      const at = window.lastIndexOf(separator);
      if (at >= floor) {
        cut = at + separator.trimEnd().length;
        break;
      }
    }
    if (cut < 0) cut = window.lastIndexOf(" ");
    if (cut < floor) cut = maxChars;
    pieces.push(remainder.slice(0, cut).trim());
    remainder = remainder.slice(cut).trim();
  }
  if (remainder) pieces.push(remainder);
  return pieces;
}

function pauseBetween(segment, next) {
  if (!next) return 0;
  if (segment.kind === "title") return PAUSES_MS.afterTitle;
  if (next.kind === "heading") return PAUSES_MS.beforeHeading;
  if (segment.kind === "heading") return PAUSES_MS.afterHeading;
  if (next.lineBreakBefore) return PAUSES_MS.verseLine;
  if (next.blockId !== segment.blockId) return PAUSES_MS.paragraph;
  return segment.endsSentence ? PAUSES_MS.sentence : PAUSES_MS.clause;
}

/**
 * Turns narration chunks (sentences with word ranges) into synthesis
 * segments. Word ranges tile the chunks exactly so playback position maps
 * back onto the text.
 */
export function createNeuralSegments(chunks, { mergeShort = true, maxChars = MAX_SEGMENT_CHARS } = {}) {
  const segments = [];
  chunks.forEach((chunk, chunkIndex) => {
    const pieces = splitForSynthesis(chunk.text, maxChars);
    const chunkEnd = chunk.startWord + chunk.wordCount;
    let word = chunk.startWord;
    pieces.forEach((piece, pieceIndex) => {
      const last = pieceIndex === pieces.length - 1;
      const endWord = last ? chunkEnd : Math.min(chunkEnd, word + countWords(piece));
      const segment = {
        text: piece,
        startWord: word,
        endWord,
        wordCount: Math.max(0, endWord - word),
        startChunk: chunkIndex,
        blockId: chunk.blockId,
        kind: chunk.kind || "text",
        lineBreakBefore: pieceIndex === 0 && !!chunk.lineBreak,
        endsSentence: last && SENTENCE_END.test(piece),
      };
      word = endWord;

      const previous = segments.at(-1);
      const canMerge = mergeShort &&
        previous &&
        previous.kind === "text" &&
        segment.kind === "text" &&
        previous.blockId === segment.blockId &&
        !segment.lineBreakBefore &&
        (previous.text.length < MIN_MERGE_CHARS || segment.text.length < MIN_MERGE_CHARS) &&
        previous.text.length + 1 + segment.text.length <= maxChars;
      if (canMerge) {
        previous.text = `${previous.text} ${segment.text}`;
        previous.endWord = segment.endWord;
        previous.wordCount = previous.endWord - previous.startWord;
        previous.endsSentence = segment.endsSentence;
        return;
      }
      segments.push(segment);
    });
  });
  segments.forEach((segment, index) => {
    segment.pauseAfterMs = pauseBetween(segment, segments[index + 1]);
  });
  return segments;
}
