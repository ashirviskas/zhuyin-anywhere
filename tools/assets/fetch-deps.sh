#!/bin/sh
# Downloads everything the renderer needs that isn't in git:
#   vendor/zhuyin-dict.js  zhuyin dictionary (the same file the userscript's @resource points at)
#   vendor/cedict.gz       CC-CEDICT (the same file as the cedict @resource)
#   fonts/ + fonts.css     LXGW WenKai TC + Literata from Google Fonts, rewritten to local paths
set -e
cd "$(dirname "$0")"
mkdir -p vendor
# Skips files already there (delete one to refresh it). mdbg.net can take minutes, hence the progress bar.
get() {
  if [ -s "$1" ]; then echo "have $1"; return; fi
  echo "fetching $1"
  curl -fL --progress-bar --retry 3 --connect-timeout 20 -o "$1.part" "$2" && mv "$1.part" "$1"
}
get vendor/zhuyin-dict.js https://cdn.jsdelivr.net/gh/ashirviskas/yt-zhuyin@main/zhuyin-dict.js
get vendor/cedict.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
if [ -s fonts.css ]; then echo "have fonts.css"; else python3 fetch-fonts.py; fi
echo "done: vendor/ fonts/ fonts.css"
