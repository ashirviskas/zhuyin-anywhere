# Character parts data

Builds [`data/components.tsv.gz`](../../data/README.md), which the word card reads for a character's parts and origin.

```sh
sh tools/components/build.sh
```

Needs `python3` and `curl`. It downloads the sources into `vendor/` (git-ignored; pinned commits, delete a file to fetch it again), fetches the Wiktionary pages of the 4,808 MOE characters and of every part reachable from them (through the MediaWiki API, 50 pages per request, at most one request a second; resumable, about 7 minutes the first time), and merges. Run it again after changing `build.py`; only the merge runs then.

| File | What it does |
|---|---|
| `build.sh` | Downloads, fetches, builds |
| `fetch_wiktionary.py` | Wiktionary wikitext for a list of characters → `vendor/wikt.jsonl` |
| `build.py` | The merge |

## How the merge decides

- **Parts**: Make Me a Hanzi's or CJKVI-IDS's decomposition (the Taiwan `[T]` variant), whichever has fewer unknown pieces and parts with no meaning. Make Me a Hanzi wins a tie. Wiktionary's component list is used only when both are missing or have unknown pieces.
- **Type and roles** (meaning part, sound part): Wiktionary first, from the analysis that matches the modern glyph best; then Make Me a Hanzi. Side forms count as their full form (亻 = 人, 氵 = 水), and a few glyph variants as each other (`FORM_EQ`).
- **Part meanings**: a built-in table for side forms (`RADICAL_TABLE`), then Make Me a Hanzi, then CC-CEDICT.
- **Shapes only**: when no part is a meaning or sound part, the character gets no parts (木 is not 十 + 八, 用 is not 冂 + 二 + 丨), unless Make Me a Hanzi's hint names every part (我: "A hand 扌 holding a weapon 戈"); those show as shape parts.
- **Older parts** (`from`): Wiktionary's analysis when the parts shown don't hold all of it, because the glyph changed (年 = 禾 + 人, 夜 = 亦 + 夕, 星 = 晶 + 生). The analysis naming the most roles wins; for a 形聲 or 會意 character with no parts and no roles, the characters the origin's first sentence names (用: "adding a handle to 同"). Older parts get rows of their own, so they can be clicked.
- **Single strokes** (丨 丿 丶 亅 乛) are named as strokes ("vertical stroke"), not by their dictionary sense (丨 "number one").
- **Make Me a Hanzi's sound part** that the structure only holds nested is dropped when it sounds nothing like the character today (蹋 tà is 足 + 𦐇, not 日 rì). Same initial (aspiration aside) or a shared letter of the final counts as alike. Wiktionary's sound parts are always kept: they can rest on Old Chinese (我 → 義).
- **Origin**: Wiktionary's text, cut at a sentence end at or below 400 characters.

Measured over the 4,808 characters: 94 % have parts, 98 % a type, 71 % both a meaning and a sound part, 83 % an origin text. Known rough edges: a few characters show Wiktionary's historical type next to modern parts (保: idea from parts, with 呆 as its sound part), and Make Me a Hanzi's first sense is sometimes an odd gloss.
