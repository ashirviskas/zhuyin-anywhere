# TASK-010: Settings panel full height, double-tap reveal key — progress

Status: **Done (2026-10-29). Not committed.** The settings panel opened from a word card is as tall as its tab (up to the window) wherever the card was. A double tap of the reveal key (Shift by default) on an open card or translation box switches Hide meaning on or off. Tests in `tools/tests/settings.test.js` (sections 9 and 10). Version 0.9.5.

## Full initial request (verbatim)

> Read docs/tasks/task_template.md new task. See why tf sometimes settings open in such a small window. And then it becomes scrollable but only see a few lines. Super inconvenient. Repro and make it bigger by default. Also allow to switch the translate reveal by double clicking the trigger. Like if on double shift turns it off (always shows), double shift turns it back on.

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- `README.md`: Keys table, Hide meaning section, settings table.
- `tools/README.md`: `sh tools/run.sh test`.
- `docs/tasks/task_008_long_pages_popup_size_placement_progress.md`: where `place()`'s "side from the anchor, height capped to the room on that side" rule comes from.

## Overview

1. The settings panel opens full height (its tab's height, at most the window) instead of being capped to the room beside the card whose ⚙ opened it.
2. A double tap of the reveal key switches **Hide meaning**, saved like any setting.

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Panel size | "Repro and make it bigger by default" → as tall as the tab, only the window caps it |
| Toggle | "if on double shift turns it off (always shows), double shift turns it back on" → the double tap flips the **Hide meaning** setting itself (stored, menu updated), not a temporary state |

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- The panel never opens smaller than its content when the window has room.
- A double tap only counts where its effect is visible: a card or translation box open, not typing.

---

## Current analysis

### Why the panel was small

`openSettings(rect)` places the panel with `place(rect, pop.set)`. `place()` had two paths:

- With the translation popup open: a free spot around the anchor, clear of the popup, no height cap. Fine.
- Otherwise (⚙ on a word card, which is hidden first): the card path from TASK-008: open below the anchor if it's in the upper half, else above, and cap `maxHeight` to the room on that side. The anchor is the **whole card**, so a card in the middle of the window leaves little room on either side.

Repro (640×600 window, Page tab is 459 px of content):

| Card (top–bottom) | Panel height |
|---|---|
| 308–539 | 298 px |
| 159–390 | 200 px |
| 299–530 | 289 px |

A taller card (character parts, two languages, larger Popup size) leaves even less: a few lines.

## Chosen solution implementation details

The settings panel always takes the free-spot path: below its opener, then above, then (with the translation popup open) beside/below/above that popup; if none fits, at the opener's position moved onto the screen, overlapping. `maxHeight` is cleared, so only the CSS `max-height: calc(100vh - 16px)` caps it. When opened from a card, overlapping the card's old spot is fine: the card is hidden.

Double tap: a tap is a reveal-key press released within 300 ms with no other key pressed in between. On the release of a tap that comes within 400 ms of the previous tap, with a card or translation box open and the user not typing → `setCfg(hideMeaning, !hideMeaning)`. Any other key resets it. The Hide meaning row's `apply` also redraws an open card (`rerenderCard`) so its "hold Shift" hint follows.

**Files modified**

| File | Change | Status |
|---|---|---|
| `zhuyin-anywhere.user.js` | `place()`: settings always on the free-spot path; reveal-key double tap; Hide meaning `apply` redraws the card; hint, header hotkeys, `@version` 0.9.5, what's-new note | Done |
| `tools/tests/learn.test.js` | What's new now lists six versions (0.9.5) | Done |
| `tools/tests/settings.test.js` | 9: panel full height from a card at three heights; 10: double tap on popup and card; not with nothing open, not Shift then Shift+A, not a hold then a tap | Done |
| `README.md` | Keys table row, Hide meaning section, settings table | Done |
| `CHANGELOG.md` | 0.9.5 | Done |

**Out of scope**
- Panel width (380 px) unchanged.
- The panel can still move when a tab of another height is chosen (it is placed again so it fits).

## Subtasks

| ID | Description | Status | File |
|----|-------------|--------|------|
| 10.1 | Repro and fix the panel height | Done | `zhuyin-anywhere.user.js`, `tools/tests/settings.test.js` |
| 10.2 | Double-tap reveal key switches Hide meaning | Done | `zhuyin-anywhere.user.js`, `tools/tests/settings.test.js` |
| 10.3 | README, CHANGELOG, version | Done | `README.md`, `CHANGELOG.md` |

### Gotchas (learned the hard way)

- Counting the second *keydown* as the double tap was wrong: typing a capital right after a Shift tap (Shift, Shift+A) presses Shift down first and toggled Hide meaning. Taps are counted on release, and only if no other key came between.
- A hold to read a meaning followed by a quick tap also looked like a double tap; a tap must be shorter than 300 ms.
- The card's ⚙ passes the whole card's rect as the anchor, not the word's: with the card path, a large card in the middle of the window leaves under 100 px either side.

## Log

- 2026-10-29: Reproduced (200 px of 459 on a 600 px window), fixed `place()` for the settings panel, added the double-tap toggle, tests, docs, 0.9.5. Moved the double tap to key release after a test caught Shift, Shift+A toggling; holds no longer count as taps.

## Result

### Where things are

- `place()` in `zhuyin-anywhere.user.js`: the `b === pop.set ||` branch.
- Reveal-key double tap: `revealAt` set in the document `keydown` handler (reset by any other key), the toggle in the `keyup` handler; `revealTap`/`revealAt` next to `revealKeyDown`.

### Differences from the plan

None.

### Checked

- `sh tools/run.sh test`: all passed.
- Not tried in Violentmonkey by hand.

## Commit suggestion

```
git commit \
  -m "TASK-010 fix(settings): Open the panel full height, double-tap the reveal key to switch Hide meaning" \
  -m "Why: from a word card the panel was capped to the room beside the whole card, often a few lines." \
  -m "- place(): settings panel always in a free spot, only the window caps its height
- Two short reveal-key taps within 400 ms on an open card or popup flip Hide meaning (saved)
- Tests, README, CHANGELOG, 0.9.5"
```
