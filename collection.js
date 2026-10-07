import { collectionCatalogUrl } from "./collection-config.js";
import { parseEpubInWorker } from "./epub-client.js";
import { fetchWithTimeout } from "./fetch-utils.js";

const parsePdfLazily = async (bytes, options) => (await import("./pdf-import.js")).parsePdfBytes(bytes, options);

export const UNKNOWN_AUTHOR = "Unknown author";

const CATALOG_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const BOOK_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
// Hear's own import limits for EPUBs and PDFs.
const SIZE_LIMITS = { epub: 100 * 1024 * 1024, pdf: 50 * 1024 * 1024 };

let pendingCatalog = null;

function text(value, maxLength = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// Files and covers must live next to the catalog, so a catalog can never point
// Hear at an arbitrary host.
function sameOriginUrl(value, base) {
  if (!value) return "";
  try {
    const url = new URL(String(value), base);
    return /^https?:$/.test(url.protocol) && url.origin === new URL(base).origin ? url.href : "";
  } catch {
    return "";
  }
}

export function collectionItemFromEntry(entry, { label, catalogUrl, siteUrl }) {
  const id = String(entry?.id || "");
  const format = entry?.format === "pdf" || entry?.format === "epub" ? entry.format : "";
  const downloadUrl = sameOriginUrl(entry?.file, catalogUrl);
  const size = Math.max(0, Number(entry?.size) || 0);
  if (!BOOK_ID.test(id) || !format || !downloadUrl || entry.listenable === false || size > SIZE_LIMITS[format]) return null;
  const language = text(entry.language, 12).toLowerCase();
  return {
    id: `collection:${id}`,
    collectionId: id,
    source: "collection",
    sourceLabel: label,
    kind: entry.kind === "article" ? "article" : "book",
    format,
    title: text(entry.title, 300) || id.replaceAll("-", " "),
    author: text(entry.author, 300) || UNKNOWN_AUTHOR,
    description: text(entry.description),
    image: sameOriginUrl(entry.cover, catalogUrl),
    sourceUrl: `${siteUrl}#${encodeURIComponent(id)}`,
    downloadUrl,
    size,
    hash: text(entry.sha256, 64),
    categories: [entry.shelfLabel, ...(Array.isArray(entry.tags) ? entry.tags : []), ...(Array.isArray(entry.subjects) ? entry.subjects : [])]
      .map((value) => text(value, 120))
      .filter(Boolean),
    language: /^[a-z]{2,3}$/.test(language) ? language : "en",
  };
}

export function parseCollectionCatalog(payload, catalogUrl) {
  if (payload?.version !== 1 || !Array.isArray(payload.books)) {
    throw new Error("The collection’s catalog is not in a format Hear understands.");
  }
  const title = text(payload.title, 80) || "Collection";
  const siteUrl = sameOriginUrl(payload.url, catalogUrl) || new URL("./", catalogUrl).href;
  const items = payload.books
    .map((entry) => collectionItemFromEntry(entry, { label: title, catalogUrl, siteUrl }))
    .filter(Boolean);
  return {
    title,
    owner: text(payload.owner, 80),
    description: text(payload.description, 400),
    siteUrl,
    items,
    unavailableCount: payload.books.length - items.length,
  };
}

// One shared request per page load; a failed request is forgotten so the next
// caller can retry.
export function fetchCollection({ url = collectionCatalogUrl(), refresh = false } = {}) {
  if (!url) return Promise.reject(new Error("No collection is set up for this copy of Hear."));
  if (!refresh && pendingCatalog?.url === url) return pendingCatalog.promise;
  const promise = (async () => {
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" }, cache: "no-cache" }, CATALOG_TIMEOUT_MS)
      .catch(() => null);
    if (!response?.ok) throw new Error("The collection could not be reached.");
    return parseCollectionCatalog(await response.json(), response.url || url);
  })();
  pendingCatalog = { url, promise };
  promise.catch(() => {
    if (pendingCatalog?.promise === promise) pendingCatalog = null;
  });
  return promise;
}

export function findCollectionItem(collection, bookId) {
  return collection?.items.find((item) => item.collectionId === bookId) || null;
}

// Search uses Hear's catalog scorer so results rank like the public catalogs.
// A minimumScore of 30 asks for a title, author, or subject word rather than a
// stray word from a description.
export function collectionMatches(collection, query, scoreItem, minimumScore = 1) {
  if (!collection) return [];
  if (!query) return collection.items;
  return collection.items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => item);
}

