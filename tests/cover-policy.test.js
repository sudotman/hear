import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedCoverUrl, coverProxyPath } from "../cover-policy.js";
import { onRequestGet } from "../functions/cover.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cover proxy policy", () => {
  it("allows only the public catalog artwork hosts", () => {
    expect(allowedCoverUrl("https://www.gutenberg.org/cache/epub/1342/cover.jpg")?.hostname).toBe("www.gutenberg.org");
    expect(allowedCoverUrl("https://upload.wikimedia.org/example.jpg")?.hostname).toBe("upload.wikimedia.org");
    expect(allowedCoverUrl("http://standardebooks.org/cover.jpg")).toBeNull();
    expect(allowedCoverUrl("https://example.com/cover.jpg")).toBeNull();
    expect(coverProxyPath("https://standardebooks.org/images/cover.jpg")).toContain("/cover?url=https%3A%2F%2Fstandardebooks.org");
  });

  it("returns same-origin image bytes with isolation-safe headers", async () => {
    const upstream = new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
    Object.defineProperty(upstream, "url", {
      value: "https://www.gutenberg.org/cache/epub/1342/cover.png",
    });
    vi.stubGlobal("fetch", vi.fn(async () => upstream));

    const request = new Request(
      "https://hear.satyam.lol/cover?url=https%3A%2F%2Fwww.gutenberg.org%2Fcache%2Fepub%2F1342%2Fcover.png",
    );
    const response = await onRequestGet({ request });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("rejects arbitrary remote URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://hear.satyam.lol/cover?url=https%3A%2F%2Fexample.com%2Fprivate");

    await expect(onRequestGet({ request })).resolves.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
