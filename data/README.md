# Data

`components.tsv.gz` is the character-parts data the word card reads: what each character is made of, which part gives the meaning and which the sound, how it was formed, and a short origin. The userscript loads it lazily as an `@resource`, the first time a card wants it.

It is built by [`tools/components/`](../tools/components/README.md) from:

| Source | What it gives | License |
|---|---|---|
| [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) `dictionary.txt` | Parts, type, meaning and sound parts, hints, part meanings | LGPL-3.0-or-later |
| [CJKVI-IDS](https://github.com/cjkvi/cjkvi-ids) `ids.txt` (from the [CHISE](http://www.chise.org/) IDS database) | Parts where Make Me a Hanzi has none, Taiwan glyph variants | GPL-2.0-or-later |
| [English Wiktionary](https://en.wiktionary.org/), "Glyph origin" sections, by Wiktionary contributors | Type, meaning and sound parts, the origin text (shortened and converted to plain text) | CC BY-SA 4.0 |
| [CC-CEDICT](https://cc-cedict.org/) | Part meanings where the others have none | CC BY-SA 4.0 |

The character list is the Ministry of Education's 4,808 common characters (常用國字標準字體表, via [ButTaiwan/cjktables](https://github.com/ButTaiwan/cjktables)), plus every part reachable from them.

## License

This file, `components.tsv.gz`, is licensed **GPL-3.0-or-later** (full text in [`COPYING`](COPYING)), the one license all its sources fit into. Its Wiktionary text is also available under CC BY-SA 4.0 from each character's Wiktionary page (`https://en.wiktionary.org/wiki/<character>`); the word card links there. The build scripts in `tools/components/` are its source.

The rest of this repository, including the userscript that reads this file, is MIT (see [`LICENSE`](../LICENSE)).

## Format

UTF-8, tab-separated, gzipped. Lines starting with `#` are the header. One line per character:

| Field | Example (媽) | Meaning |
|---|---|---|
| char | `媽` | |
| parts | `女s 馬p` | Each part followed by its role: `s` meaning, `p` sound, `f` shape only. `？` and ①–⑳ are pieces with no character of their own |
| type | `psc` | `psc` meaning + sound (形聲), `ic` idea from parts (會意), `pic` picture (象形), `ind` pointer (指事), `loan` borrowed for its sound (假借), `var:X` variant of X |
| gloss | `mother` | Short English meaning |
| hint | `woman` | Make Me a Hanzi's hint: a memory aid, sometimes folk etymology |
| origin | `Phono-semantic compound (形聲): semantic 女 + phonetic 馬.` | From Wiktionary, at most about 400 characters; ` ¶ ` separates paragraphs |
| src | `ACCA` | Which source gave parts, type, roles, gloss: `A` Make Me a Hanzi, `B` CJKVI-IDS, `C`/`c` Wiktionary template/prose, `E` CC-CEDICT, `R` built-in table, `-` none |
