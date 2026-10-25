# README image sources

Everything in `docs/img/` is rendered from this folder. Each image shows the real userscript (`../../zhuyin-anywhere.user.js`) running in headless Chromium through Playwright. Nothing is mocked up by hand: the zhuyin, the hover card, the word list and compact mode all come from the script's own output.

## Rebuild

The short way, with Node or only podman/docker: `sh tools/run.sh images` from the repository root (see [`../README.md`](../README.md)). By hand:

Requirements: Node 18+, Python 3, curl.

```sh
cd tools/assets
npm install                  # Playwright
npx playwright install chromium
sh fetch-deps.sh             # dictionaries + fonts, about 30 MB, not committed
node build.js                # → shots/*.png and ../../docs/img/*.png
node build.js --poster       # also → out/poster.png (the whole poster as one tall image)
```

With the same Chromium, fonts and dictionaries, the output is byte-identical to the committed images. On another machine, minor anti-aliasing differences are normal.

## Files

| File | What it is |
|---|---|
| `site.html` | A fictional blog page ("散步日記") used as the demo website: a header, nav, title, two paragraphs and a hidden newsletter pop-up. |
| `poster.html` | The layout every image is cut from: practice-grid background, browser frames, and `class="live"` blocks that the userscript annotates itself. |
| `build.js` | Renders everything; the steps are described below. |
| `fetch-deps.sh` | Downloads `vendor/zhuyin-dict.js` and `vendor/cedict.gz`, the same files as the script's `@resource` lines. It then runs `fetch-fonts.py`. |
| `fetch-fonts.py` | Downloads LXGW WenKai TC, Noto Sans TC and Literata from Google Fonts into `fonts/` and writes `fonts.css`, so rendering needs no network. |

`vendor/`, `fonts/`, `fonts.css`, `shots/` and `out/` are generated and git-ignored.

## How `build.js` works

**Stage 1: demo screenshots** (`shots/`). Opens `site.html` at 640 px wide with 2× pixel density. Violentmonkey's `GM_*` API is faked in the page, so the userscript runs unmodified; the character parts come from `../../data/components.tsv.gz`, and the popup's shadow root is opened so a shot can click inside the card. Each state is triggered the way a user would trigger it:

| Shot | How |
|---|---|
| `before.png` | Page without the script |
| `after.png` | Page with the script, the 100 most common characters tinted and 珠, 夜 as My characters (`tintTop: 100`, `myChars: '珠夜'`) |
| `hover.png` | Mouse moved onto 珠 in 珍珠奶茶 and held for 1.6 s, so the hover card opens (large zhuyin, speaker button); same tints as `after.png` |
| `select.png` | 我們先去銀行換錢 selected, then a mouseup, so the translation popup opens with its word list (zhuyin, since pinyin is off by default) |
| `hover-dark.png`, `select-dark.png` | The same two states with Chromium in dark mode: `site.html` has a dark scheme, and the popups follow it (theme `auto`). For `dark.png` |
| `hover-lang.png`, `select-lang.png` | Dark mode, `targetLang: 'lt'`, `targetLang2: 'en'`: the card for 夜市 and the popup for the same sentence. For `languages.png` |
| `hidden.png`, `revealed.png` | The same popup with `hideMeaning: true`, then with <kbd>Shift</kbd> held down. For `hide-meaning.png` |
| `settings.png` | The settings panel on its Learn tab, dark, with the tints of `after.png`, opened through the faked menu's "Settings…" command |
| `parts.png`, `parts-open.png` | Dark: the card for 吃 with its parts; the card for 銀行 with its 銀 row clicked, so 銀's card opens. For `parts.png` |
| `tint.png`, `tint-ink.png` | The page with the tints of `after.png`, as soft boxes and as coloured text (`tintStyle: 'ink'`, Vivid). For `tint.png` |
| `modal-full.png` | Newsletter pop-up with `compactChrome: false` |
| `modal-compact.png` | Newsletter pop-up with the default compact mode |

**Stage 2: poster and README images** (`docs/img/`).
- Opens `poster.html` at 1500 px wide.
- Marks every non-`.live` element `translate="no"`, which the script skips.
- Forces the script on with the setting `site:local files = on`, since the poster is a local file with little Chinese.
- `drawCallouts()` measures the script's real glyph boxes. It uses `Range` rectangles over single characters inside the zhuyin column, so arrows point at the actual ㄧ, ㄣ and ˊ glyphs. It then draws the red-pen SVG arrows and the ellipses around 行.
- Dark-mode examples sit in `.night` blocks, a night version of the sheet that carries its own margin.
- Each entry in `README_IMAGES` is clipped out with 36 px of padding. All prose (headings, captions, URLs) is hidden first, because the README carries the text.

## What's staged

- **The translation is canned.** The English sentence in `select.png` comes from the `TRANSLATIONS` map in `build.js`, because a headless run can't rely on Google's endpoint. The map is per target language and per line (word cards and word lists send one word per line); its Lithuanian is Google's real answer to those exact requests, recorded once. The word list underneath, with each word's zhuyin, is real script output from the real dictionaries. Read-aloud is never clicked, so no audio is fetched; the speaker buttons appear as the script draws them.
- **The demo text was chosen around two known weak spots:**
  - 搭 in a selection would list CC-CEDICT's first sense, "to put up".
  - 東西 would be glossed "east and west", because the dictionary gives it a full tone.

  Both still happen on real pages. The main README lists them under limitations.
- **The demo site is fictional**, and `sanbu-diary.example` is a reserved example domain.

## Design notes

The look is a Taiwanese primary-school workbook. Those textbooks print zhuyin in a column beside every character, just as the script does.

| Token | Value | Use |
|---|---|---|
| paper | `#E4EEE5` | celadon background of the practice sheet |
| grid | `#A3C7B1` | 田字格 squares: 120 px solid rules, with a dashed centre cross drawn by a repeating gradient |
| ink | `#1F2D3A` | blue-black text and frame borders |
| red pen | `#C2362B` | every callout, arrow and circle, like a teacher's corrections |
| sheet | `#FBFDFB` | white cards and browser frames |

Fonts:
- **LXGW WenKai TC:** a 楷書-style face close to textbook lettering, used for the large Chinese.
- **Literata:** a book serif for all Latin text.
- **Noto Sans TC:** draws the zhuyin and the demo site, since it is the first font the script requests. It is bundled rather than taken from the system: a CJK fallback without vertical metrics (WenQuanYi in the Playwright Docker image) stacks a zhuyin column into one glyph.

## Changing things

- **Different demo text:** edit `site.html`, then update the word passed to `charCenter()` and the selection range in `build.js`. If you change the selected sentence, also update `TRANSLATIONS`.
- **A new README image:** add a block to `poster.html` (with `class="live"` if the script should annotate it), then an entry in `README_IMAGES`.
- **After changing the userscript's look:** rerun `node build.js`. Every image picks up the new rendering automatically. If a popup grows, check that the `.crop` boxes in `poster.html` (`data-y`, `data-h`, in CSS px of the 640 px page) still contain it; `shots/*.png` show the full uncropped page.
