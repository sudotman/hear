# Hear agent guide

## Project

Hear (repo `hearwiki`) is a Vite-powered static web app that turns Wikipedia articles, Standard Ebooks, Project Gutenberg/GITenberg, and imported EPUBs into clean listening copy. It removes citations/reference sections, supports system speech voices, and uses locally generated neural voices (Kitten Nano 15M WASM and Kokoro 82M WASM/WebGPU) for English works. Model choice and compute device are explicit and persisted — no auto benchmark or auto download on page load/refresh. Deployed to Cloudflare Pages at `hear.satyam.lol` (COOP/COEP via `public/_headers`).

## Important files

- `index.html` — page structure, dialogs, player, voice sheet (explicit engine/model/device), and accessible labels. Shows active model label `#active-model-label`.
- `main.js` — article fetching/cleaning, playback state, persistence (`hearwiki:tts-backend` + `hearwiki:kokoro-device` + `hearwiki:neural-voice`), Media Session, explicit engine logic, detailed generating states, and UI behavior.
- `tts-worker.js` — worker router for neural backends (epoch-aware, priority queue, metrics).
- `kitten-runtime.js` — Kitten Nano 15M WASM runtime (on `onnxruntime-web/wasm`, single `EspeakBackend` phonemize → `basic_english_tokenize` → `TextCleaner` → `[0,..,10,0]`, style `min(len(text), N-1)`, unconditional `slice(-5000)` trim — must stay in sync with Python `KittenTTS_1_Onnx`).
- `tts-backends.js` — `KokoroWebGPU`/`KokoroWasm`/`KittenWasm`/`SystemVoice` backends, `WorkerTtsBackend` lifecycle, and cached WebGPU probe (`probeKokoroWebGpu` only after explicit Kokoro+WebGPU pick).
- `tts-cache.js` — IndexedDB cache for generated WAVs (key: text+model+voice+speed+dtype) + persistent storage request.
- `styles.css` — visual system and responsive layout.
- `vite.config.js` — `base: "./"`, COOP/COEP headers for `crossOriginIsolated`, worker `format: "es"`, multi-entry (`main` + `webgpu-test`).
- `webgpu-test/` — isolated WebGPU stress harness (20× RTF, Transformers.js Kokoro FP32) — run before allowing WebGPU on a new iOS/Safari release.
- `.github/workflows/deploy-pages.yml` — Cloudflare Pages deploy (expects `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`, project `hearwiki`), not GitHub Pages.
- `public/_headers` — `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` for WASM threading.

## Development

```bash
npm install
npm run dev
npm run build
```

Run `npm run build` after source or dependency changes. Also run `npm audit --audit-level=high` for dependency changes and `git diff --check` before handoff.

For browser/UI checks, use the bundled Playwright wrapper at `/Users/satyamkashyap/.codex/skills/playwright/scripts/playwright_cli.sh`. Test at least one mobile-sized Safari/WebKit viewport when changing playback, dialogs, responsive layout, or Media Session behavior. Keep generated screenshots and traces under `output/playwright/`; do not add test artifacts at the repository root.

## Audio behavior

- Keep the natural voice lazy-loaded and local. Article text must not be sent to a speech service. Default to the instant system voice — never auto-download or auto-benchmark a neural model on page load or refresh; downloads only after an explicit Kitten/Kokoro + device pick and `Download & listen` / `Preview` (persisted as `hearwiki:tts-backend` + `hearwiki:kokoro-device`).
- `Auto` benchmark is disabled (WebGPU benchmarking is unreliable and crashes the stress harness on some Android WebViews). Engine choice is explicit and saved: `system` (no download) | `kitten` (Kitten Nano 15M · `onnx-community/KittenTTS-Nano-v0.8-ONNX` · fp32 · WASM) | `kokoro` (Kokoro 82M `onnx-community/Kokoro-82M-v1.0-ONNX` · q8 WASM or fp32 WebGPU) — show the exact active model + device in `#active-model-label`, `#engine-description`, and `onProgress`/`onGenerating` text.
- Kitten Nano must exactly match Python `KittenTTS_1_Onnx`: single `EspeakBackend(preserve_punctuation=True, with_stress=True)` call, then `basic_english_tokenize` (`\w+|[^\w\s]` → `' '.join`), then per-char `TextCleaner` map over `["$", ';:,.!?…', A-Z/a-z, IPA]` → `[0, ..., 10, 0]`, style `min(len(text), voices.shape[0]-1)`, required `audio[..., :-5000]` trim.
- Kokoro WebGPU must be probed only after an explicit Kokoro+WebGPU choice (cached `probeKokoroWebGpu` with `webgpu-probe:*` keys, guarded by `gpu in navigator` and Android warning; fallback to `KokoroWasm` on probe failure).
- Make granular generating states visible: file + percent + backend (e.g. `Downloading onnx/model.onnx [kitten-wasm] · 43%`), `Generating segment 3/12 [kokoro-webgpu]`, `Synthesizing …`, with `setNeuralLoading` progress bar. Never leave the player permanently stuck in `buffering`.
- English natural playback must use the real `<audio>` element so Media Session and iOS Control Center can control it; respect `playsinline` and `crossOriginIsolated`/`SharedArrayBuffer` for threaded WASM.
- Preserve play, pause, resume, seeking, ±15-second skips, saved position, playback rate, metadata, and lock-screen/control-center actions. Worker uses priority queue (current/next/background) + epoch to discard stale generations.
- Persist generated WAVs in IndexedDB via `tts-cache.js` (key: text+model+voice+speed+dtype); request persistent storage. No warm prefetch on work open.
- Non-English articles should retain the system-voice fallback unless multilingual neural voices are deliberately added.
- Do not assume Safari exposes Apple’s native “Listen to Page” voice through Web Speech API.

## Content and privacy

Wikipedia, Standard Ebooks, and Project Gutenberg/GITenberg content is fetched from public APIs/caches and cleaned for narration. Keep citation markers, references, tables, and navigation furniture out of spoken chunks while leaving the original source link available. Preserve Wikimedia/Standard Ebooks/Gutenberg attribution and the project’s privacy promise in user-facing copy. Never send article text, generated audio, or voice preferences to a speech service.

## Editing conventions

- Prefer small, focused changes and reuse existing CSS variables/components.
- Preserve the editorial, quiet visual language; avoid generic dashboard/card treatments.
- Keep controls keyboard-accessible and provide meaningful ARIA labels/live status text.
- Use `apply_patch` for source edits. Do not overwrite unrelated user changes.
- Do not commit, push, change DNS, or alter GitHub Pages settings unless explicitly requested.

## Handoff checklist

1. `npm run build` passes (multi-entry `main` + `webgpu-test`, 11+ modules).
2. `git diff --check` passes.
3. UI changes are checked in WebKit at desktop and mobile sizes as appropriate — verify `#active-model-label` shows the exact HF repo + dtype + device, and the explicit Kokoro device selector respects `gpu in navigator` + Android warning.
4. Playback changes verify actual audio state plus `navigator.mediaSession` metadata/playback state, granular `onProgress`/`onGenerating` text, and that no download happens on page load/refresh when engine is `system`.
5. Mention any one-time model download, browser limitation (WebGPU crash on some Android WebViews), or deployment step (Cloudflare `public/_headers` COOP/COEP, `hear.satyam.lol` custom domain) in the handoff.
