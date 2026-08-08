import { fetchWithTimeout } from "./fetch-utils.js";

const STANDARD_ORIGIN = "https://standardebooks.org";
const GUTENBERG_ORIGIN = "https://www.gutenberg.org";
const GUTENDEX_ORIGIN = "https://gutendex.com";
const WORK_CACHE = "hear-work-cache";
const WORK_STORE = "works";
const CACHE_VERSION = 6;
const decoder = new TextDecoder();

function xmlDocument(text) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The publication metadata could not be read.");
  return document;
}

function localElements(root, name) {
  return [...root.getElementsByTagNameNS("*", name)];
}

function localElement(root, name) {
  return localElements(root, name)[0] || null;
}

function directLocalElement(root, name) {
  return [...root.children].find((node) => node.localName === name) || null;
}

function directLocalElements(root, name) {
  return [...root.children].filter((node) => node.localName === name);
}

function nodeText(node, fallback = "") {
  return (node?.textContent || fallback).replace(/\s+/g, " ").trim();
}

function cleanPublicationText(value) {
  return String(value || "")
    .replace(/\u00ad/g, "")
    .replace(/\[(?:\d+|note\s+\d+|return)\]/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[\t\n\r ]+/g, " ")
    .trim();
}

function cleanPublicationTextPreserveLines(value) {
  const normalized = String(value || "")
    .replace(/\u00ad/g, "")
    .replace(/\[(?:\d+|note\s+\d+|return)\]/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  // Split on newlines, clean each segment, then rejoin preserving single vs double breaks.
  const parts = normalized.split(/(\n+)/);
  return parts
    .map((part) => {
      if (/^\n+$/.test(part)) {
        // collapse 3+ newlines to double, keep 1-2 as-is
        return part.length >= 3 ? "\n\n" : part;
      }
      const cleaned = cleanPublicationText(part);
      return cleaned;
    })
    .join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function elementTextWithLineBreaks(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  // Preserve block-level separators that DOMParser may flatten: some EPUBs use <span> with line breaks
  return clone.textContent || "";
}

function textFromMarkup(value) {
  const text = String(value || "");
  if (!/[<>]/.test(text)) return cleanPublicationText(text);
  const document = new DOMParser().parseFromString(text, "text/html");
  return cleanPublicationText(document.body.textContent);
}

function absoluteUrl(href, origin) {
  if (!href) return "";
  return new URL(href, origin).href;
}

function parseStandardEntries(text) {
  const document = xmlDocument(text);
  return localElements(document, "entry").map((entry) => {
    const links = localElements(entry, "link");
    const compatibleEpub = links.find((link) => (
      link.getAttribute("rel") === "enclosure" &&
      link.getAttribute("type") === "application/epub+zip" &&
      !/advanced/i.test(link.getAttribute("title") || "")
    ));
    const alternate = links.find((link) => link.getAttribute("rel") === "alternate");
    const thumbnail = localElement(entry, "thumbnail");
    const author = directLocalElement(entry, "author");
    const sourceUrl = absoluteUrl(nodeText(directLocalElement(entry, "id")), STANDARD_ORIGIN);
    const categories = localElements(entry, "category")
      .map((category) => category.getAttribute("term"))
      .filter(Boolean);

    return {
      id: `standard:${sourceUrl.replace(`${STANDARD_ORIGIN}/ebooks/`, "")}`,
      source: "standard",
      sourceLabel: "Standard Ebooks",
      title: nodeText(directLocalElement(entry, "title"), "Untitled"),
      author: nodeText(directLocalElement(author, "name"), "Unknown author"),
      description: nodeText(directLocalElement(entry, "summary"), "A carefully produced public-domain edition."),
      image: absoluteUrl(thumbnail?.getAttribute("url"), STANDARD_ORIGIN),
      sourceUrl: absoluteUrl(alternate?.getAttribute("href") || sourceUrl, STANDARD_ORIGIN),
      downloadUrl: absoluteUrl(compatibleEpub?.getAttribute("href"), STANDARD_ORIGIN),
      categories,
      language: "en",
    };
  }).filter((item) => item.downloadUrl);
}

export function gutenbergItemFromGutendex(book) {
  const id = String(book?.id || "");
  const authors = (book?.authors || []).map((author) => humanAuthorName(author.name)).filter(Boolean);
  return {
    id: `gutenberg:${id}`,
    gutenbergId: id,
    source: "gutenberg",
    sourceLabel: "Project Gutenberg",
    title: cleanPublicationText(book?.title) || `Project Gutenberg #${id}`,
    author: authors.join(", ") || "Project Gutenberg",
    description: cleanPublicationText(book?.summaries?.[0]) || "A public-domain edition from Project Gutenberg.",
    image: book?.formats?.["image/jpeg"] || "",
    sourceUrl: `${GUTENBERG_ORIGIN}/ebooks/${id}`,
    downloadUrl: "",
    categories: [...(book?.bookshelves || []), ...(book?.subjects || [])],
    language: book?.languages?.[0] || "en",
  };
}

export async function fetchStandardCatalog({ query = "", page = 1, limit = 18, signal } = {}) {
  const url = new URL("/ebooks", STANDARD_ORIGIN);
  if (query.trim()) url.searchParams.set("query", query.trim());
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("page", String(page));
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/xhtml+xml" }, signal });
  if (!response.ok) throw new Error("Standard Ebooks did not respond.");
  const document = new DOMParser().parseFromString(await response.text(), "text/html");
  return [...document.querySelectorAll('.ebooks-list [typeof="schema:Book"]')].map((book) => {
    const sourcePath = book.getAttribute("about") || book.querySelector('a[property="schema:url"]')?.getAttribute("href") || "";
    const sourceUrl = absoluteUrl(sourcePath, STANDARD_ORIGIN);
    const slug = sourceUrl.replace(`${STANDARD_ORIGIN}/ebooks/`, "");
    return {
      id: `standard:${slug}`,
      source: "standard",
      sourceLabel: "Standard Ebooks",
      title: nodeText(book.querySelector('[property="schema:name"]'), "Untitled"),
      author: nodeText(book.querySelector('.author [property="schema:name"]'), "Unknown author"),
      description: "A carefully produced public-domain edition.",
      image: absoluteUrl(book.querySelector('img[property="schema:image"]')?.getAttribute("src"), STANDARD_ORIGIN),
      sourceUrl,
      downloadUrl: "",
      categories: [],
      language: "en",
    };
  }).filter((item) => item.sourceUrl);
}

export async function fetchGutenbergCatalog({ query = "", page = 1, signal } = {}) {
  const url = new URL("/books/", GUTENDEX_ORIGIN);
  if (query.trim()) url.searchParams.set("search", query.trim());
  url.searchParams.set("page", String(Math.max(1, page)));
  const response = await fetchWithTimeout(url, { signal });
  if (!response.ok) throw new Error("The Project Gutenberg catalog did not respond.");
  const payload = await response.json();
  return (payload.results || []).map(gutenbergItemFromGutendex).filter((item) => item.gutenbergId);
}

export async function fetchStandardItemFromSlug(slug, { signal } = {}) {
  const safeSlug = String(slug || "").replace(/^\/+|\/+$/g, "");
  if (!safeSlug || safeSlug.includes("..")) throw new Error("That Standard Ebooks link is invalid.");
  const sourceUrl = `${STANDARD_ORIGIN}/ebooks/${safeSlug}`;
  const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: "application/xhtml+xml" }, signal });
  if (!response.ok) throw new Error("That Standard Ebooks edition could not be found.");
  const document = new DOMParser().parseFromString(await response.text(), "text/html");
  const title = document.querySelector('[property="schema:name"]')?.textContent?.trim()
    || document.title.split(", by ")[0].trim();
  const author = document.querySelector('[property="schema:author"] [property="schema:name"]')?.textContent?.trim()
    || "Unknown author";
  const description = document.querySelector('meta[name="description"]')?.content
    ?.replace(/^Free epub ebook download of the Standard Ebooks edition of [^:]+:\s*/i, "")
    || "A carefully produced public-domain edition.";
  const download = document.querySelector('#download a.epub[property="schema:contentUrl"]');
  if (!download) throw new Error("This edition does not provide a compatible EPUB.");
  const downloadUrl = new URL(download.getAttribute("href"), STANDARD_ORIGIN);
  downloadUrl.searchParams.set("source", "feed");
  return {
    id: `standard:${safeSlug}`,
    source: "standard",
    sourceLabel: "Standard Ebooks",
    title,
    author,
    description,
    image: document.querySelector('meta[property="og:image"]')?.content || "",
    sourceUrl,
    downloadUrl: downloadUrl.href,
    categories: [],
    language: "en",
  };
}

