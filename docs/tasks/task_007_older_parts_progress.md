# TASK-007: Older parts instead of misleading shapes — progress

Status: **Implemented, tests pass in headless Chromium (2026-10-25); not yet tried in Violentmonkey. Not committed.** Characters whose parts have no meaning or sound role get no shape split. Wiktionary's parts show as "Older parts" when today's glyph doesn't hold them. Single strokes are named as strokes, and the header says when the parts are no longer visible. Ships as 0.9.3.

## Full initial request (verbatim)

> Or this: (the card for 用: 形聲 meaning + sound; parts 冂 wide, 二 two, 丨 number one; origin "formed by adding a handle to 同"; Sound part in: 庸 甬)

> Can you make first plus stroke names plus overriding plus historical parts as their own line plus header honest? Do it in same 0.9.3

The options, from the analysis in chat: (1) drop parts when nothing has a role, unless the hint names them; (2) stroke names for 丨 丿 丶 亅…; (3) overriding their bad dictionary senses (with 2); (4) Wiktionary's parts on their own line; (5) an honest header.

## Read first

- Project rules: never `git stash`, never run `git commit` (print a Suggested commit block instead), temporary files only in `./tmp/`, KISS, one file (`zhuyin-anywhere.user.js`) and no build step, reuse the popup's existing CSS classes and light/dark colours, no backwards compatibility.
- `tools/components/README.md` "How the merge decides", `data/README.md` (format, new `from` column).
- `docs/tasks/task_005_explanation_translations_progress.md`: the pictograph rule this generalises.

## Overview

1. **No shape-only splits.** Any character whose parts have no meaning or sound role gets none, unless Make Me a Hanzi's hint names them all (我 = 扌 + 戈 keeps its shapes). The rule used to apply to pictographs only; 80 形聲/會意 characters (用, 平, 年, 金, 青, 夜, 市, 千…) were split into shapes.
2. **Older parts.** New `from` column: Wiktionary's analysis when the parts shown don't hold it all (850 characters). The analysis naming the most roles wins; for a 形聲/會意 character with neither parts nor roles, the characters its origin's first sentence names, without asides and comparisons (用 → 同). The card shows `Older parts · 年: 禾 meaning + 人 sound`, each part clickable.
3. **Stroke names.** `STROKE_NAMES` (丨 vertical stroke, 丿 falling stroke, 丶 dot, 亅 hook, 乛/𠃌 turning stroke, ㇏ rising stroke) win over every other gloss.
4. **Honest header.** A 形聲/會意 card with no meaning or sound part adds "· no longer visible in today's form".

## User decisions (precise wording)

| Topic | Decision (user's words) |
|---|---|
| Scope | "first plus stroke names plus overriding plus historical parts as their own line plus header honest" → all five |
| Version | "Do it in same 0.9.3" → `@version 0.9.3`, CHANGELOG `## 0.9.3`, `NEWS['0.9.3']` |

## Decisions needed

None.

## Design principles
- **No backwards compatibility** - Clean implementation, update all code in place
- KISS
- Elegant
- Show nothing rather than something misleading.

## Result

### Where things are

| What | Where |
|---|---|
| Shape-only rule | `build.py` `Merger.merge`, before `hist` |
| Older parts | `build.py` `merge` (`cands`, `best`, `hist`), `mentioned()`; `build()` writes column 8 and follows older parts into new rows |
| Stroke names | `build.py` `STROKE_NAMES`, first in `gloss()` |
| Card | `loadComps` reads `from`; `fillParts`: `lost` (header), "Older parts" line (`.org.old`) |
| Tests | `tools/tests/learn.test.js`: 夜 from 夜市 (no rows, header, `Older parts · 亦 sound + 夕 meaning`, click 亦 → crumb `夜市 › 夜 › 亦`); what's new counts 4 versions |

### Checked

- `sh tools/run.sh test`: learn, settings, zhuyin-modes all pass (2026-10-25). `tools/tests/out/learn/13-older-parts.png` checked by eye.
- Data: 5,505 rows (was 5,354: older parts get rows), 232 KiB gz. Spot checks: 用 → 同; 年 禾s 人p; 夜 亦p 夕s; 星 晶p 生p; 重 人s 東p; 金 士s 呂s 亼p; 吃, 媽, 森, 聽 unchanged with no older parts.
- README images: none changed by this task (parts.png shows 吃 and 銀).
- Not yet: Violentmonkey.

### Gotchas

- Taking Wiktionary's first-ranked analysis gave role-less structural ones (夜 → 亠 亻 ㇏) and partial ones (年 → 禾 only). Only analyses with roles (or 會意) count, and the one naming the most roles wins.
- The "characters named in the origin" fallback picked up book titles (㐅 → 說文解字) and comparisons; it is limited to 形聲/會意 characters with no parts, the first sentence, without parentheses and after "compare/contrast/cf./see/similar".

## Subtasks

| ID | Description | Status | File |
|----|-------------|--------|------|
| 007.1 | Build: shape-only rule, older parts, stroke names | Done | `tools/components/build.py`, `data/components.tsv.gz` |
| 007.2 | Card: older parts line, honest header | Done | `zhuyin-anywhere.user.js` |
| 007.3 | Tests, README, data/tools docs, CHANGELOG, 0.9.3 | Done | `tools/tests/learn.test.js`, `README.md`, `data/README.md`, `tools/components/README.md`, `CHANGELOG.md` |
| 007.4 | Try in Violentmonkey | Not started | |

## Log

- 2026-10-25: Implemented, data rebuilt, tests pass.

## Suggested commit

TASK-006 is not committed yet and shares `zhuyin-anywhere.user.js`, `CHANGELOG.md`, `README.md` and the test with this task, so commit both at once (`git add -A`):

```
git commit \
  -m "TASK-006/007 feat(learn): Open words from the word list, show older parts instead of shapes" \
  -m "- Word list: › replaces the popup with the word's card; the crumb leads back to the sentence
- Newcomers: translate to the browser's language with English second; Translate explanations on; README names every default
- Build: no shape-only splits (用 is not 冂 + 二 + 丨); Wiktionary's older parts in a new column (年 = 禾 + 人); strokes named as strokes
- Card: Older parts line, clickable; header says when parts are no longer visible
- Versions 0.9.2 and 0.9.3, what's new notes; CHANGELOG: TASK-005 hash"
```
