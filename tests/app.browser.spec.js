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
  page.on("request", (request) => {
    if (/huggingface|\.onnx(?:\?|$)|voices\.bin/i.test(request.url())) modelRequests.push(request.url());
  });

  await page.goto("/?lang=en&title=Test%20Work");
  await expect(page.getByRole("heading", { name: "Test Work", level: 1 })).toBeVisible();
  await expect(page.locator("#active-model-label")).toContainText("System voice");
  expect(modelRequests).toEqual([]);

  await page.locator("#voice-button").click();
  await page.locator("#kitten-engine").click();
  await expect(page.locator("#active-model-label")).toContainText("onnx-community/KittenTTS-Nano-v0.8-ONNX");
  expect(modelRequests).toEqual([]);

  await page.locator("#preview-voice").click();
  await expect(page.locator("#neural-sheet")).toBeVisible();
  await expect(page.locator("#neural-download-model")).toContainText("Kitten");
  await expect(page.locator("#neural-download-size")).not.toHaveText("—");
  expect(modelRequests).toEqual([]);
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
