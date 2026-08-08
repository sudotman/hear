import { parseEpubFiles } from "./library.js";

const EPUB_WORKER_TIMEOUT_MS = 90_000;

export function parseEpubInWorker(arrayBuffer, options = {}, { signal, onStatus = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./epub-worker.js", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
      callback(value);
    };
    const handleAbort = () => {
      const error = signal.reason instanceof Error ? signal.reason : new Error("EPUB import cancelled.");
      if (error.name === "Error") error.name = "AbortError";
      finish(reject, error);
    };
    const timer = setTimeout(() => {
      const error = new Error("That EPUB took too long to unpack.");
      error.name = "TimeoutError";
      finish(reject, error);
    }, EPUB_WORKER_TIMEOUT_MS);

    worker.addEventListener("message", (event) => {
      if (event.data.type === "status") {
        onStatus(event.data.message);
        return;
      }
      if (event.data.type === "error") {
        finish(reject, new Error(event.data.message));
        return;
      }
      if (event.data.type === "files") {
        onStatus("Reading chapters and navigation");
        try {
          finish(resolve, parseEpubFiles(event.data.files, options));
        } catch (error) {
          finish(reject, error);
        }
      }
    });
    worker.addEventListener("error", (event) => finish(reject, new Error(event.message || "The EPUB reader stopped unexpectedly.")));
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.postMessage({ buffer: arrayBuffer }, [arrayBuffer]);
  });
}
