import { standardCatalogSource } from "../standard-catalog-policy.js";

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
  const requestUrl = new URL(request.url);
  const source = standardCatalogSource({
    topic: requestUrl.searchParams.get("topic"),
    page: requestUrl.searchParams.get("page"),
    limit: requestUrl.searchParams.get("limit"),
  });
  if (!source) return errorResponse("Catalog request not allowed", 400);

  try {
    const upstream = await fetch(source, {
      headers: { Accept: "application/xhtml+xml" },
      redirect: "follow",
    });
    const type = upstream.headers.get("content-type") || "";
    const isHtml = type.toLocaleLowerCase().includes("text/html")
      || type.toLocaleLowerCase().includes("application/xhtml+xml");
    if (!upstream.ok || !isHtml) return errorResponse("Catalog unavailable", 502);
    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "public, max-age=900, s-maxage=3600",
        "Content-Type": type,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return errorResponse("Catalog unavailable", 502);
  }
}
