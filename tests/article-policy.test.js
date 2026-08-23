import { expect, test } from "vitest";
import {
  arxivHtmlUrl,
  doiFromArticleUrl,
  looksLikeArticleUrl,
  normalizeDoi,
  normalizePublicArticleUrl,
} from "../article-policy.js";

test("accepts ordinary public article URLs and removes fragments", () => {
  expect(normalizePublicArticleUrl("https://example.com/news/story?edition=web#comments"))
    .toBe("https://example.com/news/story?edition=web");
});

test("rejects credentials, unusual ports, and private network targets", () => {
  const blocked = [
    "https://reader:secret@example.com/story",
    "https://example.com:8443/story",
    "http://localhost/article",
    "http://127.0.0.1/article",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.1.20/article",
    "http://[::1]/article",
    "http://service.internal/article",
    `https://example.com/${"a".repeat(4096)}`,
  ];
  blocked.forEach((url) => expect(normalizePublicArticleUrl(url)).toBeNull());
});

test("recognizes pasted domains without treating topic searches as URLs", () => {
  expect(looksLikeArticleUrl("www.example.com/story")).toBe(true);
  expect(looksLikeArticleUrl("example.co.uk/story")).toBe(true);
  expect(looksLikeArticleUrl("history of web publishing")).toBe(false);
});

test("normalizes DOI values from metadata and article URLs", () => {
  expect(normalizeDoi("https://doi.org/10.1038/S41586-024-01234-5.")).toBe("10.1038/s41586-024-01234-5");
  expect(doiFromArticleUrl("https://doi.org/10.1016/j.example.2024.01.002")).toBe("10.1016/j.example.2024.01.002");
  expect(doiFromArticleUrl("https://journal.example/articles/10.5555%2Fresearch-7?view=full"))
    .toBe("10.5555/research-7");
  expect(normalizeDoi("not a doi")).toBe("");
});

test("turns supported arXiv routes into the public HTML edition", () => {
  expect(arxivHtmlUrl("https://arxiv.org/abs/2402.08954v2")).toBe("https://arxiv.org/html/2402.08954v2");
  expect(arxivHtmlUrl("https://arxiv.org/pdf/hep-th/9901001.pdf")).toBe("https://arxiv.org/html/hep-th/9901001");
  expect(arxivHtmlUrl("https://example.com/abs/2402.08954")).toBe("");
});
