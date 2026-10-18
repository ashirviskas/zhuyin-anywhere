# Zhuyin Anywhere

<img src="docs/img/hero.png" alt="注音 written large, with its zhuyin symbols beside each character" width="360" align="right">

A Violentmonkey userscript for reading Taiwanese websites while learning Mandarin.

- Writes **zhuyin** (Taiwan's pronunciation symbols) beside every Traditional Chinese character on any page.
- Shows the **meaning** of a word when you point at it, in English or any of about 130 other languages.
- **Translates** whatever text you select, into one or two languages.
- **Reads aloud** any word or selected text in a Taiwan Mandarin voice: click the speaker or press <kbd>R</kbd>.

Works in Firefox and Chrome on news sites, blogs, YouTube and anything else written in Traditional Chinese.

<br clear="right">

## Never seen zhuyin before?

Chinese characters don't tell you how to pronounce them. Children in Taiwan learn pronunciation with **zhuyin** (注音), also called **bopomofo**: 37 sound symbols written in a small column right beside each character. Read the column from top to bottom, then apply the tone mark.

<p align="center"><img src="docs/img/how-to-read.png" alt="The character 銀 with its zhuyin ㄧㄣˊ, annotated: ㄧ sounds like 'ee', ㄣ sounds like 'n', ˊ is a rising tone" width="820"></p>

Mandarin has four tones plus a light, neutral one. The same sound said with a different pitch is a different word:

<p align="center"><img src="docs/img/tones.png" alt="媽 mā mother, 麻 má hemp, 馬 mǎ horse, 罵 mà to scold, 嗎 ma question word, each with its zhuyin and a pitch curve" width="820"></p>

| Mark | Tone | How it sounds |
|---|---|---|
| *(none)* | 1st | high and flat |
| ˊ | 2nd | rises, like asking "yes?" |
| ˇ | 3rd | dips, then comes back up |
| ˋ | 4th | falls sharply |
| ˙ (dot above the column) | neutral | short and light |

## Features

### Zhuyin on every page

When you turn it on, every Traditional Chinese character on the page gets its zhuyin, including headlines, menus, article text and comments. The page itself isn't changed otherwise. When you copy text, you get clean Chinese without the symbols mixed in.

Once you can read more on your own, set **Zhuyin on page** in the settings (or press <kbd>Alt</kbd>+<kbd>Z</kbd> to switch):
- `on`: zhuyin beside every character, as above.
- `hover`: plain text. Point at a word and its zhuyin appears in a small label above it, without moving the text. With **Hover zhuyin** set to `in the line`, it's drawn beside the characters instead, like `on`. The text then gets wider, so a word at the end of a line can jump to the next one.
- `off`: plain text everywhere.

In all three, the word card and the translation box still work and show the zhuyin.

<p align="center"><img src="docs/img/before-after.png" alt="The same blog page before and after: plain Chinese on the left, Chinese with zhuyin beside each character on the right" width="820"></p>

### Point at a word to see what it means

Hovering over a word opens a card with:
- the word with its zhuyin in large print, and a speaker button that reads it aloud,
- the English for the whole word,
- what each character means on its own, with the one under your cursor highlighted.

The script groups characters into words with a typing (IME) dictionary, which also lists short phrases such as 我在 or 最好的. When CC-CEDICT has no entry for such a group, the card covers only the CC-CEDICT word under your cursor (最好 or 的), and only that part is highlighted.

On a phone or tablet (Firefox for Android with Violentmonkey), tap a word to open its card.

In this example, "pearls + milk + tea" turns out to be bubble tea.

With **Zhuyin in popups** set to `by each character`, the card, the selected text in the translation box and its word list show the zhuyin beside each character, textbook style, instead of after the word.

<p align="center"><img src="docs/img/hover.png" alt="Hover card for 珍珠奶茶: pearl milk tea, bubble milk tea; 珍 precious thing, 珠 bead (highlighted), 奶 breast, 茶 tea" width="560"></p>

### Select text to translate it

Highlight any text to get its translation (English unless you choose another language), with a speaker button that reads the text aloud. Selections of up to 24 characters also get a word-by-word breakdown with each word's zhuyin and its own speaker button. Pinyin (the Latin-letter spelling of the same sounds) can be switched on in the settings. On touch screens, long-press to select; the translation opens once the selection stops changing.

Translations and voice clips are cached, so text you've already looked up on a site loads instantly and doesn't ask Google again.

While the translation is open, the word card appears beside it rather than on top of it.

<p align="center"><img src="docs/img/select.png" alt="Selected sentence 我們先去銀行換錢 with a popup showing pinyin, the English translation and a word list" width="560"></p>

<sub>The screenshots come from a demo page. The English sentence in this one was supplied offline, but the word list underneath is real dictionary output. The second language in the images below (Lithuanian, as an example) is Google's real answer, recorded once and replayed.</sub>

### Your own language

Translations go to English by default. Under **Translate to** in the settings you can pick any other language, such as Spanish, Japanese or German, and under **Second language** a second one, which shows under the first everywhere, each line tagged with its language code (`ES`, `EN`):
- the translation of the selected text,
- the word-by-word list under it,
- the word card, for the whole word and for each character.

English meanings come from the CC-CEDICT dictionary. Other languages come from Google Translate: one request per card or word list, cached like sentence translations. Every language Google Translate offers is in the list, about 130 of them.

<p align="center"><img src="docs/img/languages.png" alt="Dark word card for 夜市 with LT naktinis turgus and EN night market, and its characters in both languages; dark translation box for 我們先去銀行換錢 with a Lithuanian and an English line and a word list in both" width="820"></p>

### Hide the meaning, practise reading

With **Hide meaning** on, the card and the translation box still open, with the Chinese, the zhuyin and the speaker, but every translation is blurred. You read the zhuyin, listen, guess, and then check.

How to use it:
1. Open the settings (⚙ on any card or translation box) and set **Hide meaning** to `on`.
2. Point at a word or select a sentence. The popup opens with the meanings blurred.
3. Press <kbd>R</kbd> to hear it read aloud (press again to stop).
4. Hold <kbd>Shift</kbd> to see the meaning. Let go and it's blurred again.

On a touch screen, press and hold the blurred text instead. The reveal key can be <kbd>Shift</kbd>, <kbd>Alt</kbd> or <kbd>Ctrl</kbd> (**Reveal key**), and the read-aloud key can be another letter, with or without <kbd>Alt</kbd> (**Read aloud key**).

<p align="center"><img src="docs/img/hide-meaning.png" alt="The same translation box twice: on the left the translations and word meanings are blurred, the Chinese and zhuyin readable; on the right, with Shift held, everything is readable" width="820"></p>

### Settings

The ⚙ button on the word card and in the translation box opens the settings, with every option visible at once. Changes apply right away. The same settings are also in Violentmonkey's menu for this script, and its **Settings…** entry opens the same panel. <kbd>Esc</kbd> or a click outside closes it.

<p align="center"><img src="docs/img/settings.png" alt="Dark settings panel: site mode, Translate to Lithuanian, second language, translator, hide meaning, reveal key, read aloud key, word gloss and the other options as button groups" width="400"></p>

### Dark popups

The card, the translation box and the settings follow your system's light or dark setting. To always use one of them, set **Popup theme** in the settings.

<p align="center"><img src="docs/img/dark.png" alt="The hover card for 珍珠奶茶 and the translation popup for 我們先去銀行換錢, both with dark backgrounds" width="820"></p>

### It reads words, not single characters

Many characters are pronounced differently depending on the word they're in. The script splits text into dictionary words first, so it picks the reading the word needs. Here 行 is *xíng* ("to walk") in 行人 (pedestrian), but *háng* ("a business") in 銀行 (bank):

<p align="center"><img src="docs/img/context.png" alt="行人 with 行 read ㄒㄧㄥˊ, and 銀行 with 行 read ㄏㄤˊ, the differing character circled in red" width="820"></p>

### Pop-ups and buttons stay usable

Zhuyin makes text about 40% wider, and small fixed-size boxes weren't designed for that. So the script uses **compact mode** in these places: the text is still annotated, so hovering works and the card shows the zhuyin, but the symbols aren't drawn on the page. Compact mode applies to:
- buttons, tabs and menus,
- anything pinned to the screen, such as pop-ups, toasts and sticky headers,
- any box that would start overflowing once zhuyin is added.

Boxes that already cut their text off on purpose, such as "Read more" previews and one-line titles ending in "…", keep their zhuyin.

<p align="center"><img src="docs/img/compact.png" alt="A newsletter pop-up with full zhuyin where the buttons cover the text, next to the same pop-up in compact mode where everything fits" width="820"></p>

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) for your browser: [Firefox](https://addons.mozilla.org/firefox/addon/violentmonkey/), [Chrome](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) or [Edge](https://microsoftedge.microsoft.com/addons/detail/eeagobfjdenkkddmbclomhiblgggliao).
2. Click **[install zhuyin-anywhere.user.js](https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js)**. Violentmonkey opens its install page; click **Install**. Updates are picked up automatically after that.
3. Open any Traditional Chinese page.

### Other ways to install

- **From a link, by hand:** Violentmonkey icon → ⚙ (dashboard) → **+** → **Install from URL**, and paste the raw link above.
- **A branch other than `main`:** use its raw link, `https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/<branch>/zhuyin-anywhere.user.js`. Note that the script's `@updateURL` points at `main`, so auto-update brings you back to `main`.
- **From a local clone:** open `zhuyin-anywhere.user.js` in the browser (drag it into a tab, or open `file:///path/to/zhuyin-anywhere/zhuyin-anywhere.user.js`). Violentmonkey opens its install page. Tick **Track local file before this window is closed** to reinstall on every save while you edit the script. In Chrome this needs file access, see below.

### Local files (`file://` pages)

The script also runs on HTML files opened from disk, but the browser has to let Violentmonkey in first:

- **Chrome / Edge / Brave:** open `chrome://extensions` (`edge://extensions` in Edge) → Violentmonkey → **Details** → turn on **Allow access to file URLs**. Then reload the page.
- **Firefox:** nothing to do; extensions can run on `file://` pages already.

Then in the script itself:

- Local files are treated as one site called *local files*, `auto` by default: zhuyin is added only when the page looks like Traditional Chinese.
- To force it, open the Violentmonkey icon on a local page → this script → **Local files: auto → on**. Or press <kbd>Alt</kbd>+<kbd>Z</kbd> on a page the script skipped.
- The dictionaries come from Violentmonkey's storage, so no network is needed on local pages, except for Google translation and read-aloud.

On install, Violentmonkey downloads two dictionaries once and keeps them in its storage:
- the zhuyin dictionary from [yt-zhuyin](https://github.com/ashirviskas/yt-zhuyin), about 6.5 MB,
- CC-CEDICT from MDBG, about 4 MB gzipped.

Neither is loaded on pages that have no Chinese text. The meaning dictionary is only unpacked the first time you hover over a word, which takes about 200 ms.

## Usage

### Keys

| Key | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>Z</kbd> | Switch **Zhuyin on page**: `on` → `hover` → `off`. Saved. On a page the script skipped, this turns the script on. |
| <kbd>Alt</kbd>+<kbd>T</kbd> | Translate the selection (when automatic translation is off) |
| <kbd>R</kbd> | Read the open word card, or else the translation box, aloud; again to stop. Only while one is open and you aren't typing; otherwise the key goes to the page. The letter is a setting, and so is whether it needs <kbd>Alt</kbd> (<kbd>Alt</kbd>+<kbd>R</kbd>). |
| <kbd>Shift</kbd> (held) | Show the meanings while **Hide meaning** is on. The key is a setting: <kbd>Shift</kbd>, <kbd>Alt</kbd> or <kbd>Ctrl</kbd>. |
| <kbd>Esc</kbd> | Close the translation box, word card or settings, and stop reading aloud |

### Settings (⚙ on a popup, or Violentmonkey icon → this script)

| Setting | Options |
|---|---|
| This site | `auto` (on when the page looks like Traditional Chinese) → `on` → `off`. Remembered per site. |
| Translate to | English (default) or any language Google Translate offers: Spanish, Japanese, German… In the menu, any Google language code can be typed. |
| Second language | `none` (default) or a second language, shown under the first |
| Hide meaning | Off, or on: translations are blurred until the reveal key is held |
| Reveal key | <kbd>Shift</kbd> (default), <kbd>Alt</kbd> or <kbd>Ctrl</kbd> |
| Read aloud key | A letter, <kbd>R</kbd> by default, or <kbd>Alt</kbd> + a letter |
| Zhuyin on page | `on` (default), `hover` (only on the word under the pointer) or `off`. The word card always shows it. |
| Zhuyin in popups | `after the word` (default) or `by each character`, in the word card, the selected text and the word list |
| Hover zhuyin | With `hover`: `label above` (default, moves nothing) or `in the line` |
| Layout | `side`: textbook style, symbols beside the character. `top`: horizontal, above the character. |
| Highlight polyphones | Tints characters whose reading is a best guess between several options |
| Buttons & popups | `compact` or full zhuyin everywhere |
| Word gloss | `hover`, `alt` (only while holding <kbd>Alt</kbd>), or `off` |
| Translator | `google` (Google's free web endpoint, no key) or `local` (yt-zhuyin's `asr_server.py`, opus-mt, offline). `local` translates to English only; other languages always use Google. |
| Pinyin in translation | Off: the word list shows zhuyin. On: a pinyin line under the selected text, and pinyin in the word list. |
| Translate on select | On, or off so that only <kbd>Alt</kbd>+<kbd>T</kbd> translates |
| Popup theme | `auto` (follows the system) → `dark` → `light` |
| Cache | Size of the translation and voice cache per site in MB, 100 by default. 0 turns it off. |

## How it works

- **Readings:** the McBopomofo dictionary data with Taiwan (MOE) readings, plus word frequencies, via yt-zhuyin's `zhuyin-dict.js`. Text is split into words with the same unigram max-likelihood segmenter yt-zhuyin uses, so readings come from words rather than single characters.
- **Rendering:**
  - Uses custom elements (`<zy-w>`, `<zy-c>`, `<zy-z>`…) instead of `<span>`, so site CSS aimed at `span` can't touch them.
  - Its selectors are boosted with `:is(#zyh#zyh#zyh, …)` and start from `all: unset`, which overrides `*` and `.content *` rules too.
  - Adds a `<wbr>` after every word, so Firefox can wrap lines between annotated words.
- **Performance:**
  - Text nodes are processed in idle-time slices.
  - A `MutationObserver` picks up content added later (SPAs, infinite scroll, YouTube navigation).
  - Layout is measured in batches: once before and once after each slice. That's what drives the overflow guard behind compact mode.
- **Meanings:** CC-CEDICT, sorted so the entry whose reading matches the zhuyin on the page comes first. That includes CC-CEDICT's "Taiwan pr." notes.
- **UI:** the hover card and translation popup live in a closed shadow root, so page styles can't affect them.
- **Cache:** Google translations and voice clips are stored in IndexedDB, and the least recently used are dropped first once the size limit is reached. Only audio that decoded and translations that parsed are stored, so an error page is never cached.

## Known limitations

- **Neutral tones:** McBopomofo stores dictionary tones, so some words show a full tone where textbooks write the neutral ˙. For example, 覺得 shows ㄉㄜˊ instead of ˙ㄉㄜ. The hover card corrects the character breakdown using CC-CEDICT, but the zhuyin on the page stays as the dictionary has it.
- **Word list senses:** the selection word list shows each word's first CC-CEDICT sense, which isn't always the one the sentence uses. 搭 comes out as "to put up", not "to take (the MRT)". The hover card lists more senses.
- **React/Vue sites:** replacing text nodes can crash some single-page apps on their next re-render. If a site breaks, set it to `off` in the settings or the menu.
- **Other languages:** Google translates Chinese into most languages through English, so the result can be a step further from the original than the English is. Single function words come out badly: 的 on its own can come back as a word for "from". English word meanings come from CC-CEDICT and are the most reliable.
- **Google translation:** the `google` translator uses an unofficial endpoint and can occasionally be rate-limited. The popup then shows an error instead of the translation.
- **Read aloud:** uses Google Translate's unofficial voice endpoint, with a Taiwan Mandarin speaker. When it can't be reached, the browser's own voice reads instead; on Linux that is often espeak-ng, which sounds robotic. The button's tooltip says when that happened and why. Google chooses the reading itself, so a single character can come out differently from the zhuyin on the page.
- **Cache is per site:** IndexedDB belongs to the website's origin, so each site keeps its own cache, up to the set size each. Userscript storage is shared across sites, but Violentmonkey loads all of it into every page, which would slow every page load. Clearing a site's data in the browser also clears its cache.
- **Simplified Chinese:** pages in Simplified Chinese are skipped in `auto` mode, because the dictionary covers Traditional characters.

## Related

[yt-zhuyin](https://github.com/ashirviskas/yt-zhuyin) is a YouTube transcript panel with the same zhuyin rendering, and it's where this script's dictionary comes from. The two scripts can run side by side: this one doesn't annotate yt-zhuyin's panel.

## Credits and license

MIT, see [`LICENSE`](LICENSE).

- **Zhuyin readings:** [McBopomofo](https://github.com/openvanilla/McBopomofo) dictionary data (MIT), via yt-zhuyin. The script downloads it at install; this repo doesn't include it.
- **Word meanings:** [CC-CEDICT](https://cc-cedict.org/) by MDBG ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Also downloaded at install, not included here.
- **Fonts in the README images:** LXGW WenKai TC, Noto Sans TC and Literata, all under the SIL Open Font License.

## Images in this README

The images are rendered from [`tools/assets/`](tools/assets/), which runs the real userscript in headless Chromium. Run `node build.js` there to regenerate them after changing the script.
