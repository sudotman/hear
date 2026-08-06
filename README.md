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

Natural English narration uses [KittenTTS Nano v0.8](https://huggingface.co/onnx-community/KittenTTS-Nano-v0.8-ONNX), an open-weight 15-million-parameter speech model, through ONNX Runtime Web and phonemizer.js. Hear uses ONNX Runtime's standard WASM build—not its WebGPU/JSEP build—in a single-threaded background worker with memory arenas disabled. This avoids the Safari 26 JSEP compilation issue and keeps peak memory low enough for iPhone. The first use downloads about 60 MB of voice files, which Safari caches for later sessions.

The five natural choices are voice profiles within the same model, not separate model downloads. Text is divided into short passages, generated locally as WAV audio, and prefetched while the current passage plays. Worker startup, generation, and audio loading have bounded recovery paths. If mobile Safari still terminates a local inference, Hear immediately continues with the device's system voice instead of leaving the player in a preparing state.

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

## Publish at hear.satyam.lol

The repository includes a GitHub Pages workflow for `hear.satyam.lol`.

1. Push the `main` branch to a GitHub repository.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Set the custom domain to `hear.satyam.lol`.
4. Point the `hear` CNAME record to `<your-github-username>.github.io`.
5. After DNS resolves, enable **Enforce HTTPS**.

## Content and attribution

Every catalog work retains a link to its source edition. Availability and public-domain status can vary by jurisdiction; the source library's terms apply. Wikipedia text is reused under the [Creative Commons Attribution-ShareAlike License](https://creativecommons.org/licenses/by-sa/4.0/), and Wikimedia images retain their source licenses.

KittenTTS Nano and its model weights are distributed under the Apache 2.0 license.
