const STANDARD_CATALOG_TOPICS = new Set([
  "adventure",
  "fiction",
  "mystery",
  "philosophy",
  "poetry",
  "shorts",
]);

export function standardCatalogSource({ topic, page = 1, limit = 18 } = {}) {
  const cleanTopic = String(topic || "").toLocaleLowerCase();
  const cleanPage = Number.parseInt(page, 10);
  const cleanLimit = Number.parseInt(limit, 10);
  if (!STANDARD_CATALOG_TOPICS.has(cleanTopic)) return null;
  if (!Number.isInteger(cleanPage) || cleanPage < 1 || cleanPage > 100) return null;
  if (!Number.isInteger(cleanLimit) || cleanLimit < 1 || cleanLimit > 48) return null;
  const url = new URL(`/subjects/${cleanTopic}`, "https://standardebooks.org");
  url.searchParams.set("sort", "popularity");
  url.searchParams.set("per-page", String(cleanLimit));
  url.searchParams.set("page", String(cleanPage));
  return url;
}

export function standardCatalogProxyPath(options) {
  const source = standardCatalogSource(options);
  if (!source) return "";
  return `/catalog?topic=${encodeURIComponent(options.topic)}&page=${encodeURIComponent(options.page || 1)}&limit=${encodeURIComponent(options.limit || 18)}`;
}
