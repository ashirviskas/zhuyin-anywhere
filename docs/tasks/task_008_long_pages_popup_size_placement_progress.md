# TASK-008: Long pages, popup size, cards that stay put — progress

Status: **Implemented, tests pass in headless Chromium (2026-10-25); not yet tried in Violentmonkey. Not committed.** Only text near the screen is annotated (on by default), tint previews no longer freeze the page, popups have a size setting, and cards open on a side decided by the word's position, so they don't jump. Ships as 0.9.4.

## Full initial request (verbatim)

> When in settings, sometimes going through the theme settings accidentally hovering on the style or colors make whole page freeze. Also if a lot of text, page seems a bit unrespopnsive. Can we do some optimizations? Like not load characters that are too much off-screen or something? Like load + a few screens worth of characters. Add this near optimization/performance options. Default on. Then bench on longer texts. See ../little_price_zh_tw/build/le-petit-prince-zhuyin.html, bench on it. Go, gl hf

> Also add scaling of the pop-ups to make them bigger with bigger text or smaller.

> Also sometimes new smaller card opens somewhere else when it says "sound part in" and in general things seem to be opening randomly up and down. Please make sure they ALWAYS open in the same direction depending on the vertical/horizontal position so that they would not jump around. Especially annoying when text loads and cards jump around. Or when smaller card opens elsewhere for some reason from the bigger card, so your mouse isn't over it and it all disappears in milliseconds. Opening new card should also lengthen the time it is necessary for stuff to disappear. Please fix here too.

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- The pipeline comment at the top of `zhuyin-anywhere.user.js` (steps 3 and 6 describe this task's parts).
- `tools/README.md`, `tools/tests/README.md`: tests and README images.

## Overview

1. **Lazy annotation.** New setting **Page › Performance › Zhuyin is added**: `near the screen` (default) or `to the whole page`. Text is annotated within 2 screens of the viewport and put back to plain text 6 screens away.
2. **Cheaper tints.** Colours cached per character, only changed cells written, hover previews coalesced to one redraw per frame.
3. **Popup size.** **Popups › Popup size**, 70–200 %, scales the card, the translation and the settings.
4. **Placement.** `place()` picks the side from the anchor's position on screen only and pins the edge facing it. A card opened from a card keeps the pointer's way open for 1.5 s.

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Lazy loading | "load + a few screens worth of characters" → 2 screens ahead, restored at 6 |
| Where | "near optimization/performance options" → a Performance section on the Page tab |
| Default | "Default on" |
| Placement | "ALWAYS open in the same direction depending on the vertical/horizontal position" → upper half below, lower half above; left edge at the word, moved left only by the box's widest size |
| Hide delay | "Opening new card should also lengthen the time" → `glossKeep` 1500 ms after a card opens from a card |

## Decisions needed

None.

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- A popup's position never depends on what it holds right now.

## Result

### Where things are

| What | Where |
|---|---|
| Lazy annotation | `CFG.lazy`, `nearScreens`, `farScreens`; `watch()` with `nearIO`/`farIO` and `screensAway()` before `observe()`; the check in `work()`; reset in `stop()` |
| Tint speed | `tintColour()` cache (`colours`), `paint()` writes only changes, `refreshSoon()` used by `preview()`/`endPreview()` |
| Popup size | `CFG.popupScale`, `scalePx()`/`popScale()` above `popup()`; the `svg{width:14px}` rule so icons scale |
| Placement | `place()`; `.tr,.gl{overflow:hidden auto}`; `.set{max-width:none}`; `renderSettings()` re-places the panel |
| Hide delay | `CFG.glossKeep`, `keepUntil`, `openFromCard()` (used by `openChar`, character rows, `goBack`), `scheduleHide()` |
| Settings rows | Page › Performance › Zhuyin is added (`lazy`, also in the menu); Popups › Popup size (`ui`, panel only) |
| Tests | `tools/tests/long-pages.test.js`, `tools/tests/placement.test.js`, popup size in `settings.test.js` (section 8) |

### Bench

`tmp/bench/bench.js <page> [store json]` (env `SCROLL=steps,px,ms`, `PROF=sweep|scroll`, `NOSCRIPT=1`): loads the script into a page with the faked GM API, then measures annotation, a pointer sweep over 30 tint buttons, scrolling and a word hover. Long tasks via `PerformanceObserver`. Headless Chromium, 1000×800, `tintTop: 300`.

*Le Petit Prince*, plain (`le-petit-prince.html`, 21,409 characters):

| | before | lazy off | lazy on (default) |
|---|---|---|---|
| zy-c / elements after load | 21,409 / 153,755 | same | 585 / 8,140 |
| first annotation, long tasks | 2.5 s (max 1.2 s) | 3.0 s | 0.4 s |
| sweep over 30 tint buttons | 30.4 s (max 3.9 s) | 26.8 s | 1.1 s (max 0.12 s) |
| scroll 150 × 300 px | — | 23.2 s (max 0.34 s) | 1.3 s (max 0.09 s) |
| hover → card | 379 ms | 538 ms | 349 ms |

`le-petit-prince-zhuyin.html` already carries its zhuyin as `<ruby>`, which the script skips (`SKIP_TAGS`): 227 cells (headings, contents), no long tasks while scrolling, and no measurable difference.

### Differences from the plan

- Horizontal placement first pinned the left or right edge by the half of the screen. That squeezed cards near the middle (the 吃 card in `parts.png` wrapped to twice its height), so the left edge is the word's, moved left only by the box's widest possible size.
- Not CSS `zoom` for popup size: in Chromium a zoomed box also scales its own `left`/`top` and `vw`, and Firefox couldn't be checked here.

### Gotchas (learned the hard way)

- `IntersectionObserver` reports an element clipped by a scrolling box as not intersecting however close it is, so the distance is also taken from `boundingClientRect` (`screensAway`).
- `Selection.containsNode` is slow (0.8 s over one scroll run); only called when something is selected.
- The overflow guard's forced layout (`overflowOf`) is most of the remaining scroll cost; it's layout the browser would do anyway.
- A popup's `max-width` excludes padding and border (content-box), the panel's doesn't (border-box); `place()` handles both. The panel inherited `.box`'s `max-width: 460px`, hence `max-width:none`.
- `tools/assets/build.js` renders the tall poster page: it sets `lazy: false`, or its lower half stays plain text and the crops fail.

### Checked

- `sh tools/run.sh test`: learn, long-pages, placement, settings, zhuyin-modes all pass (2026-10-25). Nothing on screen moved by more than 1 px over 12 screens down and back.
- README images rebuilt; only `languages.png` changed in content (the 夜市 card starts a little left of the word). The others differed by anti-aliasing or 1 px rounding against a baseline built from `HEAD`, and were checked out again.
- Not yet: Violentmonkey on Firefox (IntersectionObserver `rootMargin` in %, `getComputedStyle().maxWidth` of a `min()`: if it isn't resolved to px, `place()` falls back to the box's current width).

## Commit suggestion

```
git commit \
  -m "TASK-008 perf(page): Annotate only near the screen, scale popups, open cards on a fixed side" \
  -m "Why: a whole book annotated is 150k elements; hovering the tint looks froze the page for seconds, and cards flipped sides as they filled or opened from a card." \
  -m "- Zhuyin is added near the screen (default) or to the whole page: 2 screens ahead, back to plain text at 6
- Tint colours cached, unchanged cells skipped, previews one redraw per frame
- Popup size 70-200 %: every px of the popups' CSS times --zs
- place(): side from the anchor's screen position, facing edge pinned, height capped; 1.5 s to reach a card opened from a card
- Tests: long-pages, placement, popup size; 0.9.4"
```
