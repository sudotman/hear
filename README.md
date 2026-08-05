# Hearwiki

A clean, free Wikipedia listening app built for Safari. Hearwiki removes citation markers, references, tables, and page furniture before handing the article to the best on-device voice available.

## What works

- Paste a Wikipedia URL or type an English article title.
- Wikipedia language is detected from pasted links; `fr:Claude Monet` also works.
- Play, pause, resume, seek by sentence, and jump backward or forward 15 seconds.
- Choose any voice installed on the device and set playback from 0.7× to 1.5×.
- Follow the currently narrated paragraph.
- Return to the saved sentence after reloading an article.
- Open an article from Wikipedia with the included Safari bookmarklet.
- Shareable URLs use `?lang=en&title=Article` and work on static hosting.

Speech is generated locally with the browser's Web Speech API. No article text, listening history, or voice preference is sent to an app server. Article content and lead images come directly from Wikimedia.

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

Hearwiki prefers Premium, Enhanced, Natural, and Siri voices when Safari exposes them. For better voices on macOS, open **System Settings → Accessibility → Spoken Content → System voice → Manage Voices** and download an Enhanced or Premium voice. Voice names and availability are controlled by macOS/iOS.

## Content and attribution

Wikipedia article links remain available in the reader. Wikipedia text is reused under the [Creative Commons Attribution-ShareAlike License](https://creativecommons.org/licenses/by-sa/4.0/); images retain the license shown on their source pages.
