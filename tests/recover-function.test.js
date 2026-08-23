import { afterEach, expect, test, vi } from "vitest";
import { onRequestGet } from "../functions/recover.js";

afterEach(() => vi.unstubAllGlobals());

test("returns attributed open-access and archived alternatives", async () => {
  const upstream = vi.fn(async (input) => {
    const url = new URL(input);
    if (url.hostname === "www.ebi.ac.uk") {
      return Response.json({
        resultList: {
          result: [{
            isOpenAccess: "Y",
            title: "A public paper",
            license: "cc by",
            fullTextUrlList: {
              fullTextUrl: [{
                availabilityCode: "OA",
                documentStyle: "html",
                url: "https://europepmc.org/articles/PMC1234567",
              }],
            },
          }],
        },
      });
    }
    if (url.hostname === "archive.org") {
      return Response.json({
        archived_snapshots: {
          closest: {
            available: true,
            status: "200",
            timestamp: "20200102030405",
            url: "http://web.archive.org/web/20200102030405/https://journal.example/missing",
          },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", upstream);

  const response = await onRequestGet({
    request: new Request(
      "https://hear.example/recover?url=https%3A%2F%2Fjournal.example%2Fmissing&doi=10.1234%2Fpaper&archive=1",
    ),
  });
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(payload.alternatives).toEqual([
    expect.objectContaining({ provider: "Europe PMC", kind: "open-access", url: "https://europepmc.org/articles/PMC1234567" }),
    expect.objectContaining({
      provider: "Internet Archive",
      kind: "archive",
      url: "https://web.archive.org/web/20200102030405id_/https://journal.example/missing",
    }),
  ]);
  expect(upstream).toHaveBeenCalledTimes(2);
});

test("offers an arXiv HTML edition without an external resolver call", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);

  const response = await onRequestGet({
    request: new Request("https://hear.example/recover?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2402.08954.pdf"),
  });

  expect(await response.json()).toEqual({
    alternatives: [{
      kind: "open-access",
      provider: "arXiv",
      label: "Open the HTML research paper",
      detail: "Author-posted open-access copy",
      url: "https://arxiv.org/html/2402.08954",
    }],
  });
  expect(upstream).not.toHaveBeenCalled();
});

test("rejects private recovery targets before contacting repositories", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);

  const response = await onRequestGet({
    request: new Request("https://hear.example/recover?url=http%3A%2F%2F127.0.0.1%2Fpaper"),
  });

  expect(response.status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
