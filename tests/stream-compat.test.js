import { expect, test } from "vitest";
import { installReadableStreamAsyncIterator } from "../stream-compat.js";

test("installs a WebKit-safe ReadableStream async iterator", async () => {
  class LegacyReadableStream {
    constructor(values) {
      this.values = [...values];
    }

    getReader() {
      return {
        read: async () => this.values.length
          ? { done: false, value: this.values.shift() }
          : { done: true, value: undefined },
        releaseLock() {},
      };
    }
  }

  expect(installReadableStreamAsyncIterator(LegacyReadableStream)).toBe(true);
  const values = [];
  for await (const value of new LegacyReadableStream(["one", "two"])) values.push(value);
  expect(values).toEqual(["one", "two"]);
  expect(installReadableStreamAsyncIterator(LegacyReadableStream)).toBe(false);
});
