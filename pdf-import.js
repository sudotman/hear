import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const EXCLUDED_HEADINGS = new Set([
  "references",
  "bibliography",
  "works cited",
  "endnotes",
  "supplementary material",
]);

function median(values) {
  if (!values.length) return 12;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function cleanPdfText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\[(?:\d+[\s,;–—-]*)+\]/g, "")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizedHeading(value) {
  return cleanPdfText(value)
    .replace(/^\d+(?:\.\d+)*\s+/, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .toLowerCase();
}

function joinTextItems(items) {
  let text = "";
  let previousEnd = null;
  let previousSize = 12;
  items.forEach((item) => {
    const value = String(item.str || "");
    if (!value) return;
    const x = Number(item.transform?.[4]) || 0;
    const size = Math.max(1, Math.abs(Number(item.transform?.[3])) || Number(item.height) || 12);
    const gap = previousEnd === null ? 0 : x - previousEnd;
    const needsSpace = text && !/\s$/.test(text) && !/^\s/.test(value) && gap > Math.max(1.5, previousSize * 0.15);
    text += `${needsSpace ? " " : ""}${value}`;
    previousEnd = x + (Number(item.width) || 0);
    previousSize = size;
  });
  return cleanPdfText(text);
}

function pageSegments(textContent, viewport, pageNumber) {
  const rows = [];
  const textItems = textContent.items.filter((item) => typeof item.str === "string" && item.str.trim());
  textItems.forEach((item) => {
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    const size = Math.max(1, Math.abs(Number(item.transform?.[3])) || Number(item.height) || 12);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.max(2, size * 0.34));
    if (!row) {
      row = { y, size, items: [] };
      rows.push(row);
    }
    row.items.push({ ...item, x, y, size });
    row.size = Math.max(row.size, size);
  });

  const segments = [];
  rows.forEach((row) => {
    row.items.sort((left, right) => left.x - right.x);
    let group = [];
    const commit = () => {
      if (!group.length) return;
      const text = joinTextItems(group);
      const xMin = Math.min(...group.map((item) => item.x));
      const xMax = Math.max(...group.map((item) => item.x + (Number(item.width) || 0)));
      const size = median(group.map((item) => item.size));
      const inPageFurniture = pageNumber > 1
        && (row.y < viewport.height * 0.035 || row.y > viewport.height * 0.965)
        && text.length < 120;
      if (text && !inPageFurniture && !/^\d{1,4}$/.test(text)) {
        segments.push({ text, xMin, xMax, y: row.y, size, column: "full" });
      }
      group = [];
    };

    row.items.forEach((item) => {
      const previous = group.at(-1);
      const gap = previous ? item.x - (previous.x + (Number(previous.width) || 0)) : 0;
      if (previous && gap > Math.max(viewport.width * 0.03, row.size * 2)) commit();
      group.push(item);
    });
    commit();
  });

  return orderPageSegments(segments, viewport.width);
}

function orderPageSegments(segments, pageWidth) {
  const midpoint = pageWidth / 2;
  const margin = pageWidth * 0.035;
  const left = segments.filter((segment) => segment.xMax < midpoint + margin);
  const right = segments.filter((segment) => segment.xMin > midpoint - margin);
  const usesColumns = left.length >= 5 && right.length >= 5 && left.length + right.length >= segments.length * 0.58;
  const byReadingLine = (a, b) => b.y - a.y || a.xMin - b.xMin;
  if (!usesColumns) return segments.sort(byReadingLine);

  const columnCandidates = [...left, ...right];
  const top = Math.max(...columnCandidates.map((segment) => segment.y));
  const bottom = Math.min(...columnCandidates.map((segment) => segment.y));
  const above = segments.filter((segment) => segment.y > top + segment.size).sort(byReadingLine);
  const below = segments.filter((segment) => segment.y < bottom - segment.size).sort(byReadingLine);
  const inColumns = segments.filter((segment) => !above.includes(segment) && !below.includes(segment));
  const leftColumn = inColumns
    .filter((segment) => (segment.xMin + segment.xMax) / 2 < midpoint)
    .map((segment) => ({ ...segment, column: "left" }))
    .sort(byReadingLine);
  const rightColumn = inColumns
    .filter((segment) => (segment.xMin + segment.xMax) / 2 >= midpoint)
    .map((segment) => ({ ...segment, column: "right" }))
    .sort(byReadingLine);
  return [...above, ...leftColumn, ...rightColumn, ...below];
}

function appendLine(current, next) {
  if (!current) return next;
  if (/-$/.test(current) && /^\p{Ll}/u.test(next)) return `${current.slice(0, -1)}${next}`;
  return `${current} ${next}`;
}

