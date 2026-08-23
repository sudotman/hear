import {
  arxivHtmlUrl,
  doiFromArticleUrl,
  normalizeDoi,
  normalizePublicArticleUrl,
} from "../article-policy.js";

const REQUEST_TIMEOUT_MS = 8_000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return response.json();
}

function formatArchiveDate(timestamp) {
  if (!/^\d{14}$/.test(timestamp || "")) return "Archived public snapshot";
  const date = new Date(Date.UTC(
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)) - 1,
    Number(timestamp.slice(6, 8)),
  ));
  return `Snapshot from ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function rawWaybackUrl(snapshotUrl, timestamp) {
  const normalized = normalizePublicArticleUrl(snapshotUrl);
  if (!normalized) return "";
  const url = new URL(normalized);
  if (url.hostname !== "web.archive.org") return "";
  url.protocol = "https:";
  url.pathname = url.pathname.replace(/^\/web\/\d+(?:[a-z_]+)?\//i, `/web/${timestamp}id_/`);
  return url.href;
}

async function findWaybackCopy(sourceUrl) {
  try {
    const endpoint = new URL("https://archive.org/wayback/available");
    endpoint.searchParams.set("url", sourceUrl);
    const payload = await fetchJson(endpoint.href);
    const snapshot = payload?.archived_snapshots?.closest;
    if (!snapshot?.available || String(snapshot.status) !== "200" || !/^\d{14}$/.test(snapshot.timestamp || "")) return null;
    const url = rawWaybackUrl(snapshot.url, snapshot.timestamp);
    if (!url) return null;
    return {
      kind: "archive",
      provider: "Internet Archive",
      label: "Open the archived article",
      detail: formatArchiveDate(snapshot.timestamp),
      url,
    };
  } catch {
    return null;
  }
}

async function findEuropePmcCopy(doi) {
  if (!doi) return null;
  try {
    const endpoint = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    endpoint.searchParams.set("query", `DOI:${doi}`);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("resultType", "core");
    endpoint.searchParams.set("pageSize", "1");
    const payload = await fetchJson(endpoint.href);
    const result = payload?.resultList?.result?.[0];
    if (!result || result.isOpenAccess !== "Y") return null;
    const locations = result.fullTextUrlList?.fullTextUrl || [];
    const html = locations.find((location) => (
      location.availabilityCode === "OA"
      && location.documentStyle === "html"
      && normalizePublicArticleUrl(location.url)
    ));
    if (!html) return null;
    return {
      kind: "open-access",
      provider: "Europe PMC",
      label: "Open the full research paper",
      detail: result.license ? `Open access · ${String(result.license).toUpperCase()}` : "Authorized open-access copy",
      title: result.title || "",
      url: normalizePublicArticleUrl(html.url),
    };
  } catch {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const sourceUrl = normalizePublicArticleUrl(requestUrl.searchParams.get("url"));
  if (!sourceUrl) return jsonResponse({ error: "Enter a public article URL" }, 400);

  const doi = normalizeDoi(requestUrl.searchParams.get("doi")) || doiFromArticleUrl(sourceUrl);
  const arxivUrl = arxivHtmlUrl(sourceUrl);
  const includeArchive = requestUrl.searchParams.get("archive") === "1";
  const tasks = [findEuropePmcCopy(doi)];
  if (includeArchive) tasks.push(findWaybackCopy(sourceUrl));
  const found = await Promise.all(tasks);
  const alternatives = [
    arxivUrl ? {
      kind: "open-access",
      provider: "arXiv",
      label: "Open the HTML research paper",
      detail: "Author-posted open-access copy",
      url: arxivUrl,
    } : null,
    ...found,
  ].filter(Boolean);

  const unique = alternatives.filter((alternative, index, all) => (
    all.findIndex((candidate) => candidate.url === alternative.url) === index
  ));
  return jsonResponse({ alternatives: unique });
}
