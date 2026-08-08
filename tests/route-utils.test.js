import { expect, test } from "vitest";
import { libraryRouteState, routeForWork, routeStateForWork } from "../route-utils.js";

test("Wikipedia route preserves language and title", () => {
  expect(routeForWork({ source: "wikipedia", lang: "fr", title: "Ada Lovelace" }, "/hear/"))
    .toBe("/hear/?lang=fr&title=Ada+Lovelace");
});

test("local EPUBs do not create misleading shareable routes", () => {
  expect(routeForWork({ source: "local", key: "local:book" }, "/hear/")).toBe("/hear/");
});

test("book routes and history state remain stable", () => {
  expect(routeForWork({ source: "standard", key: "standard:jane-austen/pride-and-prejudice" }, "/"))
    .toBe("/?source=standard&book=jane-austen%2Fpride-and-prejudice");
  expect(routeForWork({ source: "gutenberg", key: "gutenberg:1342" }, "/"))
    .toBe("/?source=gutenberg&book=1342");
  expect(routeStateForWork({ key: "gutenberg:1342" })).toEqual({ view: "reader", work: "gutenberg:1342" });
  expect(libraryRouteState()).toEqual({ view: "library" });
});
