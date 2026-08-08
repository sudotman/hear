const PROTECTED_PERIOD = "\uE000";

function splitLongText(text, maxLength = 320) {
  if (text.length <= maxLength) return [text];

  const pieces = [];
  let remainder = text;

  while (remainder.length > maxLength) {
    const window = remainder.slice(0, maxLength + 1);
    const breakAt = Math.max(
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    );
    const index = breakAt > maxLength * 0.55 ? breakAt + 1 : maxLength;
    pieces.push(remainder.slice(0, index).trim());
    remainder = remainder.slice(index).trim();
  }

  if (remainder) pieces.push(remainder);
  return pieces;
}

function protectNameAbbreviations(text) {
  return text
    .replace(
      /\b(?:[\p{Lu}]\.\s*){2,}(?=[\p{Lu}][\p{L}\p{M}'’\-]*)/gu,
      (initials) => initials.replaceAll(".", PROTECTED_PERIOD),
    )
    .replace(
      /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.(?=\s+[\p{Lu}])/gu,
      (title) => title.replace(".", PROTECTED_PERIOD),
    );
}

function restoreNameAbbreviations(text) {
  return text.replaceAll(PROTECTED_PERIOD, ".");
}

export function segmentNarrationSentences(text, lang) {
  const protectedText = protectNameAbbreviations(text);
  let sentences;

  if ("Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
      sentences = [...segmenter.segment(protectedText)]
        .map(({ segment }) => restoreNameAbbreviations(segment).trim())
        .filter(Boolean);
    } catch {
      sentences = null;
    }
  }

  if (!sentences?.length) {
    sentences = protectedText
      .match(/[^.!?]+(?:[.!?]+[”’"']?|$)/g)
      ?.map((item) => restoreNameAbbreviations(item).trim())
      .filter(Boolean) || [text];
  }

  return sentences.flatMap((sentence) => splitLongText(sentence));
}
