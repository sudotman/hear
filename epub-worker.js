import { unzipSync } from "fflate";
import { inspectZipArchive } from "./epub-safety.js";

self.addEventListener("message", (event) => {
  try {
    const stats = inspectZipArchive(event.data.buffer);
    self.postMessage({ type: "status", message: `Unpacking ${stats.entryCount.toLocaleString()} EPUB files` });
    const files = unzipSync(new Uint8Array(event.data.buffer));
    const transfers = [...new Set(Object.values(files).map((value) => value.buffer))];
    self.postMessage({ type: "files", files, stats }, transfers);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "That EPUB could not be unpacked." });
  }
});
