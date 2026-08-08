export const EPUB_LIMITS = Object.freeze({
  maxCompressedBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 300 * 1024 * 1024,
  maxEntries: 5_000,
  maxCompressionRatio: 250,
});

export function inspectZipArchive(buffer, limits = EPUB_LIMITS) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError("EPUB data must be an ArrayBuffer.");
  if (buffer.byteLength > limits.maxCompressedBytes) throw new Error("That EPUB is larger than the 100 MB import limit.");
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let endOffset = -1;
  const lowerBound = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("That file is not a readable EPUB archive.");

  const entryCount = view.getUint16(endOffset + 10, true);
  if (entryCount > limits.maxEntries) throw new Error("That EPUB contains too many files to import safely.");
  let offset = view.getUint32(endOffset + 16, true);
  let expandedBytes = 0;
  let compressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("That EPUB has a damaged file directory.");
    }
    compressedBytes += view.getUint32(offset + 20, true);
    expandedBytes += view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (expandedBytes > limits.maxExpandedBytes) throw new Error("That EPUB expands beyond the 300 MB safety limit.");
  if (compressedBytes > 0 && expandedBytes / compressedBytes > limits.maxCompressionRatio) {
    throw new Error("That EPUB’s compression ratio is unsafe to open.");
  }
  return { entryCount, expandedBytes, compressedBytes };
}
