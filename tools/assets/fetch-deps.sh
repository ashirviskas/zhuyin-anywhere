#!/bin/sh
# Downloads everything the renderer needs that isn't in git:
#   vendor/zhuyin-dict.js  zhuyin dictionary (the same file the userscript's @resource points at)
#   vendor/cedict.gz       CC-CEDICT (the same file as the cedict @resource)
#   fonts/ + fonts.css     LXGW WenKai TC + Literata from Google Fonts, rewritten to local paths
set -e
cd "$(dirname "$0")"
mkdir -p vendor
curl -fsSL -o vendor/zhuyin-dict.js https://cdn.jsdelivr.net/gh/ashirviskas/yt-zhuyin@main/zhuyin-dict.js
curl -fsSL -o vendor/cedict.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
python3 fetch-fonts.py
echo "done: vendor/ fonts/ fonts.css"
