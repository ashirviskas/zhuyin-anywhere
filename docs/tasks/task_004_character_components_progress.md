# TASK-004: Character parts and origins, tinted characters, settings in tabs — progress

Status: **Implemented and tested in headless Chromium (2026-10-25); not yet tried in Violentmonkey. Not committed.** Word cards show what a character is made of, and clicking a part, or a character of a word, opens its card. Characters can be tinted on every page: the N most common, and the user's own, which are saved and can be exported and imported. The settings panel has tabs, and hovering a look previews it. There are no word cards behind the translation popup, and a one-time "what's new" note appears after an update. All 3 test files pass. README, CHANGELOG (with images) and the README images are updated.

## Full initial request (verbatim)

> Is it possible to split mandarin characters into what makes them? Like how mother is woman + cow. or Forest is 3 trees and/or 2 trees. Etc., it would be nice as option for single character hover. Optional. Please research, give me options as task_003. Where we could get character origins and/or explanation or mnemonics maybe. And ideally we could go recursively deeper. Any such database?

> We do A, B and C. Can we download Wikitionary and gzip and distribute? Clicking to go deeper or expanding tree all sound good, do mokcups of both, present as png images how it would look like. 3. Toggle. Maybe on hover inside the card. Also, disable other hovers when sentence select is shown, to not show on hovers in background. 4. Keep English with optional toggle to translate to primary/secondary language too if non-englush. 5. Sure! Now proceed with making mockups and while waiting for my choice on the visualization, explore the data sources and how best we could combine them.

> Can we also mark top 100 frequency characters in text with unique colors (so they would be lightly tinted/highlighted)? As option ofc. Colors should be very light (controllable) and maybe while randomly generated, still persistent by hash or something between users so same char always same color. Unless color palettes differ. Add palettes as option too. Make proper menus for options. Only in UI, not extension settings. I like A, but should also work for when we hover on two or maybe even three character compounds. So, click sounds good. Not sure about hte second choice, I don't understand it.

> Top 100 could be also controlled, maybe up to top 1000. And option to just mark any character as tinted for future in settings (save persistently pls) so even if tinting for top 100 or 233 or 1000 is disabled, user can still tint some they want to stand out or remember. They could combine both top 100 and their choices.

> Can you ting only the character, not zhuyin too? Or make it as an option? And make tints nicer? And add more palettes?

> Add section in README.md: See how the tool works, with a few sentences and top 100 characters, add nice explanations how features could be used for learning better and marking words etc. Also allow to export and import custom marked characters/tints so that people could migrate between browsers.

> Import could be additive

> Also name this task 004. No need to add zhuiyin to the top 100 as people will see it using the script lol on readme.md

> Sorry, as for characters, it should still show in on hover card.

> Also make boxes aroun dcharacters less tall, now they overlap a bit vertically. In G at least I ee it. Make G as options, I love the way things look, people may have different opinions.

> One file sounds nice.

> Add g-tint styles as presets, change them live when hovering on the options. Make settings more tidy, sections or submenus. Allow to access it on from maybe in violentmonkey settings, so it would pop up, wdyt?. Your small defaults sound good. Proceed to implement. Gl hf! (I will commit only when done and tested)

> show how to say zhuyin in top of readme in zhuyin pls

> Pls make the settings scrollable, as now it may go under the screen sometimes, unless already fixed

> Hide meaning on image is broken, top is cut off on the top

> And shift held is also cut off

> Move top 100 to the bottom in usage somewhere, don't mention how it is built too much like McBopomofo

> Also while moving top X slider don't update the marks, as that makes it laggy and slider doesn't work. Only after releasing the slider may you color stuff

> And can we show little update notif after people upgrade to the v0.9 to link to changelog or something? Add images to CHANGELOG of new features. Then they could learn what they could start using.

> Now the We went to the bank botom is cut off, copy button looks weird. English meanings second image is also cut off. Hide meaning on image and shift held still cut off the top in README.md. Show off highlighter on in first Before and After (mark top 100 and custom mark maybe one or two chars). And maybe in pearl milk tea.

> Add update available notif too for future versions please!

> Also now soft box and coloured text, last line of text is vertically cut off by the frame

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- The pipeline comment at the top of `zhuyin-anywhere.user.js`: steps 10–12 (settings tabs, character parts, tints).
- `README.md`: "See how the tool works", "What a character is made of", "Tint the characters you're learning", "Settings", the settings table by tab, "The 100 most common characters".
- `data/README.md`: what is in `components.tsv.gz`, its sources and its GPL-3.0-or-later licence. `tools/components/README.md`: how it is built.
- `tools/README.md`, `tools/tests/README.md`, `tools/assets/README.md`: tests (`sh tools/run.sh test`), README images (`sh tools/run.sh images`).

