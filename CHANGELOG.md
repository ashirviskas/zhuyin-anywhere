# Changelog

Newest first. Versions are the userscript's `@version`; each entry lists the commits that make it up.

## 0.8.0

### `<hash>` · 2026-10-18 · TASK-003 feat(zhuyin): Add zhuyin on page on/hover/off and zhuyin beside characters in popups

- "Zhuyin on page": `on`, `hover` or `off`, saved, for all sites. The text stays annotated, so the word card and the translation box work as before. Alt+Z switches between the three instead of a show/hide that was forgotten on reload.
- `hover`: the word under the pointer gets one label with its zhuyin above it, outside the text flow so nothing moves. "Hover zhuyin: in the line" draws it beside the characters instead.
- "Zhuyin in popups": `by each character` (textbook style, the default) or `after the word` in the word card, the selected text (up to 120 characters) and the word list.

## 0.7.0

### `<hash>` · 2026-10-17 · TASK-002 feat(popup): Add settings panel, target languages and hide-meaning mode

- ⚙ on the word card and the translation popup opens a settings panel with every option, applied right away. One settings table drives both the panel and the Violentmonkey menu (all entries kept, plus "Settings…").
- "Translate to": every language Google Translate offers (132, English and Lithuanian first; any other code from the menu), and an optional "Second language" shown under the first. Non-English languages come from Google in the card (word and characters) and the word list too, one batched request each, cached; English keeps CC-CEDICT. With two languages every line is tagged (`LT`, `EN`).
- "Hide meaning": popups open as usual but translations are blurred while the reveal key (Shift, Alt or Ctrl) isn't held; pressing and holding the blurred text also reveals it.
- R reads the open word card, else the translation popup, aloud; only while one is open and not while typing. The letter is a setting, with or without Alt.
- The popup is built with DOM calls instead of `innerHTML`, so it also opens on pages that enforce Trusted Types.
- In-memory translation cache is keyed by language; `local` opus-mt only for English.
- README images: new `languages.png`, `hide-meaning.png`, `settings.png` (dark mode); `hover.png`, `select.png`, `dark.png` retaken with the ⚙. `build.js` replays canned answers per language and line, and dark examples share a `.night` block.

## 0.6.0

### `<hash>` · 2026-10-17 · feat(popup): Add word-list speakers, CC-CEDICT word split, cache, dark theme and touch

- Every row of the selection word list has its own speaker button.
- Segmenter words that CC-CEDICT doesn't list (IME phrases like 我在, 最好的) are split into CC-CEDICT words in the word list and the hover card. The card shows the piece under the pointer, and only that piece is tinted on the page.
- Google translations and voice clips are cached in IndexedDB, per site, 100 MB by default (menu "Cache"; 0 = off), least recently used first out.
- Menu "Popup theme": `auto` (follows the system), `dark` or `light`. New README image `dark.png`.
- Touch: tapping a word opens its card; a long-press selection is translated once it stops changing. Emulated mouse events from taps are ignored.
- `tools/assets/fetch-deps.sh`: progress bar, retries, and skips files it already has.

## 0.5.1

### `<hash>` · 2026-10-17 · fix(popup): Keep hover card closed while drag-selecting text

- Hover card no longer opens for words dragged over while selecting; an open card closes when a button is pressed.
- Translation popup (auto or <kbd>Alt</kbd>+<kbd>T</kbd>) closes any open hover card first, so the card can't sit on top of it.

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
