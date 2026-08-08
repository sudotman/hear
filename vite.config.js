import { defineConfig } from "vite";
import { resolve } from "node:path";

// Vite plugin to ensure WebKit compatibility: phonemizer's bundled
// espeak-ng data loader uses `for await (const x of readableStream)`
// which throws `TypeError: undefined is not a function` on WebKit
// where ReadableStream is not asyncIterable. Replace at bundle time
// with a getReader loop (also polyfilled at runtime in kitten-runtime).
function webkitReadableStreamPatch() {
  const patchLoader = (code, id) => {
    if (!code.includes("for await")) return null;
    const pattern = /for await\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)\s*([A-Za-z_$][\w$]*)\.push\(\1\)/g;
    const patched = code.replace(
      pattern,
      (_match, chunk, stream, chunks) =>
        `{const _r=${stream}.getReader();try{for(;;){const{done:${chunk},value:_v}=await _r.read();if(${chunk})break;${chunks}.push(_v)}}finally{_r.releaseLock()}}`,
    );
    return patched === code ? null : patched;
  };

  return {
    name: "webkit-readable-stream-patch",
    transform(code, id) {
      const patched = patchLoader(code, id);
      return patched === null ? null : { code: patched, map: null };
    },
    renderChunk(code, chunk) {
      const patched = patchLoader(code, chunk.fileName);
      return patched === null ? null : { code: patched, map: null };
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
    plugins: () => [webkitReadableStreamPatch()],
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