## Overview

1. **Character parts.** A one-character word card shows how the character was formed (形聲 meaning + sound, 會意 idea from parts, 象形 picture…), each part with its zhuyin, meaning and role (`meaning`, `sound ㄑㄧˇ → ㄔ`), a hint, the origin from Wiktionary with a link, and the characters a part gives its sound to. Clicking a part, or a character row in a word's card, opens that character's card, with a path (`吃 › 乞`) and ‹ to go back.
2. **Tinted characters.** "Most common" (0–1000) and "My characters" (saved; highlighter on one-character cards; chips, add, export, additive import). Five looks and Style × Covers × Palette (nine) × Strength. A character's colour is a hash of the character into the palette. The tint shows on the page and on the card.
3. **Settings in tabs.** Page, Popups, Translate, Learn, with section titles in Learn. Hovering a look, style or palette previews it on the page. The panel scrolls inside and stays on screen. The new options are panel-only; the Violentmonkey menu keeps "Settings…" (first) and the older options.
4. **No word cards behind the translation popup.**
5. **What's new.** After an update with something new to try, the first page the script runs on shows a small note, once, with links to the changelog and the Learn settings.

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Sources | "We do A, B and C" → Make Me a Hanzi + CJKVI-IDS + Wiktionary, merged |
| Parts data licence | "One file sounds nice." → one `data/components.tsv.gz`, GPL-3.0-or-later, separately licensed in the MIT repo, built by `tools/components/` from pinned upstreams |
| Going deeper | "I like A … click sounds good" → click a part to open its card; path + ‹ back; no tree |
| Words of 2–3 characters | "should also work for when we hover on two or maybe even three character compounds" → each character row of a word's card opens that character's card |
| Default | "Optional" → "Parts on word cards" is a setting (on; the data loads only when a one-character card needs it) |
| Languages | "Keep English with optional toggle to translate to primary/secondary language too if non-englush" → "Translate parts" (off) adds Google's translation of each English part meaning |
| Sound part's zhuyin | "Sure!" → `sound ㄑㄧˇ → ㄔ` |
| Tint common characters | "mark top 100 … very light (controllable) … persistent by hash" + "Top 100 could be also controlled, maybe up to top 1000" → "Most common" slider 0–1000 (off by default); colour = FNV-1a hash of the character into the palette |
| My characters | "mark any character as tinted … save persistently … combine both" → saved string `myChars`, tinted and underlined whether or not Most common is on |
| Export / import | "allow to export and import" + "Import could be additive" → Export writes a text file (a `#` line, then the characters) and copies it; Import adds every Han character of a file, skipping `#` lines, and removes nothing. Tint settings are not exported (kept simple; they're five clicks) |
| Tint only the character | "Can you ting only the character, not zhuyin too? Or make it as an option?" → "Covers: character (default) · character + zhuyin" |
| Nicer tints, more palettes | → OKLCH colours, darker on dark pages; Pastel, Vivid, Earth, Ocean, Forest, Sunset, Berry, Mono, Colour-blind safe |
| Tint on the card | "it should still show in on hover card" → headword, character rows, parts and the panel's sample line are tinted like the page |
| Box height | "make boxes aroun dcharacters less tall" → the character's box is a 1.2em `::before` behind the glyph: glyph-tall, and it moves nothing |
| Looks | "Make G as options" + "Add g-tint styles as presets, change them live when hovering on the options" → "Look": Soft box, Box + zhuyin, Highlighter, Coloured text, Underline; hovering a look, style or palette previews it |
| Sliders | "while moving top X slider don't update the marks … Only after releasing the slider" → a slider only moves its number while dragged; letting go stores and redraws |
| Menus | "Make proper menus for options. Only in UI" + "Make settings more tidy, sections or submenus" → tabs + section titles; Learn-only rows aren't in the Violentmonkey menu |
| Violentmonkey access | "Allow to access it on from maybe in violentmonkey settings, so it would pop up" → "Settings…" is the menu's first entry and opens the panel (it already did) |
| Small defaults | "Your small defaults sound good" → existing menu entries kept; top-N list counted from the zhuyin dictionary |
| Scrollable settings | "make the settings scrollable, as now it may go under the screen" → it scrolled inside but was positioned once; now kept on screen after every redraw |
| Hovers behind the translation | "disable other hovers when sentence select is shown" → no word card while the translation popup is open |
| What's new | "show little update notif after people upgrade to the v0.9 to link to changelog" + "Add images to CHANGELOG of new features" |
| Update available | "Add update available notif too for future versions" → at most once a day, on a page the script runs on, the first KB of the script on `main` (`Range` request, new `@connect raw.githubusercontent.com`); a newer `@version` → a note with Install (Violentmonkey's update page), What's new, Later (tomorrow), Skip this version |
| README | "See how the tool works … top 100 characters … how features could be used for learning" + "No need to add zhuiyin to the top 100" + "Move top 100 to the bottom in usage somewhere, don't mention how it is built too much" + "show how to say zhuyin in top of readme in zhuyin" |
| README images | "Show off highlighter on in first Before and After (mark top 100 and custom mark maybe one or two chars). And maybe in pearl milk tea." → `after.png` and the hover shots with top 100 + 珠, 夜 as My characters |

## Decisions needed

None.

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- Nothing is downloaded or parsed until it's needed: the parts data on the first one-character card, the top-N list when Most common is on.
- Say which part gives the meaning and which the sound. Make Me a Hanzi's hint only where it says more than a name.
- A character's tint is a pure function of the character and the palette, and it moves nothing on the page.

---

## Result

### Where things are

| What | Where |
|---|---|
| Config | `CFG.parts`, `partsLang`, `tintTop`, `tintMine`, `myChars`, `tintStyle`, `tintCovers`, `tintPalette`, `tintStrength` |
| Tint engine | "tints" section: `TINT_CSS`, `PALETTES` (+ `OKABE_ITO`), `fnv`, `tintColour`, `topChars`, `tintSet`, `isDarkPage`, `paint`, `tintCell`, `refreshTints`. Page CSS in `injectCss` (`zy-h::before` for the glyph, `zy-c` for character + zhuyin) |
| Glyph element | `renderRun` wraps each character's text in `<zy-h>`; readers use `firstChild.textContent` |
| Parts data | "character parts" section: `loadComps` (`@resource comps`, jsDelivr fallback), `COMPS`, `SOUND_IN`, `FORMS` |
| Word card | `showGloss` (page side: cells, CEDICT, the piece under the pointer) → `renderCard` (draws a card from `{chars, zys, hi, alts, rect, trail}`; path, highlighter, senses, character rows, parts); `openChar`, `fillParts`, `mkIcon`, `rerenderCard` |
| Settings | `TABS`, `LOOKS`, `SETTINGS` (`tab`, `sec`, `ui`, `live`, `range`, `render`, `extra`), `ctlFor`, `renderSettings`, `setVals`, `preview`/`endPreview`, `looksCtl`, `palettesCtl`, `sampleCtl`, My characters (`setMine`, `addMine`, `toggleMine`, `exportMine`, `mineEditor`) |
| What's new, update available | `VERSION` (`GM_info`), `NEWS`, `whatsNew`; `UPDATE_URL`, `newer`, `checkUpdate` (both called from `start`; they share the `.news` box) |
| No cards behind the translation | `mouseover` handler: returns while `shown('box')` |
| Data build | `tools/components/build.sh`, `build.py`, `fetch_wiktionary.py`; output `data/components.tsv.gz`, licence `data/COPYING`, `data/README.md` |
| Tests | `tools/tests/learn.test.js` (new); `harness.js` fakes `GM_info`, the `comps` resource, `tab()`; `settings.test.js` for tabs |
| Images | `tools/assets/build.js`: new shots `parts`, `parts-open`, `tint`, `tint-ink`, Learn-tab `settings`; tints in `after` and `hover*`; `poster.html` sections `#parts`, `#tint`; README images `parts.png`, `tint.png` |

### Differences from the plan

- The parts section shows for one-character cards. In a word's card the character rows are clickable instead (no extra lines in them), as decided.
- The box for "covers: character" first used `line-height` on `zy-h`, which changed the page layout (the hero image grew). It is now a `::before` behind the glyph. A test checks that tints move no character.
- Export holds only the characters, not the tint settings.
- The "Sound part in" list (characters a part gives its sound to) came from the mockups and is in.

### Checked

- `sh tools/run.sh test`: `learn.test.js` (including the update-available note), `settings.test.js` and `zhuyin-modes.test.js` all pass (2026-10-25, final run).
- Screenshots looked at by eye: `tools/tests/out/learn/*.png` (Learn tab, previews, My characters, parts card, part card, word → character, what's new).
- README images: `before-after`, `hover`, `select`, `dark`, `languages`, `hide-meaning` and `settings` retaken; `parts` and `tint` are new. `hero`, `how-to-read` and `tones` render pixel-identical to HEAD on this machine and are kept as committed. `context` and `compact` are kept as committed too; their content doesn't change.
- `parts.png` and `tint.png` re-rendered with their final crops and checked by eye: nothing is cut off. The comparison worktree is removed.
- Not yet: Violentmonkey in Firefox and Chrome. The `comps` `@resource` URL only works once `data/components.tsv.gz` is on `main`.

### Gotchas (learned the hard way)

- `zy-c` is `inline-flex`, so `<zy-h>` is a flex item (blockified): a background on it is as tall as the line, and changing its `line-height` changes the page's layout. Draw the tint on `zy-h::before` (absolute, 1.2em, `z-index:-1` with `isolation:isolate` on `zy-h`).
- The page CSS sets `all:unset !important` on every `zy-*`, so tint rules must be `!important` too. Custom properties (`--zyt`) are not reset by `all`.
- A class name in the shadow root can clash: the parts section's first class `.cp` was the copy button's class and restyled it.
- When `requestIdleCallback` fires on its timeout, `timeRemaining()` is 0: `work()` did nothing and rescheduled itself forever, so a restarted page (Alt+Z back to `on`) could stay plain. `budget()` now takes a slice when `didTimeout`.
- The Wiktionary fetch's User-Agent must not carry a personal address. The committed one names the repository only.
- Dark pages: tint lightness L − 0.42 with a floor of 0.32 and a stronger alpha; without the floor the Colour-blind palette turns black. A dark page is detected from the body's text colour, which is more reliable than its often transparent background.

## Subtasks

| ID | Description | Status | File |
|----|-------------|--------|------|
| 004.1 | Research data sources, try decomposition recursively | Done | `tmp/t004/data/REPORT.md` |
| 004.2 | Mockups (`tmp/t004/mock/`) | Done | `tmp/t004/mock/` |
| 004.3 | Data build and file | Done | `tools/components/`, `data/` |
| 004.4 | Settings tabs, sections, looks, live preview, sliders on release, on screen | Done | `zhuyin-anywhere.user.js` |
| 004.5 | No word cards behind the translation | Done | `zhuyin-anywhere.user.js` |
| 004.6 | Tints, My characters, export/import, highlighter | Done | `zhuyin-anywhere.user.js` |
| 004.7 | Parts on the card, click into parts and characters, translate parts | Done | `zhuyin-anywhere.user.js` |
| 004.8 | What's new note | Done | `zhuyin-anywhere.user.js` |
| 004.8b | Update-available note (daily check of `main`) | Done | `zhuyin-anywhere.user.js`, `tools/tests/` |
| 004.9 | Tests | Done | `tools/tests/` |
| 004.10 | README, CHANGELOG, images, tools docs | Done | `README.md`, `CHANGELOG.md`, `docs/img/`, `tools/` |
| 004.11 | Try in Violentmonkey (Firefox, Chrome) | Not started | |

## Log

- 2026-10-25: Research, mockups, data merge prototype (see `tmp/t004/`).
- 2026-10-25: Implemented settings tabs, tints, My characters, parts cards, no cards behind the translation, what's new; data build moved to `tools/components/`, `data/components.tsv.gz` built (5,351 rows, 227 KiB; glyph variants 壬/𡈼, 𢛳/㥁 matched). Tests and README images; fixed the idle-callback stall, the `.cp` class clash and the popup crops.

## Suggested commit

```
git commit \
  -m "TASK-004 feat(learn): Add character parts, tinted characters and settings tabs" \
  -m "Why: learners asked to see what characters are made of, to spot the common ones and to mark their own." \
  -m "- Word card: a character's parts with meaning/sound roles, origin from Wiktionary; click a part or a word's character to open its card
- data/components.tsv.gz (GPL-3.0-or-later) from Make Me a Hanzi, CJKVI-IDS and Wiktionary, built by tools/components
- Tint the N most common characters and My characters (highlighter, export, additive import); looks, palettes, live preview
- Settings in tabs; no word cards behind the translation; one-time what's-new note; daily update-available note
- Fix: page left without zhuyin after a restart when the idle callback only ran on its timeout
- README, CHANGELOG with images, README images retaken"
```
