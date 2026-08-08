export const MAX_AUDIO_CACHE_BYTES = 256 * 1024 * 1024;
export const RETRY_AUDIO_CACHE_BYTES = 160 * 1024 * 1024;

export function selectAudioEvictions(entries, maxBytes = MAX_AUDIO_CACHE_BYTES) {
  const normalized = entries.map((entry) => ({
    key: entry.key,
    size: Math.max(0, Number(entry.size) || 0),
    lastAccessed: Number(entry.lastAccessed || entry.createdAt) || 0,
  }));
  let totalBytes = normalized.reduce((sum, entry) => sum + entry.size, 0);
  if (totalBytes <= maxBytes) return [];

  const evictions = [];
  normalized.sort((left, right) => left.lastAccessed - right.lastAccessed);
  for (const entry of normalized) {
    evictions.push(entry.key);
    totalBytes -= entry.size;
    if (totalBytes <= maxBytes) break;
  }
  return evictions;
}
