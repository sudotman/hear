const COVER_HOSTS = new Set([
  "standardebooks.org",
  "www.standardebooks.org",
  "gutenberg.org",
  "www.gutenberg.org",
  "upload.wikimedia.org",
]);

export function allowedCoverUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && COVER_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function coverProxyPath(value) {
  const url = allowedCoverUrl(value);
  return url ? `/cover?url=${encodeURIComponent(url.href)}` : "";
}
