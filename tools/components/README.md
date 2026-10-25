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
- **Pictographs** get no parts unless one is a meaning or sound part (木 is not 十 + 八).
- **Origin**: Wiktionary's text, cut at a sentence end at or below 400 characters.

Measured over the 4,808 characters: 94 % have parts, 98 % a type, 71 % both a meaning and a sound part, 83 % an origin text. Known rough edges: a few characters show Wiktionary's historical type next to modern parts (保: idea from parts, with 呆 as its sound part), and Make Me a Hanzi's first sense is sometimes an odd gloss.
