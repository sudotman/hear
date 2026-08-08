export const MODEL_CACHE_NAMES = ["kitten-cache", "transformers-cache", "kokoro-voices"];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function deriveLabel(cacheName, url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    // Prefer filename or last segments
    if (cacheName === "kokoro-voices") {
      const name = path.split("/").pop()?.replace(".bin", "") || "voice";
      return `Kitten/Kokoro voice · ${name}`;
    }
    if (url.includes("KittenTTS") || url.includes("kitten") || cacheName === "kitten-cache") {
      if (path.endsWith(".npz") || path.includes("voices")) return "Kitten voices.npz";
      if (path.endsWith("model.onnx") || path.includes("model")) return "Kitten model.onnx";
      if (path.endsWith("kitten_config.json")) return "Kitten kitten_config.json";
      if (path.endsWith("config.json")) return "Kitten config.json";
      // Generic HF file
      return `Kitten · ${path.split("/").pop() || url}`;
    }
    // transformers-cache: HF model files
    const file = path.split("/").pop() || "model file";
    // Try to infer model id from url
    const hfMatch = url.match(/huggingface\.co\/([^/]+\/[^/]+)\/resolve/);
    const model = hfMatch ? hfMatch[1] : "";
    const short = model ? `${model.split("/").pop()} · ` : "";
    return `Kokoro · ${short}${file}`;
  } catch {
    return url.slice(0, 80);
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    // Keep host + path without query
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

export async function getModelCacheEntries() {
  if (typeof caches === "undefined") return { available: false, entries: [], totalBytes: 0, byCache: {} };
  let entries = [];
  let totalBytes = 0;
  const byCache = {};
  for (const cacheName of MODEL_CACHE_NAMES) {
    let cache;
    try {
      cache = await caches.open(cacheName);
    } catch {
      continue;
    }
    let requests = [];
    try {
      requests = await cache.keys();
    } catch {
      continue;
    }
    byCache[cacheName] = { count: requests.length, bytes: 0, entries: [] };
    for (const request of requests) {
      const url = request.url;
      let size = 0;
      let label = deriveLabel(cacheName, url);
      try {
        const resp = await cache.match(request);
        if (resp) {
          const len = resp.headers.get("content-length");
          if (len) size = Number(len);
          else {
            // Fallback: read blob size (costy but accurate for opaque cached items)
            try {
              const blob = await resp.clone().blob();
              size = blob.size;
            } catch {}
          }
        }
      } catch {}
      totalBytes += size;
      byCache[cacheName].bytes += size;
      const entry = { cacheName, url, shortUrl: shortUrl(url), label, size, formattedSize: formatBytes(size) };
      entries.push(entry);
      byCache[cacheName].entries.push(entry);
    }
  }
  // Sort: Kitten first, then Kokoro, then by size desc
  entries.sort((a, b) => {
    const order = { "kitten-cache": 0, "transformers-cache": 1, "kokoro-voices": 2 };
    const oa = order[a.cacheName] ?? 99;
    const ob = order[b.cacheName] ?? 99;
    if (oa !== ob) return oa - ob;
    return b.size - a.size;
  });
  return { available: true, entries, totalBytes, totalFormatted: formatBytes(totalBytes), byCache };
}

export async function deleteCacheEntry(cacheName, url) {
  if (typeof caches === "undefined") throw new Error("CacheStorage not available");
  const cache = await caches.open(cacheName);
  const ok = await cache.delete(url);
  if (!ok) {
    // Try delete with Request object (some browsers store as Request)
    const keys = await cache.keys();
    for (const req of keys) {
      if (req.url === url) {
        await cache.delete(req);
        return true;
      }
    }
  }
  return ok;
}

export async function clearCacheByName(cacheName) {
  if (typeof caches === "undefined") throw new Error("CacheStorage not available");
  return caches.delete(cacheName);
}

export async function clearAllModelCaches() {
  if (typeof caches === "undefined") return { deleted: [], failed: MODEL_CACHE_NAMES };
  const deleted = [];
  const failed = [];
  for (const name of MODEL_CACHE_NAMES) {
    try {
      const ok = await caches.delete(name);
      // Even if ok false (not existent) treat as success
      deleted.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { deleted, failed };
}

export function formatBytesExport(bytes) { return formatBytes(bytes); }
