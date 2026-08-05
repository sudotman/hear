# Hearwiki agent guide

## Project

Hearwiki is a Vite-powered static web app that turns Wikipedia articles into clean listening copy. It removes citations and reference sections, supports system speech voices, and uses a locally generated Kokoro neural voice for English articles. The site is intended for Safari and is deployed to GitHub Pages at `hear.satyam.lol`.

## Important files

- `index.html` — page structure, dialogs, player, and accessible labels.
- `main.js` — article fetching/cleaning, playback state, persistence, Media Session integration, and UI behavior.
- `tts-worker.js` — lazy Kokoro/Transformers.js model loading and WAV generation.
- `styles.css` — visual system and responsive layout.
- `vite.config.js` — relative production base and worker format.
- `.github/workflows/deploy-pages.yml` — GitHub Pages deployment.

## Development

```bash
npm install
npm run dev
npm run build
```

Run `npm run build` after source or dependency changes. Also run `npm audit --audit-level=high` for dependency changes and `git diff --check` before handoff.

For browser/UI checks, use the bundled Playwright wrapper at `/Users/satyamkashyap/.codex/skills/playwright/scripts/playwright_cli.sh`. Test at least one mobile-sized Safari/WebKit viewport when changing playback, dialogs, responsive layout, or Media Session behavior. Keep generated screenshots and traces under `output/playwright/`; do not add test artifacts at the repository root.

## Audio behavior

- Keep the natural voice lazy-loaded and local. Article text must not be sent to a speech service.
- English natural playback must use the real `<audio>` element so Media Session and iOS Control Center can control it.
- Preserve play, pause, resume, seeking, ±15-second skips, saved position, playback rate, metadata, and lock-screen/control-center actions.
- Non-English articles should retain the system-voice fallback unless multilingual neural voices are deliberately added.
- Keep model download/warm-up states visible and recoverable; never leave the player permanently stuck in `buffering`.
- Do not assume Safari exposes Apple’s native “Listen to Page” voice through Web Speech API.

## Content and privacy

Wikipedia content is fetched from Wikimedia APIs and cleaned for narration. Keep citation markers, references, tables, and navigation furniture out of spoken chunks while leaving the original article link available. Preserve Wikimedia attribution and the project’s privacy promise in user-facing copy.

## Editing conventions

- Prefer small, focused changes and reuse existing CSS variables/components.
- Preserve the editorial, quiet visual language; avoid generic dashboard/card treatments.
- Keep controls keyboard-accessible and provide meaningful ARIA labels/live status text.
- Use `apply_patch` for source edits. Do not overwrite unrelated user changes.
- Do not commit, push, change DNS, or alter GitHub Pages settings unless explicitly requested.

## Handoff checklist

1. `npm run build` passes.
2. `git diff --check` passes.
3. UI changes are checked in WebKit at desktop and mobile sizes as appropriate.
4. Playback changes verify actual audio state plus `navigator.mediaSession` metadata/playback state.
5. Mention any one-time model download, browser limitation, or deployment step in the handoff.
