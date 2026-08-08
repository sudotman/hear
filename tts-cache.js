import { MAX_AUDIO_CACHE_BYTES, RETRY_AUDIO_CACHE_BYTES, selectAudioEvictions } from "./cache-policy.js";

const DB_NAME = "hearwiki-tts-cache";
const DB_VERSION = 2;
const STORE_NAME = "segments";

let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME, { keyPath: "key" });
        if (!store.indexNames.contains("lastAccessed")) store.createIndex("lastAccessed", "lastAccessed");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("The audio cache transaction was aborted."));
  });
}

async function allEntries(database) {
  const transaction = database.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const entries = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  await done;
  return entries;
}

export async function createAudioCacheKey({ text, model, voice, speed, dtype }) {
  const metadata = `${model}\u0000${voice}\u0000${speed}\u0000${dtype}\u0000${text}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metadata));
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${model}:${voice}:${speed}:${dtype}:${hash}`;
}

export async function getCachedAudio(key) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const entry = await requestResult(store.get(key));
  if (entry) store.put({ ...entry, lastAccessed: Date.now() });
  await done;
  return entry;
}

async function putAudioEntry(entry) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).put(entry);
  await done;
}

export async function pruneAudioCache(maxBytes = MAX_AUDIO_CACHE_BYTES) {
  const database = await openDatabase();
  const entries = await allEntries(database);
  const normalized = entries.map((entry) => ({
    ...entry,
    size: entry.size || entry.blob?.size || 0,
  }));
  const keys = selectAudioEvictions(normalized, maxBytes);
  if (keys.length) {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    keys.forEach((key) => store.delete(key));
    await done;
  }
  const removed = new Set(keys);
  const kept = normalized.filter((entry) => !removed.has(entry.key));
  return {
    count: kept.length,
    bytes: kept.reduce((sum, entry) => sum + entry.size, 0),
    removed: keys.length,
  };
}

export async function putCachedAudio({ key, blob, duration, createdAt = Date.now() }) {
  const entry = { key, blob, duration, createdAt, lastAccessed: createdAt, size: blob?.size || 0 };
  try {
    await putAudioEntry(entry);
  } catch (error) {
    if (error?.name !== "QuotaExceededError") throw error;
    await pruneAudioCache(RETRY_AUDIO_CACHE_BYTES);
    await putAudioEntry(entry);
  }
  await pruneAudioCache();
}

export async function clearTtsCache() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).clear();
  await done;
}

export async function deleteTtsDatabase() {
  if (databasePromise) {
    try {
      const db = await databasePromise;
      db.close();
    } catch {}
    databasePromise = null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

export async function getTtsCacheStats() {
  const database = await openDatabase();
  const entries = await allEntries(database);
  return entries.reduce((stats, entry) => {
    stats.count += 1;
    stats.bytes += entry.size || entry.blob?.size || 0;
    return stats;
  }, { count: 0, bytes: 0 });
}

export async function getTtsCacheCount() {
  return (await getTtsCacheStats()).count;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
