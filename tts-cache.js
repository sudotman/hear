const DB_NAME = "hearwiki-tts-cache";
const DB_VERSION = 1;
const STORE_NAME = "segments";

let databasePromise;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
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

export async function createAudioCacheKey({ text, model, voice, speed, dtype }) {
  const metadata = `${model}\u0000${voice}\u0000${speed}\u0000${dtype}\u0000${text}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metadata));
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${model}:${voice}:${speed}:${dtype}:${hash}`;
}

export async function getCachedAudio(key) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  return requestResult(transaction.objectStore(STORE_NAME).get(key));
}

export async function putCachedAudio({ key, blob, duration, createdAt = Date.now() }) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).put({ key, blob, duration, createdAt }));
}

export async function clearTtsCache() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  await requestResult(transaction.objectStore(STORE_NAME).clear());
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

export async function getTtsCacheCount() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  if ("count" in store) return requestResult(store.count());
  return requestResult(store.getAllKeys()).then((keys) => keys.length);
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
