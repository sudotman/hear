const DEFAULT_WORDS_PER_MINUTE = 170;

export function shareInFlight(map, key, { priority, start, onPriorityUpgrade } = {}) {
  const existing = map.get(key);
  if (existing) {
    if (Number.isFinite(priority) && priority < existing.priority) {
      const previousPriority = existing.priority;
      existing.priority = priority;
      try {
        existing.onPriorityUpgrade?.(priority, previousPriority);
      } catch {}
    }
    return existing.promise;
  }

  const entry = {
    priority: Number.isFinite(priority) ? priority : 2,
    onPriorityUpgrade,
    promise: null,
  };
  entry.promise = Promise.resolve()
    .then(() => start(entry))
    .finally(() => {
      if (map.get(key) === entry) map.delete(key);
    });
  map.set(key, entry);
  return entry.promise;
}

export function estimateSegmentDuration(segment, wordsPerMinute = DEFAULT_WORDS_PER_MINUTE) {
  const words = Math.max(1, Number(segment?.wordCount) || 1);
  return Math.max(1.5, (words / Math.max(1, wordsPerMinute)) * 60);
}

export function selectLookaheadSegmentIndices(
  segments,
  startIndex,
  targetSeconds,
  { maxSegments = 24, wordsPerMinute = DEFAULT_WORDS_PER_MINUTE } = {},
) {
  const indices = [];
  let estimatedSeconds = 0;
  for (
    let index = Math.max(0, startIndex);
    index < segments.length && indices.length < maxSegments && estimatedSeconds < targetSeconds;
    index += 1
  ) {
    indices.push(index);
    estimatedSeconds += estimateSegmentDuration(segments[index], wordsPerMinute);
  }
  return indices;
}

export function selectNeuralCacheEvictions(
  entries,
  { currentSegmentIndex = 0, currentAudioUrl = "", maxEntries = 16 } = {},
) {
  if (entries.length <= maxEntries) return [];
  const candidates = entries
    .filter(([, entry]) => entry.url !== currentAudioUrl)
    .map(([key, entry]) => {
      const segmentIndex = Number.parseInt(entry.segmentKey, 10);
      let score;
      if (!Number.isInteger(segmentIndex)) score = 40_000;
      else if (segmentIndex < currentSegmentIndex) score = 30_000 + currentSegmentIndex - segmentIndex;
      else score = segmentIndex - currentSegmentIndex;
      return { key, score };
    })
    .sort((left, right) => right.score - left.score);
  return candidates.slice(0, Math.max(0, entries.length - maxEntries)).map(({ key }) => key);
}
