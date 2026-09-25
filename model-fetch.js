// Downloads model files with byte-level progress and keeps them in
// CacheStorage so later sessions load offline.

async function openCache(name) {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function readCached(cache, url, file, onProgress) {
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (!hit) return null;
    onProgress?.({ status: "cached", file, loaded: 0, total: 0, progress: 0, cached: true });
    const buffer = await hit.arrayBuffer();
    onProgress?.({ status: "cached", file, loaded: buffer.byteLength, total: buffer.byteLength, progress: 100, cached: true });
    return buffer;
  } catch {
    return null;
  }
}

async function writeCached(cache, url, buffer, responseHeaders) {
  if (!cache) return;
  try {
    const headers = new Headers(responseHeaders || {});
    if (!headers.has("content-length")) headers.set("content-length", String(buffer.byteLength));
    await cache.put(url, new Response(buffer, { headers }));
  } catch {}
}

export async function fetchModelFile(url, { cacheName, file, onProgress } = {}) {
  onProgress?.({ status: "progress", file, loaded: 0, total: 0, progress: 0 });
  const cache = await openCache(cacheName);
  const cached = await readCached(cache, url, file, onProgress);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${file} (${response.status}).`);
  const contentRangeTotal = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
  const total = [
    response.headers.get("content-length"),
    response.headers.get("x-linked-size"),
    response.headers.get("x-xet-content-length"),
    contentRangeTotal,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    writeCached(cache, url, buffer, response.headers);
    onProgress?.({ status: "progress", file, loaded: buffer.byteLength, total: buffer.byteLength, progress: 100 });
    return buffer;
  }
  const reader = response.body.getReader();
  let joined = new Uint8Array(total || 1024 * 1024);
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > joined.length) {
      const expanded = new Uint8Array(Math.max(loaded + value.length, joined.length * 2));
      expanded.set(joined.subarray(0, loaded));
      joined = expanded;
    }
    joined.set(value, loaded);
    loaded += value.length;
    const now = performance.now();
    if (now - lastReport >= 80) {
      lastReport = now;
      onProgress?.({ status: "progress", file, loaded, total, progress: total ? (loaded / total) * 100 : null });
    }
  }
  const buffer = loaded === joined.byteLength ? joined.buffer : joined.buffer.slice(0, loaded);
  // Persist in the background; the caller can start compiling right away.
  writeCached(cache, url, buffer, response.headers);
  onProgress?.({ status: "progress", file, loaded, total: loaded, progress: 100 });
  return buffer;
}
