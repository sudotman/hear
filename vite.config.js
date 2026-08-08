import { defineConfig } from "vite";
import { resolve } from "node:path";

// Vite plugin to ensure WebKit compatibility: phonemizer's bundled
// espeak-ng data loader uses `for await (const x of readableStream)`
// which throws `TypeError: undefined is not a function` on WebKit
// where ReadableStream is not asyncIterable. Replace at bundle time
// with a getReader loop (also polyfilled at runtime in kitten-runtime).
function webkitReadableStreamPatch() {
  return {
    name: "webkit-readable-stream-patch",
    transform(code, id) {
      // Match the espeak-ng gzip loader regardless of minified var names.
      // Original: `for await(const A of e)C.push(A)` -> minified varies.
      if (code.includes("DecompressionStream") && code.includes("for await")) {
        // Replace `for await(const X of Y)Z.push(X)` with getReader loop.
        const pattern = /for await\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*(\w+)\.push\(\1\)/g;
        const patched = code.replace(
          pattern,
          (_m, chunk, stream, arr) =>
            `{const _r=${stream}.getReader();try{for(;;){const{done:${chunk},value:_v}=await _r.read();if(${chunk})break;${arr}.push(_v)}}finally{_r.releaseLock()}}`,
        );
        if (patched === code) {
          throw new Error(`WebKit ReadableStream compatibility patch did not match ${id}. Update vite.config.js before shipping.`);
        }
        return { code: patched, map: null };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [webkitReadableStreamPatch()],
  base: "./",
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        webgpuTest: resolve(import.meta.dirname, "webgpu-test/index.html"),
      },
    },
  },
});