// ── Hooks for main.js, which passes in its own scorer and renderers ─────────

// The collection as a catalog grid: matching items plus heading and status.
export async function collectionView(query, scoreItem) {
  const collection = await fetchCollection();
  const items = collectionMatches(collection, query, scoreItem);
  return {
    items,
    title: query ? `${collection.title}: “${query}”` : collection.title,
    status: collectionStatus(collection, items, query),
  };
}

// Collection books worth mixing into an "All" search.
export async function searchCollection(query, scoreItem) {
  return collectionMatches(await fetchCollection(), query, scoreItem, 30);
}

// The current catalog entry for a shared link, or null when unavailable.
export async function findCollectionBook(bookId) {
  return findCollectionItem(await fetchCollection().catch(() => null), bookId);
}

export async function setUpCollection() {
  const collection = await fetchCollection();
  if (collection.items.length) showCollectionSource(collection);
}

export function collectionStatus(collection, items, query) {
  if (!items.length) {
    return query ? `Nothing in ${collection.title} matches “${query}”.` : `${collection.title} has no books to listen to yet.`;
  }
  const unavailable = !query && collection.unavailableCount
    ? ` · ${collection.unavailableCount} more can be read on the shelf but not narrated`
    : "";
  return `${items.length} ${items.length === 1 ? "work" : "works"} from ${collection.title}${unavailable}`;
}

// Adds the collection to the catalog's sources (the collection-* elements in
// index.html). Its byline and shelf link show while that source is chosen.
export function showCollectionSource(collection) {
  const byId = (id) => document.getElementById(id);
  const deck = byId("collection-deck");
  const source = byId("collection-source");
  const footerLink = byId("footer-collection-link");
  byId("collection-eyebrow").textContent = collection.owner ? `Kept by ${collection.owner}` : "A personal library";
  deck.textContent = collection.description;
  deck.hidden = !collection.description;
  byId("collection-site-link").href = collection.siteUrl;
  footerLink.href = collection.siteUrl;
  footerLink.textContent = collection.title;
  byId("collection-source-label").textContent = collection.title;
  source.querySelector(".label-short").textContent = collection.title.split(/\s+/)[0];
  source.setAttribute("aria-label", collection.title);
  source.hidden = false;
  // Book searches include the collection; the Books tab reads data-books.
  const hint = byId("discovery-hint");
  const booksHint = `Searches ${collection.title}, Standard Ebooks, and Project Gutenberg.`;
  if (hint.textContent === hint.dataset.books) hint.textContent = booksHint;
  hint.dataset.books = booksHint;
}

export async function loadCollectionWork(item, onStatus = () => {}, {
  signal,
  parseEpub = parseEpubInWorker,
  parsePdf = parsePdfLazily,
} = {}) {
  onStatus(`Downloading from ${item.sourceLabel}`);
  const response = await fetchWithTimeout(item.downloadUrl, { signal }, DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`${item.title} could not be downloaded from ${item.sourceLabel}.`);
  const buffer = await response.arrayBuffer();
  const options = {
    key: item.id,
    title: item.title,
    author: item.author,
    description: item.description,
    image: item.image,
    language: item.language,
    kind: item.kind,
    source: "collection",
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    catalogItem: item,
  };
  onStatus(item.format === "pdf" ? "Extracting the PDF’s text on this device" : "Finding chapters and reading order");
  const work = item.format === "pdf"
    ? await parsePdf(new Uint8Array(buffer), { ...options, signal, onStatus })
    : await parseEpub(buffer, options, { signal, onStatus });
  // The catalog's metadata is curated by its owner, so it wins over whatever
  // the file itself claims; the resized catalog cover is also lighter to keep.
  return {
    ...work,
    title: item.title || work.title,
    author: item.author !== UNKNOWN_AUTHOR ? item.author : work.author,
    description: item.description || work.description,
    lang: item.language || work.lang,
    image: item.image || work.image,
    kind: item.kind,
    format: item.format,
  };
}
