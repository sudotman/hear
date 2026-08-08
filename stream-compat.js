export function installReadableStreamAsyncIterator(ReadableStreamClass = globalThis.ReadableStream) {
  const asyncIterator = Symbol.asyncIterator;
  if (!ReadableStreamClass || !asyncIterator || ReadableStreamClass.prototype[asyncIterator]) return false;

  Object.defineProperty(ReadableStreamClass.prototype, asyncIterator, {
    configurable: true,
    writable: true,
    value() {
      const reader = this.getReader();
      return {
        async next() {
          return reader.read();
        },
        async return() {
          reader.releaseLock();
          return { done: true, value: undefined };
        },
        [asyncIterator]() {
          return this;
        },
      };
    },
  });
  return true;
}