function normalizeZipPath(path) {
  const output = [];
  for (const part of String(path || "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

function resolveZipPath(baseFile, href) {
  const cleanHref = decodeURIComponent(String(href || "").split("#")[0]);
  const base = String(baseFile || "").split("/").slice(0, -1).join("/");
  return normalizeZipPath(`${base}/${cleanHref}`);
}

function readZipText(files, path) {
  const bytes = files[normalizeZipPath(path)];
  return bytes ? decoder.decode(bytes) : "";
}

function bytesToDataUrl(bytes, mediaType = "image/jpeg") {
  if (!bytes) return "";
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

function navTitles(files, navItem) {
  if (!navItem) return new Map();
  const text = readZipText(files, navItem.path);
  if (!text) return new Map();
  const document = new DOMParser().parseFromString(text, "application/xhtml+xml");
  const result = new Map();
  for (const anchor of [...document.getElementsByTagName("a")]) {
    const href = anchor.getAttribute("href");
    const label = cleanPublicationText(anchor.textContent);
    if (!href || !label) continue;
    const path = resolveZipPath(navItem.path, href);
    const fragment = String(href).split("#")[1];
    if (fragment) result.set(`${path}#${decodeURIComponent(fragment)}`, label);
    if (!result.has(path)) result.set(path, label);
  }
  return result;
}

function extractEpubChapter(files, item, title, chapterNumber, titles) {
  if (/^(?:cover|title ?page|half ?title|contents|table of contents|imprint|colophon|uncopyright|copyright)$/i.test(title.trim())) {
    return [];
  }
  const text = readZipText(files, item.path);
  if (!text) return [];
  let document = new DOMParser().parseFromString(text, "application/xhtml+xml");
  if (document.querySelector("parsererror")) document = new DOMParser().parseFromString(text, "text/html");
  document.querySelectorAll([
    "script", "style", "nav", "aside", "figure", "svg", "math", "audio", "video",
    "[role='doc-footnote']", "[role='doc-endnotes']", "[epub\\:type~='footnote']", "[epub\\:type~='endnote']",
    "[epub\\:type~='noteref']",
  ].join(",")).forEach((node) => node.remove());

  const body = document.querySelector("body") || document.documentElement;
  const candidates = [...body.querySelectorAll("h1, h2, h3, p, li, blockquote, tr")];
  const rawBlocks = [];
  for (const element of candidates) {
    // XHTML parsed as XML keeps lower-case tag names in Safari. Normalize once
    // so nested lists and table-based dramatic dialogue are handled identically
    // in EPUB 2 and EPUB 3 publications.
    const tagName = element.localName.toUpperCase();
    if (tagName === "LI" && element.querySelector("li")) continue;
    if (tagName !== "TR" && element.closest("tr")) continue;
    if (tagName === "P" && element.closest("li")) continue;
    let value;
    if (tagName === "TR") {
      const cells = [...element.children]
        .filter((cell) => /^(?:TH|TD)$/.test(cell.localName.toUpperCase()))
        .map((cell) => cleanPublicationText(cell.textContent))
        .filter(Boolean);
      value = cells.join(cells.length > 1 ? ". " : "");
    } else {
      const raw = elementTextWithLineBreaks(element);
      value = raw.includes("\n") ? cleanPublicationTextPreserveLines(raw) : cleanPublicationText(raw);
    }
    if (!value || (/^(cover|title page|contents|table of contents|copyright)$/i.test(value) && candidates.length < 8)) continue;
    if (/^H[1-3]$/.test(tagName)) {
      if (value.toLocaleLowerCase() === title.toLocaleLowerCase()) continue;
      const navTitle = element.id ? titles.get(`${item.path}#${element.id}`) : "";
      const chapterBreak = /^(?:H1|H2)$/.test(tagName) && (chapterHeading(value) || navTitle);
      rawBlocks.push({ type: chapterBreak ? "chapter" : "h3", text: navTitle || value });
    } else if (value.length >= 12) {
      rawBlocks.push({ type: tagName === "LI" ? "li" : "p", text: value });
    }
  }

  const sections = [];
  let current = {
    title: cleanPublicationText(title) || `Section ${chapterNumber}`,
    rawBlocks: [],
  };
  const commit = () => {
    const proseWords = current.rawBlocks
      .filter((block) => block.type === "p" || block.type === "li")
      .reduce((count, block) => count + block.text.split(/\s+/).length, 0);
    if (proseWords >= 12) sections.push(current);
  };
  for (const block of rawBlocks) {
    if (block.type === "chapter") {
      commit();
      current = { title: block.text, rawBlocks: [] };
    } else {
      current.rawBlocks.push(block);
    }
  }
  commit();
  return sections;
}

export function parseEpubFiles(files, options = {}) {
  const containerText = readZipText(files, "META-INF/container.xml");
  if (!containerText) throw new Error("This EPUB is missing its package information.");
  const container = xmlDocument(containerText);
  const packagePath = localElement(container, "rootfile")?.getAttribute("full-path");
  if (!packagePath) throw new Error("This EPUB does not identify its content package.");
  const packageText = readZipText(files, packagePath);
  const packageDocument = xmlDocument(packageText);
  const metadata = localElement(packageDocument, "metadata");
  const manifest = localElement(packageDocument, "manifest");
  const spine = localElement(packageDocument, "spine");
  if (!manifest || !spine) throw new Error("This EPUB does not contain a readable spine.");

  const title = nodeText(localElement(metadata, "title"), options.title || "Untitled EPUB");
  const creators = localElements(metadata, "creator").map((node) => nodeText(node)).filter(Boolean);
  const author = creators.join(", ") || options.author || "Unknown author";
  const language = nodeText(localElement(metadata, "language"), options.language || "en").split("-")[0];
  const description = textFromMarkup(nodeText(localElement(metadata, "description"), options.description || ""));
  const identifier = nodeText(localElement(metadata, "identifier"));

  const items = new Map();
  for (const node of directLocalElements(manifest, "item")) {
    const id = node.getAttribute("id");
    if (!id) continue;
    items.set(id, {
      id,
      href: node.getAttribute("href") || "",
      path: resolveZipPath(packagePath, node.getAttribute("href")),
      mediaType: node.getAttribute("media-type") || "",
      properties: node.getAttribute("properties") || "",
    });
  }

  const navItem = [...items.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const titles = navTitles(files, navItem);
  const coverMeta = localElements(metadata, "meta").find((node) => node.getAttribute("name") === "cover");
  const coverItem = (coverMeta && items.get(coverMeta.getAttribute("content")))
    || [...items.values()].find((item) => item.properties.split(/\s+/).includes("cover-image"));
  const image = coverItem ? bytesToDataUrl(files[coverItem.path], coverItem.mediaType) : (options.image || "");

  const chapters = [];
  for (const itemref of directLocalElements(spine, "itemref")) {
    if (itemref.getAttribute("linear") === "no") continue;
    const item = items.get(itemref.getAttribute("idref"));
    if (!item || item === navItem || !/xhtml|html/.test(item.mediaType)) continue;
    const chapterTitle = titles.get(item.path) || "";
    const itemChapters = extractEpubChapter(files, item, chapterTitle, chapters.length + 1, titles);
    chapters.push(...itemChapters);
  }
  if (!chapters.length) throw new Error("This EPUB does not contain readable chapters.");

  const blocks = [];
  chapters.forEach((chapter, chapterIndex) => {
    const sectionId = `chapter-${chapterIndex + 1}`;
    blocks.push({ id: sectionId, type: "h2", text: chapter.title, section: chapter.title, sectionId });
    chapter.rawBlocks.forEach((block) => {
      blocks.push({
        id: `block-${blocks.length}`,
        type: block.type,
        text: block.text,
        section: chapter.title,
        sectionId,
      });
    });
  });

  return {
    key: options.key || `epub:${identifier || `${title}:${author}`}`,
    kind: "book",
    lang: language || "en",
    title,
    author,
    description: options.description || description || `An EPUB edition of ${title}.`,
    image,
    source: options.source || "local",
    sourceLabel: options.sourceLabel || "My EPUB",
    sourceUrl: options.sourceUrl || "",
    catalogItem: options.catalogItem || null,
    blocks,
  };
}

function humanAuthorName(value) {
  const text = cleanPublicationText(value).replace(/,?\s+\d{4}[-–]\d{0,4}\.?$/, "");
  const match = text.match(/^([^,]+),\s*([^,]+)$/);
  return match ? `${match[2]} ${match[1]}` : text;
}

async function fetchGutenbergDetails(id, { signal } = {}) {
  const response = await fetchWithTimeout(`${GUTENDEX_ORIGIN}/books/${id}/`, { signal });
  if (!response.ok) throw new Error("The Project Gutenberg catalog could not open that edition.");
  const item = gutenbergItemFromGutendex(await response.json());
  return {
    title: item.title,
    author: item.author,
    description: item.description,
    image: item.image,
    lang: item.language,
  };
}

function chapterHeading(value) {
  return /^(?:chapter|book|part|volume|letter|act|scene)\b/i.test(value)
    || /^(?:[ivxlcdm]+|\d+)[.\s:-]/i.test(value);
}

function extractGutenbergHtml(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll([
    "script", "style", "nav", "aside", "figure", "svg", "table", "audio", "video",
    "#pg-header", "#pg-footer", ".pg-boilerplate", ".footnote", ".footnotes",
  ].join(",")).forEach((node) => node.remove());
  const candidates = [...document.body.querySelectorAll("h1, h2, h3, h4, p, li, blockquote")];
  const blocks = [];
  let section = "Opening";
  let sectionId = "chapter-1";
  let chapterCount = 0;

  for (const element of candidates) {
    if (element.tagName === "LI" && element.querySelector("li")) continue;
    const rawForBreaks = elementTextWithLineBreaks(element);
    const text = rawForBreaks.includes("\n") ? cleanPublicationTextPreserveLines(rawForBreaks) : cleanPublicationText(rawForBreaks);
    if (!text) continue;
    if (/\*\*\*\s*(?:start|end) of (?:the|this) project gutenberg/i.test(text)) continue;
    if (/^(?:project gutenberg|produced by|transcriber's note|credits:|ebook no\.)/i.test(text)) continue;

    const isHeading = /^H[1-4]$/.test(element.tagName);
    // Split blocks that contain explicit line breaks (verse/prose with <br>) into separate lines
    const lineParts = text.includes("\n") ? text.split(/\n+/).map((part) => part.trim()).filter(Boolean) : [text];
    for (let partIndex = 0; partIndex < lineParts.length; partIndex += 1) {
      let part = lineParts[partIndex];
      const isLastPart = partIndex === lineParts.length - 1;
      // Add pause punctuation for verse lines that lack terminal punctuation — period for audible break
      if (!isLastPart && !isHeading && !/[.!?;:,…—]$/.test(part)) {
        part = `${part} .`;
      }
      if (isHeading && (element.tagName === "H1" || element.tagName === "H2" || chapterHeading(part))) {
        chapterCount += 1;
        section = part;
        sectionId = `chapter-${chapterCount}`;
        blocks.push({ id: sectionId, type: "h2", text: part, section, sectionId });
      } else if (isHeading) {
        blocks.push({ id: `block-${blocks.length}`, type: "h3", text: part, section, sectionId });
      } else if (part.length >= 12 || lineParts.length > 1) {
        blocks.push({
          id: `block-${blocks.length}`,
          type: element.tagName === "LI" ? "li" : "p",
          text: part,
          section,
          sectionId,
        });
      }
    }
  }
  const narrativeStart = blocks.findIndex((block) => block.type === "h2" && chapterHeading(block.text));
  return narrativeStart > 0 ? blocks.slice(narrativeStart) : blocks;
}

function extractGutenbergText(text) {
  const content = text
    .replace(/^.*?\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/is, "")
    .replace(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*$/i, "")
    .trim();
  const paragraphs = content.split(/\n\s*\n+/);
  const blocks = [];
  let section = "Opening";
  let sectionId = "chapter-1";
  let chapterCount = 0;
  for (const rawParagraph of paragraphs) {
    const trimmed = rawParagraph.trim();
    if (!trimmed) continue;
    // Detect verse: multiple short lines separated by single newlines
    const lines = trimmed.split(/\n/).map((line) => cleanPublicationText(line)).filter(Boolean);
    if (lines.length > 1) {
      const avgLen = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
      const isVerse = avgLen < 80 && lines.length >= 2;
      if (isVerse) {
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          let line = lines[lineIndex];
          const isLastLine = lineIndex === lines.length - 1;
          if (!isLastLine && !/[.!?;:,…—]$/.test(line)) {
            line = `${line} .`;
          }
          if (line.replace(/,\s*$/, "").length < 120 && chapterHeading(line.replace(/,\s*$/, ""))) {
            chapterCount += 1;
            section = line;
            sectionId = `chapter-${chapterCount}`;
            blocks.push({ id: sectionId, type: "h2", text: line, section, sectionId });
          } else if (line.length >= 2) {
            blocks.push({ id: `block-${blocks.length}`, type: "p", text: line, section, sectionId });
          }
        }
        continue;
      }
    }
    const paragraph = cleanPublicationText(trimmed);
    if (!paragraph) continue;
    if (paragraph.length < 120 && chapterHeading(paragraph)) {
      chapterCount += 1;
      section = paragraph;
      sectionId = `chapter-${chapterCount}`;
      blocks.push({ id: sectionId, type: "h2", text: paragraph, section, sectionId });
    } else if (paragraph.length >= 12) {
      blocks.push({ id: `block-${blocks.length}`, type: "p", text: paragraph, section, sectionId });
    }
  }
  return blocks;
}

async function fetchGitenbergContent(id, { signal } = {}) {
  const searchUrl = new URL("https://api.github.com/search/repositories");
  searchUrl.searchParams.set("q", `${id} in:name org:GITenberg`);
  searchUrl.searchParams.set("per_page", "20");
  const searchResponse = await fetchWithTimeout(searchUrl, { headers: { Accept: "application/vnd.github+json" }, signal });
  if (!searchResponse.ok) throw new Error("The Gutenberg text mirror is temporarily unavailable.");
  const search = await searchResponse.json();
  const repository = search.items?.find((item) => item.name.endsWith(`_${id}`));
  if (!repository) throw new Error("A browser-readable mirror of this book is not available yet.");

  const treeResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${repository.full_name}/git/trees/${repository.default_branch}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json" }, signal },
  );
  if (!treeResponse.ok) throw new Error("The Gutenberg text mirror could not be opened.");
  const tree = await treeResponse.json();
  const paths = tree.tree?.filter((item) => item.type === "blob").map((item) => item.path) || [];
  const htmlPath = paths.find((path) => path === `${id}-h/${id}-h.htm`)
    || paths.find((path) => !path.startsWith("old/") && /(?:^|\/)\d+-h\.html?$/i.test(path))
    || paths.find((path) => !path.startsWith("old/") && /\.html?$/i.test(path));
  const textPath = paths.find((path) => path === `${id}-0.txt`)
    || paths.find((path) => path === `${id}.txt`)
    || paths.find((path) => !path.startsWith("old/") && /\.txt$/i.test(path));
  const contentPath = htmlPath || textPath;
  if (!contentPath) throw new Error("This Gutenberg mirror does not include readable text.");
  const rawUrl = `https://raw.githubusercontent.com/${repository.full_name}/${repository.default_branch}/${contentPath}`;
  const response = await fetchWithTimeout(rawUrl, { signal }, 90_000);
  if (!response.ok) throw new Error("The mirrored Gutenberg text could not be downloaded.");
  const content = await response.text();
  return htmlPath ? extractGutenbergHtml(content) : extractGutenbergText(content);
}

export async function loadGutenbergWork(item, onStatus = () => {}, { signal } = {}) {
  const id = item.gutenbergId || String(item.id).replace(/^gutenberg:/, "");
  onStatus("Opening the public-domain edition");
  const [details, blocks] = await Promise.all([
    fetchGutenbergDetails(id, { signal }).catch((error) => {
      if (signal?.aborted) throw error;
      console.warn("[Hear library] Gutenberg metadata unavailable; opening the mirrored text", error);
      return null;
    }),
    fetchGitenbergContent(id, { signal }),
  ]);
  const proseCount = blocks.filter((block) => block.type === "p" || block.type === "li").length;
  if (proseCount < 3) throw new Error("This Gutenberg edition does not contain enough readable text.");
  return {
    key: `gutenberg:${id}`,
    kind: "book",
    lang: details?.lang || item.language || "en",
    title: details?.title || item.title,
    author: details?.author || item.author,
    description: details?.description || item.description,
    image: details?.image || item.image || "",
    source: "gutenberg",
    sourceLabel: "Project Gutenberg",
    sourceUrl: `${GUTENBERG_ORIGIN}/ebooks/${id}`,
    catalogItem: { ...item, gutenbergId: id },
    blocks,
  };
}

export async function loadStandardWork(item, onStatus = () => {}, { signal, parse } = {}) {
  if (!item.downloadUrl) throw new Error("This Standard Ebooks edition has no compatible EPUB.");
  if (typeof parse !== "function") throw new Error("The EPUB parser is unavailable.");
  onStatus("Downloading the Standard Ebooks edition");
  const response = await fetchWithTimeout(item.downloadUrl, { headers: { Accept: "application/epub+zip" }, signal }, 90_000);
  if (!response.ok) throw new Error("The Standard Ebooks EPUB could not be downloaded.");
  onStatus("Finding chapters and reading order");
  return parse(await response.arrayBuffer(), {
    key: item.id,
    title: item.title,
    author: item.author,
    description: item.description,
    image: item.image,
    language: item.language,
    source: "standard",
    sourceLabel: "Standard Ebooks",
    sourceUrl: item.sourceUrl,
    catalogItem: item,
  }, { signal, onStatus });
}

function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORK_CACHE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WORK_STORE)) {
        request.result.createObjectStore(WORK_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedWork(key) {
  if (!("indexedDB" in window) || !key) return null;
  const database = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORK_STORE, "readonly");
    const request = transaction.objectStore(WORK_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.version === CACHE_VERSION ? request.result.work : null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

export async function cacheWork(work) {
  if (!("indexedDB" in window) || !work?.key) return;
  const database = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORK_STORE, "readwrite");
    transaction.objectStore(WORK_STORE).put({ key: work.key, work, version: CACHE_VERSION, updatedAt: Date.now() });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function removeCachedWork(key) {
  if (!("indexedDB" in window) || !key) return;
  const database = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORK_STORE, "readwrite");
    transaction.objectStore(WORK_STORE).delete(key);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}
