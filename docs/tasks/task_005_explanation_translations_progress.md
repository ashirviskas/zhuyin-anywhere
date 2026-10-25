# TASK-005: Translated explanations, pictographs that don't split — progress

Status: **Implemented, tests run in headless Chromium (2026-10-25); not yet tried in Violentmonkey. Not committed.** A character's hint and origin are translated into the non-English target language(s) with "Translate explanations" on. Pictographs whose Make Me a Hanzi hint names their parts (我 = 扌 + 戈) show them as shape parts. 蹋 no longer claims 日 as its sound part. Ships as 0.9.1.

## Full initial request (verbatim)

> When character is explained, parts of it, it should also show translated explanation in the other non-english language if it is on in the settings. And some don't properly split: [Image #2] and this one is weird: [Image #3] explain why, enable explanation translations in settings

> We'll release 0.9.1 maybe or something like that

Image #2: the card for 我 (象形 picture, hint "A hand 扌 holding a weapon 戈", no parts). Image #3: the card for 日 (象形, no parts; EN line with CC-CEDICT's "(vulgar) to fuck"; "Sound part in: 圼 汨 蹋").

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- `docs/tasks/task_004_character_components_progress.md`: the parts card and the data this builds on.
- `tools/components/README.md` "How the merge decides", `data/README.md`: the parts data.
- `tools/README.md`: `sh tools/run.sh test`.

## Overview

1. **Translate explanations** (was "Translate parts", key `partsLang`, off by default): the part meanings, the hint and the origin, from English into each non-English target language. Meanings get ` · <translation>` after the English as before; the hint and origin get one line per language under the English, tagged `LT`.
2. **Why 我 and 日 have no parts.** Both are pictographs (Wiktionary: 象形). The build drops a pictograph's parts unless one is a meaning or sound part, so 木 isn't shown as 十 + 八. 日 really has no parts. 我 is a picture of a weapon too, but Make Me a Hanzi's memory aid reads it as 扌 + 戈, so its parts are now kept as shapes when the hint names every one of them (72 characters: 我, 果, 東, 中, 主, 元…).
3. **Why 日's card is odd.**
   - "Sound part in: 圼 汨 蹋": none of them sounds like ㄖˋ. 汨 (ㄇㄧˋ) and 圼 (ㄋㄧㄝˋ) are Wiktionary's analyses, which go by Old Chinese, where they did rhyme; kept. 蹋 (ㄊㄚˋ) was Make Me a Hanzi's mistake: its sound part is 𦐇 (itself 日 + 羽), not 日. The build now drops a Make Me a Hanzi sound part that the structure only holds nested and that sounds nothing like the character; only 蹋 changes.
   - "(vulgar) to fuck; to have sex with" is a real sense of 日 in CC-CEDICT (mainland slang), so it's shown like any other sense. Left as is.
   - Boxes in the origin (𢦐 oracle-bone form, 𓇳 Egyptian hieroglyph) are characters the system fonts don't have. Left as is.
4. **What's new** now lists every version since the one last seen, so 0.8 users moving to 0.9.1 still get the 0.9.0 note.

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Translated explanations | "it should also show translated explanation in the other non-english language if it is on in the settings" + "enable explanation translations in settings" → the existing toggle covers hint and origin, renamed "Translate explanations"; still off by default |
| Version | "We'll release 0.9.1" → `@version 0.9.1`, CHANGELOG `## 0.9.1`, a `NEWS` entry |

## Decisions needed

None.

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- Fix data in the build, not in the card.

## Result

### Where things are

| What | Where |
|---|---|
| Translated hint and origin | `fillParts` in `zhuyin-anywhere.user.js`: `notes`, one `.org.ot` slot per language under each, filled from one `translateWords(texts, l, 'en')` call with the part meanings |
| Setting | `SETTINGS` entry `partsLang`, label "Translate explanations" |
| Pictograph shape parts | `tools/components/build.py` `Merger.merge`, the `ty in ("pic", "ind")` check |
| Sound-alike check | `build.py` `syllable`, `sounds_alike`, used where A's nested sound part would be appended |
| What's new | `NEWS['0.9.1']`, `whatsNew` (every version newer than `seenVersion` up to `VERSION`) |
| Tests | `tools/tests/learn.test.js`: translated origin, 我's shape parts, what's new across two versions |

### Checked

- `sh tools/run.sh test`: learn, settings and zhuyin-modes all pass (2026-10-25). Screenshot `tools/tests/out/learn/11-translated-origin.png` checked by eye.
- README images retaken; only `docs/img/settings.png` changed in content (the new label), the rest reverted.
- Data diff against 0.9.0's `components.tsv.gz`: 72 pictographs gain shape parts, 蹋 loses 日, 3 new rows reached through them (亍, 双, 叒). Size unchanged (227 KiB).
- Not yet: Violentmonkey in Firefox/Chrome. The `comps` resource comes from jsDelivr's `@main`, which can serve the old file for up to a few days after the push.

### Gotchas

- The class `.tl` is already the card's translation line (`.gl .tl`, 17px); the translated origin first used it and came out large. It is `.ot`.
- A sound check on every Make Me a Hanzi sound part removed ~50 real ones (凋 diāo / 周 zhōu, 棵 kē / 果 guǒ): today's Mandarin is too far from the series. It is limited to sound parts the structure only holds nested, where it hits only 蹋.

## Subtasks

| ID | Description | Status | File |
|----|-------------|--------|------|
| 005.1 | Translate hint and origin | Done | `zhuyin-anywhere.user.js` |
| 005.2 | Pictograph shape parts, 蹋 sound part | Done | `tools/components/build.py`, `data/components.tsv.gz` |
| 005.3 | What's new across versions, 0.9.1 | Done | `zhuyin-anywhere.user.js`, `CHANGELOG.md` |
| 005.4 | Tests, README, tools docs, settings image | Done | `tools/tests/learn.test.js`, `README.md`, `tools/components/README.md`, `docs/img/settings.png` |
| 005.5 | Try in Violentmonkey | Not started | |

## Log

- 2026-10-25: Implemented all of the above; data rebuilt; fixed the `.tl` class clash; tests pass; `settings.png` retaken.

## Suggested commit

```
git commit \
  -m "TASK-005 fix(learn): Translate hints and origins, split pictographs their hint describes" \
  -m "Why: cards for 我 showed no parts though the hint names 扌 and 戈, 日 listed 蹋 as sounding like it, and only part meanings were translated." \
  -m "- Translate explanations (was Translate parts): hint and origin too, one line per language under the English
- Build: keep a pictograph's parts as shapes when Make Me a Hanzi's hint names them all (72 characters)
- Build: drop Make Me a Hanzi's nested sound part when it sounds nothing like the character (蹋 is 足 + 𦐇)
- What's new lists every version since the last one seen; 0.9.1"
```
