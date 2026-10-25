#!/bin/sh
# Builds data/components.tsv.gz, the character-parts data the word card reads (see README.md here).
# Downloads the sources into vendor/ (pinned commits; delete a file to fetch it again), fetches the
# Wiktionary pages (resumable, about 7 minutes the first time), then merges.
set -e
cd "$(dirname "$0")"
mkdir -p vendor
get() {
  if [ -s "$1" ]; then echo "have $1"; return; fi
  echo "fetching $1"
  curl -fL --progress-bar --retry 3 --connect-timeout 20 -o "$1.part" "$2" && mv "$1.part" "$1"
}
MMAH=bddc96d41bef78427ed0e034e9f7e31d71fd1b92     # skishore/makemeahanzi
IDS=86b4d16159f0079437870408f0ca186e529015db      # cjkvi/cjkvi-ids
TABLES=92cbab35939a4a751e6bc29e5ffed74a9e3e8f14   # ButTaiwan/cjktables (MOE 常用國字標準字體表, 4,808 characters)
get vendor/dictionary.txt https://raw.githubusercontent.com/skishore/makemeahanzi/$MMAH/dictionary.txt
get vendor/ids.txt https://raw.githubusercontent.com/cjkvi/cjkvi-ids/$IDS/ids.txt
get vendor/edu_standard_1.txt https://raw.githubusercontent.com/ButTaiwan/cjktables/$TABLES/taiwan/standard/edu_standard_1.txt
if [ -s ../assets/vendor/cedict.gz ] && [ ! -s vendor/cedict.gz ]; then cp ../assets/vendor/cedict.gz vendor/; fi
get vendor/cedict.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz

# Wiktionary: the MOE characters, then every part the merge reaches from them.
python3 -I fetch_wiktionary.py vendor/edu_standard_1.txt vendor/wikt.jsonl
build() {
  python3 -I build.py --mmah vendor/dictionary.txt --ids vendor/ids.txt --wikt vendor/wikt.jsonl --cedict vendor/cedict.gz \
    --chars vendor/edu_standard_1.txt --out ../../data/components.tsv.gz "$@"
}
build --list-out vendor/all.txt
python3 -I fetch_wiktionary.py vendor/all.txt vendor/wikt.jsonl
build --sample 媽森識館聽
