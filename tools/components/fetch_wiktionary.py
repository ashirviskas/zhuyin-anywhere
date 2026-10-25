#!/usr/bin/env python3
"""Fetch en.wiktionary wikitext for a list of characters via the MediaWiki API.

Usage: python3 -I fetch_wiktionary.py CHARLIST OUT.jsonl   (run by build.sh)
CHARLIST: text file, first column = character (lines starting with # ignored), or
          plain characters one per line.
Writes one JSON line per title: {"t": title, "text": wikitext or null}.
Resumable: titles already in OUT are skipped. Batches of 50, >=1.1 s between requests.
Pages whose Chinese section is only {{zh-see|X}} are followed in a second pass.
"""
import json, re, sys, time, urllib.parse, urllib.request

API = "https://en.wiktionary.org/w/api.php"
UA = "zhuyin-anywhere-components/1.0 (https://github.com/ashirviskas/zhuyin-anywhere; builds data/components.tsv.gz)"


def load_chars(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line.split()[0])
    return out


def fetch(titles):
    q = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
         "format": "json", "formatversion": "2", "titles": "|".join(titles)}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            print("retry", attempt, e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("failed")


def run(titles, out_path, done):
    todo = [t for t in dict.fromkeys(titles) if t not in done]
    with open(out_path, "a", encoding="utf-8") as out:
        for i in range(0, len(todo), 50):
            batch = todo[i:i + 50]
            data = fetch(batch)
            # API normalizes titles; map back
            norm = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
            for p in data.get("query", {}).get("pages", []):
                t = norm.get(p["title"], p["title"])
                text = None
                if not p.get("missing") and p.get("revisions"):
                    text = p["revisions"][0]["slots"]["main"]["content"]
                out.write(json.dumps({"t": t, "text": text}, ensure_ascii=False) + "\n")
                done[t] = text
            print(f"{i + len(batch)}/{len(todo)}", file=sys.stderr)
            time.sleep(1.1)


def chinese_section(text):
    m = re.search(r"^==Chinese==\s*$(.*?)(?=^==[^=]|\Z)", text or "", re.M | re.S)
    return m.group(1) if m else ""


def main():
    chars, out_path = load_chars(sys.argv[1]), sys.argv[2]
    done = {}
    try:
        for line in open(out_path, encoding="utf-8"):
            d = json.loads(line)
            done[d["t"]] = d["text"]
    except FileNotFoundError:
        pass
    run(chars, out_path, done)
    # follow {{zh-see|X}} when the Chinese section has no Glyph origin
    extra = []
    for c in chars:
        sec = chinese_section(done.get(c))
        if "Glyph origin" not in sec:
            m = re.search(r"\{\{zh-see\|([^|}]+)", sec)
            if m:
                extra.append(m.group(1).strip())
    print("following zh-see:", len(extra), file=sys.stderr)
    run(extra, out_path, done)


if __name__ == "__main__":
    main()
