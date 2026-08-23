import { expect, test } from "vitest";
import { looksLikeArticleUrl, normalizePublicArticleUrl } from "../article-policy.js";

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
