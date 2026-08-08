export function routeForWork(work, pathname = "/") {
  const params = new URLSearchParams();
  if (work?.source === "wikipedia") {
    params.set("lang", work.lang || "en");
    params.set("title", work.title);
  } else if (work?.source === "standard") {
    params.set("source", "standard");
    params.set("book", String(work.key || "").replace(/^standard:/, ""));
  } else if (work?.source === "gutenberg") {
    params.set("source", "gutenberg");
    params.set("book", String(work.key || "").replace(/^gutenberg:/, ""));
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function routeStateForWork(work) {
  return { view: "reader", work: work?.key || null };
}

export function libraryRouteState() {
  return { view: "library" };
}