function blocksFromSegments(segments, blockOffset, sectionState) {
  const blocks = [];
  const bodySize = median(segments.map((segment) => segment.size).filter((size) => size > 4 && size < 40));
  let paragraph = "";
  let previous = null;

  const addBlock = (type, text) => {
    const cleaned = cleanPdfText(text);
    if (!cleaned || (type === "p" && cleaned.length < 18)) return;
    const index = blockOffset + blocks.length;
    if (type === "h2") {
      sectionState.name = cleaned;
      sectionState.id = `section-${index}`;
    }
    blocks.push({
      id: type === "h2" ? sectionState.id : `block-${index}`,
      type,
      text: cleaned,
      section: sectionState.name,
      sectionId: sectionState.id,
    });
  };
  const commitParagraph = () => {
    addBlock("p", paragraph);
    paragraph = "";
  };

  for (const segment of segments) {
    const headingText = normalizedHeading(segment.text);
    const numberedHeading = /^\d+(?:\.\d+)*\s+[\p{Lu}]/u.test(segment.text);
    const isHeading = segment.text.length <= 180 && (
      segment.size >= bodySize * 1.24
      || numberedHeading
      || (/^[\p{Lu}\d][\p{Lu}\d\s:,-]{3,}$/u.test(segment.text) && segment.text.length < 90)
    );
    if (isHeading && EXCLUDED_HEADINGS.has(headingText)) {
      commitParagraph();
      sectionState.skipRest = true;
      break;
    }
    if (sectionState.skipRest) break;
    if (isHeading) {
      commitParagraph();
      const previousBlock = blocks.at(-1);
      const headingGap = previous ? Math.abs(previous.y - segment.y) : Infinity;
      const continuesHeading = previousBlock?.type === "h2"
        && previous
        && previous.column === segment.column
        && headingGap <= Math.max(bodySize * 3.8, segment.size * 2.1)
        && Math.abs(previous.size - segment.size) <= Math.max(2, segment.size * 0.22)
        && !/^\d+(?:\.\d+)*\s+/u.test(segment.text);
      if (continuesHeading) {
        previousBlock.text = cleanPdfText(`${previousBlock.text} ${segment.text}`);
        sectionState.name = previousBlock.text;
      } else {
        addBlock("h2", segment.text);
      }
      previous = segment;
      continue;
    }

    const verticalGap = previous ? Math.abs(previous.y - segment.y) : 0;
    const changedColumn = previous && previous.column !== segment.column;
    const startsNewParagraph = paragraph && previous && (
      changedColumn
      || verticalGap > Math.max(bodySize * 1.65, previous.size * 1.5)
      || (Math.abs(previous.xMin - segment.xMin) > bodySize * 1.4 && /[.!?]$/.test(paragraph))
    );
    if (startsNewParagraph) commitParagraph();
    paragraph = appendLine(paragraph, segment.text);
    previous = segment;
  }
  commitParagraph();
  return blocks;
}

function metadataValue(metadata, info, key, fallback = "") {
  const metadataKeys = {
    Title: "dc:title",
    Author: "dc:creator",
    Subject: "dc:description",
    Language: "dc:language",
  };
  return cleanPdfText(metadata?.get?.(metadataKeys[key]) || info?.[key] || fallback);
}

export async function parsePdfFile(file, { signal, onStatus } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false });
  const abort = () => loadingTask.destroy();
  signal?.addEventListener("abort", abort, { once: true });
  let pdf = null;

  try {
    onStatus?.("Reading PDF structure");
    pdf = await loadingTask.promise;
    if (pdf.numPages > 500) throw new Error("That PDF has over 500 pages. Split it into a smaller document first.");
    const metadataResult = await pdf.getMetadata().catch(() => ({ info: {}, metadata: null }));
    const titleFallback = file.name.replace(/\.pdf$/i, "").replaceAll(/[_-]+/g, " ").trim() || "Imported PDF";
    const metadataTitle = metadataValue(metadataResult.metadata, metadataResult.info, "Title");
    const author = metadataValue(metadataResult.metadata, metadataResult.info, "Author");
    const subject = metadataValue(metadataResult.metadata, metadataResult.info, "Subject");
    const language = metadataValue(metadataResult.metadata, metadataResult.info, "Language", "en") || "en";
    const blocks = [];
    const sectionState = { name: "Opening", id: "introduction", skipRest: false };

    for (let pageNumber = 1; pageNumber <= pdf.numPages && !sectionState.skipRest; pageNumber += 1) {
      if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      onStatus?.(`Extracting page ${pageNumber}/${pdf.numPages} [local PDF]`);
      const page = await pdf.getPage(pageNumber);
      try {
        const [textContent, viewport] = await Promise.all([
          page.getTextContent({ disableNormalization: false }),
          Promise.resolve(page.getViewport({ scale: 1 })),
        ]);
        const segments = pageSegments(textContent, viewport, pageNumber);
        blocks.push(...blocksFromSegments(segments, blocks.length, sectionState));
      } finally {
        page.cleanup();
      }
    }

    const inferredTitleBlock = !metadataTitle && blocks[0]?.type === "h2" ? blocks[0] : null;
    const title = metadataTitle || inferredTitleBlock?.text || titleFallback;
    if (inferredTitleBlock) {
      blocks.shift();
      blocks.forEach((block) => {
        if (block.sectionId !== inferredTitleBlock.id) return;
        block.section = "Opening";
        block.sectionId = "introduction";
      });
    }

    const textLength = blocks.reduce((total, block) => total + block.text.length, 0);
    if (textLength < 240) {
      throw new Error("This PDF does not contain enough selectable text. It may be a scanned document.");
    }
    return {
      key: `local-pdf:${file.name}:${file.size}:${file.lastModified}`,
      kind: "article",
      source: "local",
      sourceLabel: "My PDF",
      sourceUrl: "",
      title,
      author: author || "Imported document",
      description: cleanPdfText(`${author ? `${author}. ` : ""}${subject || "A PDF prepared privately on this device."}`),
      image: "",
      lang: language,
      catalogItem: null,
      blocks,
    };
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new Error("This PDF is password-protected. Remove the password and import it again.");
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await (pdf?.destroy?.() || loadingTask.destroy()).catch(() => {});
  }
}
