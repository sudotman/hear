import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLLECTION_URL, collectionCatalogUrl, isCollectionAssetUrl } from "../collection-config.js";
import {
  UNKNOWN_AUTHOR,
  fetchCollection,
  findCollectionItem,
  loadCollectionWork,
  parseCollectionCatalog,
} from "../collection.js";

const CATALOG_URL = "https://satyam.lol/shelf/catalog.json";

function book(overrides = {}) {
  return {
    id: "meditations",
    title: "Meditations",
    author: "Marcus Aurelius",
    description: "Notes to himself.",
    language: "en",
    format: "epub",
    kind: "book",
    file: "files/meditations.epub",
    cover: "covers/meditations.c2b77e9d.jpg",
    size: 733307,
    sha256: "c2b77e9d",
    shelfLabel: "Philosophy",
    tags: ["stoicism"],
    subjects: [],
    listenable: true,
    ...overrides,
  };
}

function catalog(books) {
  return { version: 1, title: "Satyam’s collection", owner: "Satyam", url: "https://satyam.lol/shelf/", books };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection catalog", () => {
  it("resolves files and covers next to the catalog", () => {
    const collection = parseCollectionCatalog(catalog([book()]), CATALOG_URL);
    expect(collection.title).toBe("Satyam’s collection");
    expect(collection.siteUrl).toBe("https://satyam.lol/shelf/");
    expect(collection.items[0]).toMatchObject({
      id: "collection:meditations",
      collectionId: "meditations",
      source: "collection",
      sourceLabel: "Satyam’s collection",
      downloadUrl: "https://satyam.lol/shelf/files/meditations.epub",
      image: "https://satyam.lol/shelf/covers/meditations.c2b77e9d.jpg",
      sourceUrl: "https://satyam.lol/shelf/#meditations",
      categories: ["Philosophy", "stoicism"],
    });
    expect(findCollectionItem(collection, "meditations")?.title).toBe("Meditations");
  });

  it("leaves out books Hear cannot open or that point elsewhere", () => {
    const collection = parseCollectionCatalog(catalog([
      book({ id: "scanned", format: "pdf", file: "files/scanned.pdf", listenable: false }),
      book({ id: "elsewhere", file: "https://example.com/book.epub" }),
      book({ id: "../escape" }),
      book({ id: "huge", format: "pdf", file: "files/huge.pdf", size: 80 * 1024 * 1024 }),
      book({ id: "odd", format: "mobi", file: "files/odd.mobi" }),
      book({ id: "fine", author: "", cover: "https://example.com/cover.jpg" }),
    ]), CATALOG_URL);
    expect(collection.items.map((item) => item.collectionId)).toEqual(["fine"]);
    expect(collection.unavailableCount).toBe(5);
    expect(collection.items[0].author).toBe(UNKNOWN_AUTHOR);
    expect(collection.items[0].image).toBe("");
  });

  it("rejects catalogs in an unknown format", () => {
    expect(() => parseCollectionCatalog({ version: 2, books: [] }, CATALOG_URL)).toThrow(/format/);
  });

  it("is configurable and can be turned off", () => {
    expect(collectionCatalogUrl({})).toBe(DEFAULT_COLLECTION_URL);
    expect(collectionCatalogUrl({ VITE_COLLECTION_URL: "http://localhost:4321/catalog.json" })).toBe("http://localhost:4321/catalog.json");
    expect(collectionCatalogUrl({ VITE_COLLECTION_URL: "off" })).toBe("");
    expect(isCollectionAssetUrl("https://satyam.lol/shelf/covers/a.jpg", CATALOG_URL)).toBe(true);
    expect(isCollectionAssetUrl("https://example.com/a.jpg", CATALOG_URL)).toBe(false);
  });

  it("shares one catalog request and retries after a failure", async () => {
    const url = "https://shelf.example/catalog.json";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify(catalog([book({ file: "files/meditations.epub" })]))));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCollection({ url })).rejects.toThrow(/could not be reached/);
    const [first, second] = await Promise.all([fetchCollection({ url }), fetchCollection({ url })]);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.items[0].downloadUrl).toBe("https://shelf.example/files/meditations.epub");
  });

  it("prefers the curated catalog metadata over the file's own", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const [item] = parseCollectionCatalog(catalog([book({ format: "pdf", kind: "article", file: "files/meditations.pdf", author: "" })]), CATALOG_URL).items;
    const parsePdf = vi.fn(async (bytes, options) => ({
      key: options.key,
      title: "Microsoft Word - draft.docx",
      author: "From the file",
      description: "",
      lang: "en",
      image: "",
      kind: options.kind,
      source: options.source,
      blocks: [],
    }));
    const work = await loadCollectionWork(item, () => {}, { parsePdf, parseEpub: vi.fn() });
    expect(parsePdf).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ key: "collection:meditations", source: "collection" }));
    expect(work).toMatchObject({
      key: "collection:meditations",
      title: "Meditations",
      author: "From the file",
      description: "Notes to himself.",
      image: "https://satyam.lol/shelf/covers/meditations.c2b77e9d.jpg",
      kind: "article",
      format: "pdf",
    });
  });
});
