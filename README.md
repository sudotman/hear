# hear

![hear home screen](docs/images/hear.png)

hear is a private, browser-based listening library for wikipedia articles, public-domain books, and drm-free epubs. it cleans text for narration, remembers listening progress, and keeps books, audio, and preferences on this device. think amazon audible but without having to pay bezos!

## what it supports

- browse standard ebooks and project gutenberg catalogs
- open wikipedia articles without citation markers, references, tables, or navigation furniture in the narration
- import epub 2 and epub 3 files, including metadata, covers, reading order, chapters, lists, and table-based dramatic dialogue
- save works to my library and continue the most recent work
- navigate by chapter, seek through a work, change playback speed, skip 15 seconds, and resume saved progress
- use media session controls and a real `<audio>` element for natural-voice playback on iphone control center and the lock screen

catalog metadata comes from the public catalogs. standard ebooks uses its compatible epub editions. project gutenberg text is loaded from the corresponding [gitenberg](https://www.gitenberg.org/) mirror and remains linked to the original [gutenberg](https://www.gutenberg.org/) edition.

## voices

voice and compute choices are explicit and saved on this device. fresh installs use the instant system voice. please configure it yourself for a better natural voice! 

the voices are;
- **instant — system voice:** the browser's web speech api. it starts immediately and is the fallback for non-english works.
- **efficient — kitten:** kitten nano 15m, `onnx-community/KittenTTS-Nano-v0.8-ONNX`, `fp32`, and `wasm` through `onnxruntime-web/wasm`.
- **natural — kokoro:** kokoro 82m, `onnx-community/Kokoro-82M-v1.0-ONNX`; use `q8` with `wasm` or `fp32` with `webgpu`.

i personal recommend kitten-mini for the smoothest playback

the kokoro device choice (`wasm` or `webgpu`) is explicit and saved. webgpu is probed only after choosing kokoro + webgpu, with a cached probe, a `gpu in navigator` guard, an android warning, and fallback to wasm. the active model row shows the selected repository, dtype, and device.

the first kitten or kokoro playback may download about 60–100 mb. models are cached in the browser, and nothing downloads until the user chooses a neural voice. generation reports the file, percentage, backend, segment, and progress state. generated wavs are stored in indexeddb by text, model, voice, speed, and dtype. the worker prioritizes current, next, and background segments and discards stale results after seeking or changing voice settings.

safari does not expose its native “listen to page” siri voice to web page javascript. it can still be used from safari's page menu on hear's cleaned reader view.

## privacy

imported book text, generated audio, listening history, progress, and voice preferences are not sent to any server. cached works use indexeddb; preferences and progress use browser storage. source links and attribution remain attached to catalog works.

## run locally

```bash
npm install
npm run dev
```

create a production build with `npm run build`; output is written to `dist/`.

## urls

```text
wikipedia:          ?lang=en&title=apollo+11
wikipedia (url):   ?url=https://en.wikipedia.org/wiki/Art
standard ebooks:   ?source=standard&book=jane-austen/pride-and-prejudice
project gutenberg: ?source=gutenberg&book=1342
```

imported epubs do not create shareable urls because their contents stay in that browser.

## webgpu stress test

`/webgpu-test/` is a separate build entry for testing kokoro fp32. it reports real-time factor across 20 generations and keeps the last wav for inspection - not necessary anymore

## deploy with cloudflare pages

github pages cannot provide the coop/coep headers required for wasm multithreading. the deployment workflow targets a cloudflare pages project named `hearwiki` and expects these github actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with pages edit permission

`public/_headers` sets:

```text
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
```

the actions build under my subdomain i.e. hear.satyam.lol

## content and attribution

availability and public-domain status can vary by jurisdiction; the source library's terms apply. wikipedia text is reused under the [creative commons attribution-sharealike license](https://creativecommons.org/licenses/by-sa/4.0/), and wikimedia images retain their source licenses.

kokoro and its model weights are distributed under the apache 2.0 license.
