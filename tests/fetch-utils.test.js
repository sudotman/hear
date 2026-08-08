import { afterEach, expect, test, vi } from "vitest";
import { fetchWithTimeout } from "../fetch-utils.js";

afterEach(() => vi.unstubAllGlobals());

function abortableFetch(_resource, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("fetchWithTimeout reports a useful timeout error", async () => {
  vi.stubGlobal("fetch", vi.fn(abortableFetch));
  await expect(fetchWithTimeout("https://example.test", {}, 5)).rejects.toMatchObject({
    name: "TimeoutError",
    message: "The request took too long. Try again in a moment.",
  });
});

test("fetchWithTimeout forwards caller cancellation", async () => {
  vi.stubGlobal("fetch", vi.fn(abortableFetch));
  const controller = new AbortController();
  const pending = fetchWithTimeout("https://example.test", { signal: controller.signal }, 1_000);
  controller.abort(new DOMException("Stopped", "AbortError"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
