import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const assets = readdirSync(assetsDir).map((name) => ({ name, path: join(assetsDir.pathname, name) }));
const mainScript = assets.find((asset) => /^main-.*\.js$/.test(asset.name));
if (!mainScript) throw new Error("Bundle check could not find the main application script.");
const mainGzipBytes = gzipSync(readFileSync(mainScript.path)).byteLength;
if (mainGzipBytes > 45 * 1024) throw new Error(`Initial JavaScript grew to ${(mainGzipBytes / 1024).toFixed(1)} KB gzip (45 KB budget).`);

const eagerHtml = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
const lazyAssets = assets.filter((asset) => /(?:tts-worker|kitten-runtime|phonemizer|kokoro|ort-wasm)/.test(asset.name));
for (const asset of lazyAssets) {
  if (eagerHtml.includes(asset.name)) throw new Error(`Neural runtime ${asset.name} is eagerly referenced by index.html.`);
}
const neuralScripts = assets.filter((asset) => /(?:tts-worker|kitten-runtime|phonemizer).*\.js$/.test(asset.name));
if (!neuralScripts.length) throw new Error("Bundle check could not find the neural worker scripts.");
for (const asset of neuralScripts) {
  const code = readFileSync(asset.path, "utf8");
  if (/for await\s*\(\s*const\s+[A-Za-z_$][\w$]*\s+of\s+[A-Za-z_$][\w$]*\s*\)\s*[A-Za-z_$][\w$]*\.push\(/.test(code)) {
    throw new Error(`WebKit-unsafe ReadableStream iteration remains in ${asset.name}.`);
  }
}
const lazyBytes = lazyAssets.reduce((sum, asset) => sum + statSync(asset.path).size, 0);
console.log(`[bundle] initial JS ${(mainGzipBytes / 1024).toFixed(1)} KB gzip · neural/runtime assets ${(lazyBytes / 1024 / 1024).toFixed(1)} MB lazy`);
