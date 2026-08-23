import { afterEach, expect, test, vi } from "vitest";
import { onRequestGet } from "../functions/article.js";

afterEach(() => vi.unstubAllGlobals());

test("returns bounded HTML from a public publisher without caching it", async () => {
  const upstream = vi.fn(async () => new Response("<html><article><p>Readable text.</p></article></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }));
  vi.stubGlobal("fetch", upstream);

  const response = await onRequestGet({
    request: new Request("https://hear.example/article?url=https%3A%2F%2Fjournal.example%2Fstory"),
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(decodeURIComponent(response.headers.get("x-hear-source-url"))).toBe("https://journal.example/story");
  expect(await response.text()).toContain("Readable text");
  expect(upstream).toHaveBeenCalledOnce();
});

test("rejects private targets before making a network request", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);

  const response = await onRequestGet({
    request: new Request("https://hear.example/article?url=http%3A%2F%2F127.0.0.1%2Fadmin"),
  });

  expect(response.status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

test("rejects non-HTML and oversized publisher responses", async () => {
  const responses = [
    new Response("not an article", { headers: { "Content-Type": "application/json" } }),
    new Response("too large", { headers: { "Content-Type": "text/html", "Content-Length": String(4 * 1024 * 1024) } }),
  ];
  vi.stubGlobal("fetch", vi.fn(async () => responses.shift()));
  const request = new Request("https://hear.example/article?url=https%3A%2F%2Fjournal.example%2Fstory");

  expect((await onRequestGet({ request })).status).toBe(415);
  expect((await onRequestGet({ request })).status).toBe(413);
});
