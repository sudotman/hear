import { describe, expect, it } from "vitest";
import { standardCatalogProxyPath, standardCatalogSource } from "../standard-catalog-policy.js";

describe("Standard Ebooks catalog proxy policy", () => {
  it("allows only known subject pages with bounded pagination", () => {
    const source = standardCatalogSource({ topic: "mystery", page: 2, limit: 18 });
    expect(source.href).toBe("https://standardebooks.org/subjects/mystery?sort=popularity&per-page=18&page=2");
    expect(standardCatalogSource({ topic: "../../admin", page: 1, limit: 18 })).toBeNull();
    expect(standardCatalogSource({ topic: "mystery", page: 0, limit: 18 })).toBeNull();
    expect(standardCatalogSource({ topic: "mystery", page: 1, limit: 500 })).toBeNull();
  });

  it("creates a same-origin request path", () => {
    expect(standardCatalogProxyPath({ topic: "shorts", page: 3, limit: 12 }))
      .toBe("/catalog?topic=shorts&page=3&limit=12");
  });
});
