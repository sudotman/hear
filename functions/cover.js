import { allowedCoverUrl } from "../cover-policy.js";

const MAX_COVER_BYTES = 8 * 1024 * 1024;

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

export async function onRequestGet({ request }) {
  const source = allowedCoverUrl(new URL(request.url).searchParams.get("url"));
  if (!source) return errorResponse("Cover URL not allowed", 400);

  try {
    const upstream = await fetch(source, {
      headers: { Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8" },
      redirect: "follow",
    });
    const resolved = allowedCoverUrl(upstream.url);
    const type = upstream.headers.get("content-type") || "";
    const declaredLength = Number(upstream.headers.get("content-length")) || 0;
    if (!upstream.ok || !resolved || !type.toLowerCase().startsWith("image/")) {
      return errorResponse("Cover unavailable", 502);
    }
    if (declaredLength > MAX_COVER_BYTES) return errorResponse("Cover is too large", 413);

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_COVER_BYTES) return errorResponse("Cover is too large", 413);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=2592000, immutable",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": type,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse("Cover unavailable", 502);
  }
}
