# Tests

Each `*.test.js` opens `../assets/site.html` (the demo blog page) in headless Chromium, loads the real `zhuyin-anywhere.user.js` into it, and drives it the way a user would: moving the mouse onto a word, selecting text, pressing keys, clicking in the settings panel. It prints one `PASS`/`FAIL` line per check and exits non-zero on any failure.

Run them with `sh tools/run.sh test` from the repository root; setup is in [`../README.md`](../README.md).

| File | Covers |
|---|---|
| `harness.js` | Shared setup, see below |
| `settings.test.js` | Settings panel tabs and menu, target languages, word card and word list translations, copy, hide meaning and its reveal key, the read-aloud key |
| `zhuyin-modes.test.js` | Zhuyin on page (`on`/`hover`/`off`, Alt+Z), hover label vs. in the line, zhuyin in popups by each character |
| `learn.test.js` | Tinted characters (top N, dark pages, nothing moves), looks previewed on hover, My characters (highlighter, add, remove, export, additive import), character parts and clicking into them, no cards behind the translation, the one-time "what's new" note |

## What `harness.js` fakes

- **Violentmonkey's `GM_*` API.** Settings live in a plain object: pass starting values as `page(browser, { zhuyin: 'hover' })` and read what the script saved from `__st` in the page. Menu commands collect in `__menu`, the clipboard in `__clip`. `GM_info` carries the script's `@version`, and `seenVersion` is set to it unless a test passes its own, so the "what's new" note stays away.
- **Resources.** `zydict` from `../assets/vendor/`, `cedict` likewise, `comps` from `../../data/components.tsv.gz`.
- **Google.** Every request is logged in `__req`. A translation comes back as `<target language>:<source line>`, line by line, so a test can see which language was asked for and how lines were batched. Read-aloud requests fail at once, so no audio plays.
- **The closed shadow root.** `attachShadow` is patched to open it, and `sh(p, js)` runs `js` with `$`/`$$` bound to the popup's shadow root.

`hover(p, word)` puts the pointer on a word on the page and waits for the card; `select(p)` selects 我們先去銀行換錢 and lets the translation open; `tab(p, 'Learn')` switches the open settings panel's tab.

## Screenshots

Each test also saves screenshots of the states it checks to `out/<test name>/` (git-ignored). They aren't compared to anything; they're for a look by eye after a UI change.

## Adding a test

Copy the top three lines of an existing test, then `(async () => { const browser = await chromium.launch(); … await done(browser); })();`. Keep one test file per feature area, and name each check after the behaviour it proves (`'hover: word did not move or widen'`).
