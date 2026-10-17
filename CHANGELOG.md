# Changelog

Newest first. Versions are the userscript's `@version`; each entry lists the commits that make it up.

## Unreleased

### `fcb0f08` · 2026-10-17 · docs(readme): Add README image generator and local install instructions

- `tools/assets/`: renders the README images with the real userscript in headless Chromium (Playwright). See `tools/assets/README.md`.
- All `docs/img/` images regenerated with the 0.5.0 card and popup; hover and select crops made taller so the bigger card fits.
- README install section: Violentmonkey store links, installing from a URL, another branch or a local clone, and enabling `file://` pages in the browser and in the script's menu.
- Task template: no attribution trailers in commits, no `TASK-` prefix outside a task, regenerate images on UI changes.
- `.gitignore`: `*.zip`.

## 0.5.0

### `cef5718` · 2026-10-17 · TASK-001 feat(popup): Add read-aloud, larger zhuyin card and pinyin toggle

- Speaker button on the hover card and the translation popup: Google's zh-TW voice via Web Audio, the browser's own voice when Google fails. A second click or <kbd>Esc</kbd> stops it.
- Hover card is larger and always shows the word's zhuyin (20 px).
- Hover card sits 2 px under its word, which is tinted. It stays open when the pointer slips a little off, and isn't taken over by words crossed on the way to it.
- Hover card is placed beside, below or above an open translation popup, never over it.
- Menu toggle "Pinyin in translation", off by default; the word list shows zhuyin instead.
- `@connect translate.google.com` for the voice.
- Task doc and task template in `docs/tasks/`.

### `f94cd78` · 2026-10-17 · TASK-001 feat(popup): Add read-aloud, larger zhuyin card and pinyin toggle

- Only adds `tmp/*` to `.gitignore`; the feature itself is in `cef5718`.

## 0.4.1

### `d652402` · 2026-10-17 · Make work on local files

- `@match file:///*`: the script runs on local HTML files.
- Local files share one setting, "Local files" in the menu, instead of colliding on an empty hostname.

## 0.4.0

### `a67ccdb` · 2026-10-17 · Add readme images

- README images in `docs/img/`.

### `1ecadab` · 2026-10-17 · Initial upload

- Textbook-style zhuyin beside every Traditional Chinese character, word-segmented, with Taiwan readings from McBopomofo via yt-zhuyin's dictionary.
- Hover a word for its CC-CEDICT meaning and the meaning of each character.
- Select text for an English translation (Google, or a local opus-mt server), with pinyin and a word-by-word list.
- Compact mode for buttons and pop-ups, per-site on/off/auto, `side` or `top` layout, polyphone highlighting.
- <kbd>Alt</kbd>+<kbd>Z</kbd> show/hide, <kbd>Alt</kbd>+<kbd>T</kbd> translate, <kbd>Esc</kbd> close.
