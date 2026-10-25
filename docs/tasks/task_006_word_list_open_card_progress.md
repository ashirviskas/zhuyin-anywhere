# TASK-006: Open a word's card from the translation's word list — progress

Status: **Implemented, tests pass in headless Chromium (2026-10-25); not yet tried in Violentmonkey. Not committed.** Every row of the selection popup's word list ends in a ›. It replaces the popup with that word's card, with the sentence first in the crumb to go back; from the card you can go into its characters and their parts. Ships as 0.9.2.

## Full initial request (verbatim)

> Also, allow to go into symbol/word when highlighting multiple. Like when you list the words, add arrow at the end to be able to click and go inside the word for more. Maybe v0.9.2 for this.

> Nah fam, when you click on little arrow, it should replace the sentence, similar to how when you go into the nested character meanings, not a new window pls.

> Then readme defaults settings. We want newcomers to have good experience, so recommend what defaults we should suggest. I also suggest Translate explanations to on.

> Ok nice, do it flr newcomers.

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- `docs/tasks/task_004_character_components_progress.md`: the word card (`renderCard`), character rows and parts this opens into.
- `tools/README.md`: `sh tools/run.sh test`, `sh tools/run.sh images`.

## Overview

The word list under a selection's translation gets a fifth column, a › button per word. Clicking it hides the popup and opens the usual word card for that word in its place (under the selection). The crumb starts with the sentence (`我們先去銀… › 我們`); clicking it, or ‹, brings the translation back. The card is pinned like the popup: hovering or scrolling the page leaves it, a click elsewhere or Esc closes it. Its character rows open their characters' cards (with parts).

Also in 0.9.2: "Translate explanations" is on by default, a fresh install translates to the browser's language with English second (English only for English and Chinese browsers), and the README settings table names every setting's default.

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Where | "add arrow at the end" → a › button as the last column of each word-list row |
| What it opens | "go inside the word for more" → the word's card (all senses, characters, parts) |
| In place | "it should replace the sentence, similar to how when you go into the nested character meanings, not a new window" → the card replaces the popup; the sentence is the first crumb |
| Translate explanations | "I also suggest Translate explanations to on" → `partsLang` defaults to `true` |
| Newcomer language | Recommended: browser's language first, English second; keep Most common off and the rest as is → "Ok nice, do it flr newcomers" |
| README defaults | "Then readme defaults settings" → every row of the settings table names its default |
| Version | "Maybe v0.9.2 for this" → `@version 0.9.2`, CHANGELOG `## 0.9.2`, `NEWS['0.9.2']` |

## Decisions needed

None.

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- Reuse the hover card as is: no second kind of card.

## Result

### Where things are

| What | Where |
|---|---|
| › button | `fillWordList` in `zhuyin-anywhere.user.js` (`.wl .go`, CSS next to `.wl`) |
| Opening the card | `openWord(chars, zys)`: hides the popup, `glossWord = pop.box` (an element for the card's staleness check), `renderCard` at `selRect` with trail `[{ sentence, chars: [label] }]` |
| Going back | `goBack(t, trail)`: a sentence entry → `showTranslation(sentence, selRect)` (translations are cached), else `renderCard`; used by ‹ and the crumb buttons |
| Staying open | `pinned()`: the popup, or a card whose trail starts with the sentence. The `mouseover` and `scroll` handlers leave the card alone while pinned |
| What's new | `NEWS['0.9.2']` |
| Defaults | `CFG.partsLang` `true`; `BROWSER_LANG` (from `navigator.language`; `zh` → `en`; `nb`/`nn` → `no`, `fil` → `tl`) as `targetLang`'s default, `en` as `targetLang2`'s when it isn't English; README table, `docs/img/settings.png` retaken. Harness `page()` takes a `locale` |
| Tests | `tools/tests/learn.test.js` section 5: › on every row, card replaces the popup with crumb `‹我們先去銀… › 我們`, stays while hovering the page, into 我, sentence crumb brings the translation back |

### Checked

- `sh tools/run.sh test`: learn, settings, zhuyin-modes all pass (2026-10-25). Screenshot `tools/tests/out/learn/12-word-list-open.png` checked by eye: the 我們 card sits under the selection where the popup was, crumb `‹ 我們先去銀… › 我們`.
- README images retaken: `select`, `languages`, `dark`, `hide-meaning` changed (the › column), `settings` (Translate explanations on); the rest reverted as anti-aliasing only.
- Not yet: Violentmonkey in Firefox/Chrome.

## Subtasks

| ID | Description | Status | File |
|----|-------------|--------|------|
| 006.1 | › in the word list, `openWord` | Done | `zhuyin-anywhere.user.js` |
| 006.2 | Test, README, CHANGELOG, images | Done | `tools/tests/learn.test.js`, `README.md`, `CHANGELOG.md`, `docs/img/` |
| 006.3 | Try in Violentmonkey | Not started | |

## Log

- 2026-10-25: Implemented, tested, images retaken; CHANGELOG got TASK-005's hash `a3540d8`.
- 2026-10-25: The card first opened as a second window beside the popup; now it replaces the popup, with the sentence in the crumb.
- 2026-10-25: Translate explanations on by default; README settings table names every default; tests pass.
- 2026-10-25: Browser-language default for Translate to, English second; test with an `lt-LT` browser.

## Suggested commit

Not committed before TASK-007 started; the two share files, so commit them together with the block in `task_007_older_parts_progress.md`. On its own it would be:

```
git commit \
  -m "TASK-006 feat(popup): Open a word's card from the translation's word list" \
  -m "- A › at the end of every word-list row replaces the popup with the word's card; the crumb leads back to the sentence
- Newcomers: translate to the browser's language with English second; Translate explanations on
- README settings table names every default
- What's new note and version 0.9.2; README images with the › column
- CHANGELOG: TASK-005 hash"
```
