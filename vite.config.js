import { defineConfig } from "vite";
import { resolve } from "node:path";
import { allowedCoverUrl } from "./cover-policy.js";

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

function localCoverProxy() {
  return {
    name: "hear-local-cover-proxy",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url || "/", "http://localhost");
        if (requestUrl.pathname !== "/cover") {
          next();
          return;
        }
        const source = allowedCoverUrl(requestUrl.searchParams.get("url"));
        if (!source) {
          response.statusCode = 400;
          response.end("Cover URL not allowed");
          return;
        }
        try {
          const upstream = await fetch(source, {
            headers: { Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8" },
          });
          const type = upstream.headers.get("content-type") || "";
          if (!upstream.ok || !allowedCoverUrl(upstream.url) || !type.toLowerCase().startsWith("image/")) {
            response.statusCode = 502;
            response.end("Cover unavailable");
            return;
          }
          const bytes = Buffer.from(await upstream.arrayBuffer());
          response.statusCode = 200;
          response.setHeader("Cache-Control", "public, max-age=86400");
          response.setHeader("Content-Type", type);
          response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.end(bytes);
        } catch {
          response.statusCode = 502;
          response.end("Cover unavailable");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [webkitReadableStreamPatch(), localCoverProxy()],
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
