import { normalizePublicArticleUrl } from "../article-policy.js";

const MAX_ARTICLE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchArticleResponse(source) {
  let current = source;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "Accept-Language": "en,*;q=0.5",
        "User-Agent": "Hear article reader (+https://hear.satyam.lol)",
      },
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, source: current };
    if (redirect === MAX_REDIRECTS) throw new Error("Too many redirects");
    const next = normalizePublicArticleUrl(response.headers.get("location"), current);
    if (!next) throw new Error("Unsafe redirect");
    current = next;
  }
  throw new Error("Too many redirects");
}

async function readLimitedBody(response) {
  const declaredLength = Number(response.headers.get("content-length")) || 0;
  if (declaredLength > MAX_ARTICLE_BYTES) return null;
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARTICLE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

export async function onRequestGet({ request }) {
  const source = normalizePublicArticleUrl(new URL(request.url).searchParams.get("url"));
  if (!source) return errorResponse("Enter a public http or https article URL", 400);

  try {
    const { response: upstream, source: requestedSource } = await fetchArticleResponse(source);
    const resolvedSource = normalizePublicArticleUrl(upstream.url || requestedSource);
    const type = (upstream.headers.get("content-type") || "").toLowerCase();
    const isHtml = type.includes("text/html") || type.includes("application/xhtml+xml");
    if (!upstream.ok) return errorResponse("The publisher did not make this article available", 502);
    if (!resolvedSource) return errorResponse("The article redirected to a private address", 403);
    if (!isHtml) return errorResponse("That URL is not an HTML article", 415);

    const bytes = await readLimitedBody(upstream);
    if (!bytes) return errorResponse("That article is over the 3 MB import limit", 413);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Hear-Source-Url": encodeURIComponent(resolvedSource),
      },
    });
  } catch {
    return errorResponse("The publisher could not be reached", 502);
  }
}
