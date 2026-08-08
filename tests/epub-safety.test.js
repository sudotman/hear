import { expect, test } from "vitest";
import { zipSync } from "fflate";
import { EPUB_LIMITS, inspectZipArchive } from "../epub-safety.js";

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("inspectZipArchive reads the central directory without expanding files", () => {
  const archive = zipSync({ "mimetype": new TextEncoder().encode("application/epub+zip") });
  const stats = inspectZipArchive(exactArrayBuffer(archive));
  expect(stats.entryCount).toBe(1);
  expect(stats.expandedBytes).toBeGreaterThan(0);
});

test("inspectZipArchive rejects an unsafe expansion ratio", () => {
  const archive = zipSync({ "chapter.xhtml": new Uint8Array(20_000) }, { level: 9 });
  expect(() => inspectZipArchive(exactArrayBuffer(archive), { ...EPUB_LIMITS, maxCompressionRatio: 2 }))
    .toThrow(/compression ratio is unsafe/);
});

test("inspectZipArchive rejects malformed input", () => {
  expect(() => inspectZipArchive(new ArrayBuffer(32))).toThrow(/not a readable EPUB/);
});
