// Kept apart from collection.js so the main bundle only carries these checks;
// the catalog and download code loads on demand.

// A personal library published by https://github.com/sudotman/shelf. Any site
// that serves the same catalog.json shape (with CORS) can be hooked in by
// building Hear with VITE_COLLECTION_URL; "off" removes the section.
export const DEFAULT_COLLECTION_URL = "https://shelf.satyam.lol/catalog.json";

export function collectionCatalogUrl(env = import.meta.env) {
  const configured = String(env?.VITE_COLLECTION_URL ?? "").trim();
  if (configured.toLowerCase() === "off") return "";
  return configured || DEFAULT_COLLECTION_URL;
}

export function isCollectionAssetUrl(value, catalogUrl = collectionCatalogUrl()) {
  if (!catalogUrl) return false;
  try {
    return new URL(value).origin === new URL(catalogUrl).origin;
  } catch {
    return false;
  }
}
