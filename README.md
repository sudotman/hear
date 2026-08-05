# Hearwiki

A clean, free Wikipedia listening app built for Safari. Hearwiki removes citation markers, references, tables, and page furniture, then turns the edited article into controllable audio.

## What works

- Paste a Wikipedia URL or type an English article title.
- Wikipedia language is detected from pasted links; `fr:Claude Monet` also works.
- Play, pause, resume, seek, and jump backward or forward 15 seconds.
- Use the local neural voice for natural English narration, or switch to any system voice installed on the device.
- Control natural-voice playback from iPhone Control Center and the lock screen.
- Choose among five natural voices and set playback from 0.7× to 1.5×.
- Follow the currently narrated paragraph.
- Return to the saved sentence after reloading an article.
- Open an article from Wikipedia with the included Safari bookmarklet.
- Shareable URLs use `?lang=en&title=Article` and work on static hosting.

The default English voice is generated locally with the open Kokoro model. Recent Safari versions use WebGPU; devices without WebGPU use a CPU fallback. The first use downloads roughly 95–165 MB, depending on the device, and Safari caches it locally. The resulting WAV passages play through a real HTML audio element and the Media Session API, which is what makes system media controls available.

System voice mode uses the browser's Web Speech API and starts instantly. No article text, listening history, or voice preference is sent to an app server in either mode. Article content and lead images come directly from Wikimedia.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`. The generated site is in `dist/`.

## Publish at hear.satyam.lol

The repository includes a GitHub Pages workflow ready for `hear.satyam.lol`.

1. Push the `main` branch to a GitHub repository.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. In the **Custom domain** field on that page, enter `hear.satyam.lol` and save it. GitHub recommends verifying `satyam.lol` first under your account's **Settings → Pages**.
4. In the DNS manager for `satyam.lol`, create a `CNAME` record named `hear` pointing directly to `<your-github-username>.github.io` (do not add the repository name).
5. After DNS resolves, enable **Enforce HTTPS** in the repository's Pages settings.

To use a path such as `satyam.lol/hearwiki/` instead, publish this build beneath that path and keep Vite's relative base setting as-is.

## Safari voice quality

Safari's own **Listen to Page** Siri voice is not exposed to webpage JavaScript, so Hearwiki cannot select that exact voice for its play button. The natural engine is the high-quality, private alternative. You can still use Apple's voice on the cleaned article: open Safari's Page menu and choose **Listen to Page**. Because Hearwiki has already removed Wikipedia's citations and reference sections, Safari receives clean reading copy.

In system voice mode, Hearwiki prefers Premium, Enhanced, Natural, and Siri voices when Safari exposes them. For better voices on macOS, open **System Settings → Accessibility → Spoken Content → System voice → Manage Voices** and download an Enhanced or Premium voice. Voice names and availability are controlled by macOS/iOS.

## Content and attribution

Wikipedia article links remain available in the reader. Wikipedia text is reused under the [Creative Commons Attribution-ShareAlike License](https://creativecommons.org/licenses/by-sa/4.0/); images retain the license shown on their source pages.

The local natural voice uses [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) through [kokoro-js](https://www.npmjs.com/package/kokoro-js), distributed under the Apache 2.0 license.
