import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGutenbergCatalog, gutenbergItemFromGutendex } from "../library.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Project Gutenberg catalog", () => {
  it("maps Gutendex metadata into Hear library items", () => {
    expect(gutenbergItemFromGutendex({
      id: 1727,
      title: "The Odyssey",
      authors: [{ name: "Butler, Samuel" }],
      summaries: ["An ancient voyage home."],
      bookshelves: ["Classics"],
      subjects: ["Epic poetry"],
      languages: ["en"],
      formats: { "image/jpeg": "https://example.com/cover.jpg" },
    })).toEqual({
      id: "gutenberg:1727",
      gutenbergId: "1727",
      source: "gutenberg",
      sourceLabel: "Project Gutenberg",
      title: "The Odyssey",
      author: "Samuel Butler",
      description: "An ancient voyage home.",
      image: "https://example.com/cover.jpg",
      sourceUrl: "https://www.gutenberg.org/ebooks/1727",
      downloadUrl: "",
      categories: ["Classics", "Epic poetry"],
      language: "en",
    });
  });

  it("uses the CORS-readable JSON catalog instead of Gutenberg OPDS", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ id: 1727, title: "The Odyssey", authors: [{ name: "Homer" }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGutenbergCatalog({ query: "odyssey", page: 2 })).resolves.toMatchObject([
      { id: "gutenberg:1727", title: "The Odyssey", author: "Homer" },
    ]);

    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.origin).toBe("https://gutendex.com");
    expect(requested.pathname).toBe("/books/");
    expect(requested.searchParams.get("search")).toBe("odyssey");
    expect(requested.searchParams.get("page")).toBe("2");
    const subjectRequest = new URL(fetchMock.mock.calls[1][0]);
    expect(subjectRequest.searchParams.get("topic")).toBe("odyssey");
    expect(subjectRequest.searchParams.has("search")).toBe(false);
  });

  it("uses the subject index directly for category browsing", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchGutenbergCatalog({ topic: "mystery", page: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.searchParams.get("topic")).toBe("mystery");
    expect(requested.searchParams.has("search")).toBe(false);
  });
});
