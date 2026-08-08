import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap();

async function mockWikipedia(page) {
  await page.route("**/w/rest.php/v1/page/**/html", (route) => route.fulfill({
    contentType: "text/html",
    body: `<section data-mw-section-id="0"><p>A short opening paragraph suitable for listening.</p></section>
      <section data-mw-section-id="1"><h2>Background</h2><p>A second paragraph provides enough copy to build the player.</p></section>`,
  }));
  await page.route("**/api/rest_v1/page/summary/**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      title: "Test Work",
      description: "A local browser-test fixture",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Test_Work" } },
    }),
  }));
}

async function mockGutenbergBook(page) {
  await page.route("https://gutendex.com/books/1727/", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: 1727,
      title: "The Odyssey",
      authors: [{ name: "Homer" }],
      summaries: ["An ancient voyage home."],
      languages: ["en"],
      formats: {},
    }),
  }));
  await page.route("https://api.github.com/search/repositories**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ name: "Test_1727", full_name: "GITenberg/Test_1727", default_branch: "main" }] }),
  }));
  await page.route("https://api.github.com/repos/GITenberg/Test_1727/git/trees/main**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ tree: [{ type: "blob", path: "1727-h/1727-h.htm" }] }),
  }));
  await page.route("https://raw.githubusercontent.com/GITenberg/Test_1727/main/1727-h/1727-h.htm", (route) => route.fulfill({
    contentType: "text/html",
    body: `<h1>The Odyssey</h1><p>The first narrative passage is long enough to read aloud.</p>
      <p>The second narrative passage continues the public-domain story.</p>
      <p>The third narrative passage makes this a valid listening edition.</p>`,
  }));
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await mockWikipedia(page);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) || []).toEqual([]);
});

test("keeps neural models idle until explicit download consent", async ({ page }) => {
  const modelRequests = [];
  const unrelatedCatalogRequests = [];
  page.on("request", (request) => {
    if (/huggingface|\.onnx(?:\?|$)|voices\.bin/i.test(request.url())) modelRequests.push(request.url());
    if (/gutendex\.com\/books\/?(?:\?|$)/i.test(request.url())) unrelatedCatalogRequests.push(request.url());
  });

  await page.goto("/?lang=en&title=Test%20Work");
  await expect(page.getByRole("heading", { name: "Test Work", level: 1 })).toBeVisible();
  await expect(page.locator("#active-model-label")).toContainText("System voice");
  expect(modelRequests).toEqual([]);
  expect(unrelatedCatalogRequests).toEqual([]);

  await page.locator("#voice-button").click();
  const choices = page.locator("#model-options [data-model-choice]");
  await expect(choices).toHaveCount(11);
  await expect(choices.first()).toContainText("System voice");
  await page.locator(`[data-model-choice="kitten:onnx-community/KittenTTS-Nano-v0.8-ONNX"]`).click();
  await expect(page.locator("#active-model-label")).toContainText("onnx-community/KittenTTS-Nano-v0.8-ONNX");
  expect(modelRequests).toEqual([]);

  await page.locator("#preview-voice").click();
  await expect(page.locator("#neural-sheet")).toBeVisible();
  await expect(page.locator("#neural-download-model")).toContainText("Kitten");
  await expect(page.locator("#neural-download-size")).not.toHaveText("—");
  expect(modelRequests).toEqual([]);
});

test("opens a Gutenberg book without requesting browser-blocked OPDS metadata", async ({ page }) => {
  const opdsRequests = [];
  page.on("request", (request) => {
    if (/gutenberg\.org\/ebooks\/\d+\.opds/i.test(request.url())) opdsRequests.push(request.url());
  });
  await mockGutenbergBook(page);

  await page.goto("/?source=gutenberg&book=1727");

  await expect(page.getByRole("heading", { name: "The Odyssey", level: 1 })).toBeVisible();
  await expect(page.locator("#source-link")).toHaveAttribute("href", "https://www.gutenberg.org/ebooks/1727");
  expect(opdsRequests).toEqual([]);
});

test("browser Back restores the reader after visiting the library", async ({ page }) => {
  await page.goto("/?lang=en&title=Test%20Work");
  await expect(page.locator("#reader")).toBeVisible();
  await page.locator("#library-button").click();
  await expect(page.locator("#start-view")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#reader")).toBeVisible();
  await expect(page).toHaveURL(/title=Test/);
});

test("mobile player controls meet a 44px touch target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit-mobile", "Mobile WebKit-only layout check");
  await page.goto("/?lang=en&title=Test%20Work");
  await expect(page.locator("#player")).toBeVisible();
  for (const selector of ["#back-button", "#play-button", "#forward-button", "#chapters-button", "#voice-button", "#rate-button"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should be laid out`).not.toBeNull();
    expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(44);
  }
});
