# Hear

Hear is a private, browser-based listening library for books and articles. Browse public-domain editions, import a DRM-free EPUB, or open a Wikipedia article; Hear turns each work into clean, controllable narration and remembers where you stopped.

## Library and reader

- Browse and search editions from [Standard Ebooks](https://standardebooks.org/) and [Project Gutenberg](https://www.gutenberg.org/).
- Import EPUB 2 and EPUB 3 files. Hear reads the package metadata, cover, spine, navigation, chapters, lists, and table-based dramatic dialogue directly in the browser.
- Keep opened works in **My library**, with a single **Continue listening** entry for the most recent work.
- Navigate chapter by chapter, seek through the whole work, change speed, skip ±15 seconds, and resume from saved progress.
- Browse the library while the compact player stays active, then return to the current work with one tap.
- Open Wikipedia pages as listening copy without citation markers, references, tables, or navigation furniture.
- Use Media Session metadata and a real `<audio>` element for natural-voice playback from iPhone Control Center and the lock screen.

Catalog metadata comes from each library's public catalog. Standard Ebooks works are read from its compatible EPUB editions. Project Gutenberg metadata comes from its OPDS catalog; browser-readable book text is loaded from the corresponding [GITenberg](https://www.gitenberg.org/) mirror and remains linked to the original Gutenberg edition.

## Voices

English narration has four choices: **Auto**, **Natural — Kokoro**, **Efficient — Kitten**, and **Instant — System voice**. Auto benchmarks a crash-safe Kokoro FP32/WebGPU probe, Kitten Nano/WASM, and Kokoro q8/WASM in that order, then falls back to the system voice when local generation cannot sustain playback.

Every generated segment records its backend, model, text length, queue wait, generation time, audio duration, RTF, and any failure. Text starts with a short 80–120-character passage, then uses longer sentence-aligned passages. Startup and steady-state buffers adapt to measured RTF. Generated WAV files are persisted in IndexedDB using a hash of the text, model version, voice, speed, and dtype; the app also requests persistent browser storage.

The generation worker runs one model request at a time, with current/next/background priorities and an epoch that discards stale results after seeking. Seeking, changing models, and changing voices restart the worker. The five Kokoro choices are voice profiles within the same model, not separate downloads.

System voice mode uses the browser's Web Speech API, starts immediately, and remains the fallback for non-English works. Safari does not expose its native **Listen to Page** Siri voice to webpage JavaScript; that voice can still be used from Safari's Page menu on Hear's cleaned reader view.

No imported book text, generated audio, listening history, progress, or voice preference is sent to a Hear server. Cached works use IndexedDB; preferences and progress use browser storage.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`; output is written to `dist/`.

## URLs

- Wikipedia: `?lang=en&title=Apollo+11`
- Standard Ebooks: `?source=standard&book=jane-austen/pride-and-prejudice`
- Project Gutenberg: `?source=gutenberg&book=1342`

Imported EPUBs deliberately do not create shareable URLs because their contents stay in that browser.

## WebGPU stress test

`/webgpu-test/` is a separate build entry that does not share the app worker. It uses Transformers.js 4.2, its compatible ONNX Runtime Web build, Kokoro FP32, the Heart voice, and one fixed sentence. The page reports RTF for 20 consecutive generations and keeps the last WAV for inspection. Run it on each target iOS/Safari release before allowing that version through the main app’s WebGPU probe.

## Publish at hear.satyam.lol

GitHub Pages cannot configure the COOP/COEP response headers required for WebAssembly multithreading, so deployment has moved to Cloudflare Pages. The workflow expects a Cloudflare Pages project named `hearwiki` and these GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with Pages edit permission

The `public/_headers` file applies `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. After the first Cloudflare deployment, attach `hear.satyam.lol` to the Pages project and move the DNS record from GitHub Pages to the Cloudflare Pages custom-domain target.

On the deployed iPhone, verify in Safari Web Inspector:

```js
console.log({
  crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  cores: navigator.hardwareConcurrency,
});
```

## Content and attribution

Every catalog work retains a link to its source edition. Availability and public-domain status can vary by jurisdiction; the source library's terms apply. Wikipedia text is reused under the [Creative Commons Attribution-ShareAlike License](https://creativecommons.org/licenses/by-sa/4.0/), and Wikimedia images retain their source licenses.

Kokoro and its model weights are distributed under the Apache 2.0 license.
