#!/usr/bin/env python3
"""Merge Make Me a Hanzi (A), CJKVI-IDS (B) and Wiktionary glyph origins (C) into one compact
gzipped TSV for the zhuyin-anywhere "character parts" card. Run by build.sh, which fetches the inputs.

Usage:
  python3 -I build.py --mmah dictionary.txt --ids ids.txt --wikt wikt_raw.jsonl \
      --cedict cedict.gz --chars edu_standard_1.txt --out components.tsv.gz \
      [--origin-max 400] [--list-out chars.txt] [--sample 媽森林] [--no-ids] [--no-wikt]

Output (UTF-8 TSV, gzipped, one line per character, sorted by code point):
  char  parts  type  gloss  hint  origin  src
    parts : space separated list of  <component><role>  where role is
            s = meaning (semantic), p = sound (phonetic), f = form only / unspecified;
            components are single code points; '？' or ①-⑳ = unencoded (not clickable)
    type  : pic | ind | ic | psc | loan | var:<char> | ''   (C wins over A)
    gloss : short English meaning (A definition > CC-CEDICT > built-in radical table)
    hint  : A's one-line hint (mnemonic-ish, may be folk etymology)
    origin: C's glyph origin prose rendered to plain text, cut at --origin-max chars
    src   : provenance letters per field: parts/type/roles/gloss, e.g. "CCCA"
            (A = Make Me a Hanzi, B = CJKVI-IDS, C = Wiktionary, E = CC-CEDICT, R = radical table, - = none)
The file holds the MOE list plus every component reachable from it (closure), so the
card can recurse without a second data source.
"""
import argparse, gzip, json, re, sys, unicodedata
from collections import Counter

IDC2 = set("⿰⿱⿴⿵⿶⿷⿸⿹⿺⿻⿼⿽㇯")
IDC3 = set("⿲⿳")
IDC1 = set("⿾⿿")
IDC = IDC2 | IDC3 | IDC1
UNENC = set("？?") | {chr(c) for c in range(0x2460, 0x2474)}  # ？ and ①-⑳
STROKES = set("一丨丶丿乙乚乛亅㇀㇁㇂㇃㇄㇅㇆㇇㇈㇉㇊㇋㇌㇍㇎㇏㇐㇑㇒㇓㇔㇕㇖㇗㇘㇙㇚㇛㇜㇝㇞㇟㇠㇡㇢㇣𠃊𠃋𠃌𠃍𠃑𡿨")

# Single strokes as parts: their own dictionary senses mislead (丨 "number one", 丶 "dot; KangXi radical 3").
STROKE_NAMES = {"丨": "vertical stroke", "丿": "falling stroke", "丶": "dot", "亅": "hook", "乛": "turning stroke",
                "𠃌": "turning stroke", "㇏": "rising stroke"}
HAN_CH = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003134f]")


def mentioned(prose, ch):
    """Characters an origin's first sentence builds ch from, when it names no roles (用: "adding a handle to 同").
    Parenthesised asides and comparisons ("contrast 下", "compare 口") don't count."""
    first = re.split(r"(?<=\.) | ¶ |\n", prose)[0]
    first = re.split(r"\b(?:[Cc]ompare|[Cc]ontrast|[Cc]f\.|[Ss]ee|[Ss]imilar)\b", re.sub(r"\([^)]*\)", "", first))[0]
    return list(dict.fromkeys(x for x in HAN_CH.findall(first) if x != ch))


# Radical / variant forms that may lack a gloss in A and CC-CEDICT. Filled from measurement
# (see analyze.py, question 4). Meanings follow the Kangxi radical they stand for.
RADICAL_TABLE = {
    "氵": "water", "扌": "hand", "忄": "heart", "亻": "person", "訁": "speech", "讠": "speech",
    "灬": "fire", "罒": "net", "爫": "claw, hand", "⺮": "bamboo", "艹": "grass", "⺾": "grass",
    "辶": "walk", "⻌": "walk", "⻍": "walk", "阝": "mound / city", "礻": "spirit, altar",
    "衤": "clothing", "犭": "dog, beast", "糹": "silk", "纟": "silk", "釒": "metal", "钅": "metal",
    "飠": "food", "饣": "food", "冫": "ice", "宀": "roof", "冖": "cover", "疒": "sickness",
    "彳": "step", "攵": "strike, tap", "夂": "follow, walk slowly", "刂": "knife", "卩": "seal",
    "⺈": "knife", "⺊": "divination", "⺌": "small", "⺍": "small", "⺧": "cow", "⺶": "sheep",
    "⺸": "sheep", "⺻": "brush", "⺼": "flesh", "月": "moon / flesh", "王": "king / jade",
    "𤣩": "jade", "⺩": "jade", "耂": "old", "覀": "cover, west", "龸": "small", "癶": "footsteps",
    "廾": "two hands", "彐": "snout", "⺕": "snout", "亠": "lid", "丷": "eight", "⺄": "second",
    "乚": "hidden", "⺆": "borders", "⺀": "ice", "𧾷": "foot", "⻊": "foot", "𦍌": "sheep",
    "㣺": "heart", "⺗": "heart", "⺘": "hand", "⺡": "water", "⺣": "fire", "⺨": "dog",
    "⻏": "city", "⻖": "mound", "⺬": "spirit", "⺭": "spirit", "⻂": "clothing", "⺲": "net",
    "⺫": "net", "⺳": "net", "⺪": "bolt of cloth", "⺅": "person", "𠂉": "person", "⺮": "bamboo",
    "𥫗": "bamboo", "⻗": "rain", "⻞": "food", "⻟": "food", "⻠": "food", "⻣": "food",
}

# Wiktionary names the full form (人 semantic), the IDS has the side form (亻). Treat them as one.
FORM_EQ = {"亻": "人", "𠆢": "人", "氵": "水", "氺": "水", "扌": "手", "龵": "手", "忄": "心", "㣺": "心",
           "訁": "言", "讠": "言", "釒": "金", "钅": "金", "糹": "糸", "纟": "糸", "刂": "刀", "⺈": "刀",
           "犭": "犬", "礻": "示", "衤": "衣", "艹": "艸", "⺾": "艸", "辶": "辵", "⻌": "辵", "灬": "火",
           "爫": "爪", "罒": "网", "罓": "网", "⺮": "竹", "飠": "食", "饣": "食", "王": "玉", "⺩": "玉",
           "月": "肉", "⺼": "肉", "攵": "攴", "𧾷": "足", "⻊": "足", "耂": "老", "覀": "襾", "⺶": "羊",
           "𦍌": "羊", "⺧": "牛", "牜": "牛", "阝": "阜", "⻖": "阜", "⻏": "邑", "歺": "歹", "彑": "彐",
           "⺍": "小", "⺌": "小", "龸": "小", "丬": "爿", "𤣩": "玉", "巜": "川", "⺗": "心", "冫": "冰",
           # glyph variants: Wiktionary names one, the structure has the other (聽: 𡈼/壬, 㥁/𢛳)
           "𡈼": "壬", "㥁": "𢛳", "悳": "𢛳"}


def same_form(x, y):
    return x == y or FORM_EQ.get(x, x) == FORM_EQ.get(y, y) or (x in "阝⻖⻏" and y in "阜邑")


INITIALS = re.compile(r"^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$")


def syllable(py):
    """'tà' -> ('d', 'a'): initial (aspiration dropped) and final, tone dropped."""
    s = "".join(c for c in unicodedata.normalize("NFD", py.lower()) if not unicodedata.combining(c))
    i, f = INITIALS.match(s).groups()
    return {"p": "b", "t": "d", "k": "g", "q": "j", "ch": "zh", "c": "z"}.get(i, i), f   # 簸 bǒ / 皮 pí alike


def sounds_alike(a, b):
    """Some reading of a shares its initial, or a letter of its final, with some reading of b (蹋 tà / 日 rì: no)."""
    return any(x[0] and x[0] == y[0] or set(x[1]) & set(y[1]) for x in map(syllable, a) for y in map(syllable, b))


# -------------------------------------------------------------- IDS parsing

def ids_parse(s):
    """IDS string -> tree. Leaf = str (one code point); node = (op, [children])."""
    pos = 0

    def rec():
        nonlocal pos
        if pos >= len(s):
            return "？"
        c = s[pos]; pos += 1
        n = 2 if c in IDC2 else 3 if c in IDC3 else 1 if c in IDC1 else 0
        if not n:
            return c
        return (c, [rec() for _ in range(n)])

    t = rec()
    return t


def ids_str(t):
    return t if isinstance(t, str) else t[0] + "".join(ids_str(c) for c in t[1])


def ids_leaves(t):
    if isinstance(t, str):
        return [t]
    return [x for c in t[1] for x in ids_leaves(c)]


def load_mmah(path):
    out = {}
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        out[d["character"]] = d
    return out


TAG = re.compile(r"\[([A-Z]+)\]$")


def load_ids(path):
    """char -> list of (ids, tags). Comment and self-referential lines kept as atoms."""
    out = {}
    for line in open(path, encoding="utf-8"):
        if line.startswith("#") or not line.strip():
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) < 3:
            continue
        ch, alts = f[1], []
        for a in f[2:]:
            m = TAG.search(a)
            alts.append((TAG.sub("", a), m.group(1) if m else ""))
        out[ch] = alts
    return out


def ids_pick_t(alts):
    """Prefer the Taiwan [T...] variant, then untagged, then first."""
    for a, t in alts:
        if "T" in t:
            return a, t
    for a, t in alts:
        if not t:
            return a, t
    return alts[0]


def is_atomic(ch, ids):
    return not ids or ids == ch or all(c not in IDC for c in ids) and len(ids) == 1


# -------------------------------------------------------------- CC-CEDICT

def load_cedict(path):
    """trad char -> first useful English sense, for single-character headwords only."""
    out = {}
    op = gzip.open if path.endswith(".gz") else open
    for line in op(path, "rt", encoding="utf-8"):
        if line.startswith("#"):
            continue
        m = re.match(r"(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$", line)
        if not m or len(m.group(1)) != 1:
            continue
        ch = m.group(1)
        senses = [s for s in m.group(4).split("/") if s]
        good = [s for s in senses if not re.match(r"(surname|variant of|old variant|used in|see |CL:|Japanese variant|abbr\. for)", s)]
        if good and ch not in out:
            out[ch] = good[0]
        elif senses and ch not in out:
            out.setdefault("_weak_" + ch, senses[0])
    return out


# -------------------------------------------------------------- Wiktionary wikitext

def split_templates(text):
    """Yield ('text', s) and ('tpl', [name, args...]) pieces; handles nesting of {{ }} and [[ ]]."""
    i, n, buf = 0, len(text), []
    while i < n:
        if text.startswith("{{", i):
            depth, j = 0, i
            while j < n:
                if text.startswith("{{", j):
                    depth += 1; j += 2
                elif text.startswith("}}", j):
                    depth -= 1; j += 2
                    if depth == 0:
                        break
                else:
                    j += 1
            if buf:
                yield ("text", "".join(buf)); buf = []
            yield ("tpl", split_args(text[i + 2:j - 2]))
            i = j
        else:
            buf.append(text[i]); i += 1
    if buf:
        yield ("text", "".join(buf))


def split_args(inner):
    parts, depth_t, depth_l, cur, i = [], 0, 0, [], 0
    while i < len(inner):
        if inner.startswith("{{", i):
            depth_t += 1; cur.append("{{"); i += 2; continue
        if inner.startswith("}}", i):
            depth_t -= 1; cur.append("}}"); i += 2; continue
        if inner.startswith("[[", i):
            depth_l += 1; cur.append("[["); i += 2; continue
        if inner.startswith("]]", i):
            depth_l -= 1; cur.append("]]"); i += 2; continue
        if inner[i] == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(cur)); cur = []; i += 1; continue
        cur.append(inner[i]); i += 1
    parts.append("".join(cur))
    return [p.strip() for p in parts]


def targs(parts):
    pos, kw = [], {}
    for p in parts[1:]:
        m = re.match(r"^([A-Za-z_][\w-]*)\s*=(.*)$", p, re.S)
        if m:
            kw[m.group(1)] = m.group(2).strip()
        else:
            pos.append(p)
    return parts[0].strip(), pos, kw


LIUSHU = {"p": "pic", "i": "ind", "ic": "ic", "psc": "psc", "j": "loan", "zz": "loan",
          "1": "pic", "2": "ind", "3": "ic", "4": "psc", "6": "loan"}  # numbers = traditional 六書 order
LIUSHU_LABEL = {"pic": "Pictogram (象形)", "ind": "Ideogram (指事)", "ic": "Ideogrammic compound (會意)",
                "psc": "Phono-semantic compound (形聲)", "loan": "Phonetic loan (假借)"}
ROLE_WORD = {"s": "semantic", "p": "phonetic"}


def chinese_section(text):
    m = re.search(r"^==Chinese==\s*$(.*?)(?=^==[^=]|\Z)", text or "", re.M | re.S)
    return m.group(1) if m else ""


def glyph_origins(text):
    sec = chinese_section(text)
    return [g.group(2) for g in re.finditer(r"^(=+)\s*Glyph origin\s*\1\s*$(.*?)(?=^=|\Z)", sec, re.M | re.S)]


def first_display(s):
    s = s.lstrip("*")
    return s.split("/")[0] if "/" in s and len(s) <= 5 else s


def render(text, info):
    """Wikitext -> plain text. info collects templates seen and structured hits."""
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"^\{\|.*?^\|\}", "", text, flags=re.S | re.M)  # wikitables (glyph images)
    text = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", text)
    text = re.sub(r"<ref[^>]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    out = []
    for kind, v in split_templates(text):
        if kind == "text":
            out.append(v); continue
        name, pos, kw = targs(v)
        info["tpls"].append(name)
        if name == "liushu":
            ty = LIUSHU.get(pos[0] if pos else "", pos[0] if pos else "")
            info["types"].append(ty)
            lab = LIUSHU_LABEL.get(ty, ty)
            out.append(lab if not kw.get("nocap") else lab[0].lower() + lab[1:])
        elif name == "Han compound":
            ty = LIUSHU.get(kw.get("ls", ""), kw.get("ls", ""))
            comps = [first_display(p) for p in pos]
            roles = [kw.get(f"c{i + 1}", "") for i in range(len(comps))]
            glosses = [kw.get(f"t{i + 1}", "") for i in range(len(comps))]
            info["hcs"].append((ty, list(zip(comps, roles))))
            if ty:
                info["types"].append(ty)
            bits = []
            for c, r, g in zip(comps, roles, glosses):
                w = (ROLE_WORD.get(r, "") + " " if r in ROLE_WORD else "") + c
                if g:
                    w += f' ("{render(g, {"tpls": [], "types": [], "hcs": []})}")'
                bits.append(w)
            lab = LIUSHU_LABEL.get(ty, "")
            if lab and kw.get("nocap"):
                lab = lab[0].lower() + lab[1:]
            out.append((lab + ": " if lab else "") + " + ".join(bits))
        elif name in ("zh-etym-double", "zh-etym-triple"):
            n = 2 if name.endswith("double") else 3
            c0 = first_display(pos[0]) if pos else "?"
            g = pos[1] if len(pos) > 1 else ""
            info["types"].append("ic")
            info["hcs"].append(("ic", [(c0, "s")] * n))
            out.append(("two " if n == 2 else "three ") + c0 + (f' ("{g}")' if g else ""))
        elif name in ("Han simp",):
            info["types"].append("simp")
            out.append("Simplified from " + (first_display(pos[0]) if pos else "?"))
        elif name in ("Han phonetically borrowed", "jiajie"):
            info["types"].append("loan")
            out.append("Phonetic loan")
        elif name in ("zh-l", "zh-m", "och-l", "ltc-l"):
            if not pos:
                continue
            w = first_display(pos[0])
            g = pos[1] if len(pos) > 1 else kw.get("t", "")
            out.append(w + (f' ("{render(g, {"tpls": [], "types": [], "hcs": []})}")' if g else ""))
        elif name in ("l", "m", "l-lite", "m-lite", "lang", "lang-lite"):
            w = pos[1] if len(pos) > 1 else ""
            alt = pos[2] if len(pos) > 2 and pos[2] else w
            g = (pos[3] if len(pos) > 3 else "") or kw.get("t", "") or kw.get("gloss", "")
            out.append(render(alt, {"tpls": [], "types": [], "hcs": []}) + (f' ("{render(g, {"tpls": [], "types": [], "hcs": []})}")' if g else ""))
        elif name in ("m-g", "gloss", "IPAchar", "unc"):
            out.append(render(pos[0], {"tpls": [], "types": [], "hcs": []}) if pos else "")
        elif name in ("w", "wp", "lw"):
            if name == "lw":
                pos = pos[1:]
            w = pos[1] if len(pos) > 1 else (pos[0] if pos else "")
            out.append(re.sub(r"^\w+:", "", w))
        elif name == "Han etyl":
            out.append("")
        elif name == ",":
            out.append(",")
        else:  # Han etym, zh-ref, R:*, reflist, attn, rfv-etym, categorize, zh-forms ...
            out.append("")
    s = "".join(out)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)  # [[a|b]] -> b
    s = re.sub(r"'''?", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ")
    s = re.sub(r"^\s*[*#:]+\s*", "• ", s, flags=re.M)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{2,}", "\n", s).strip()
    s = re.sub(r"\s+([.,;:])", r"\1", s)
    return s


def parse_wikt(text):
    """-> dict(type, hc=[(comp, role)], prose, tpls, see) or None."""
    origins = glyph_origins(text)
    sec = chinese_section(text)
    if not origins:
        m = re.search(r"\{\{zh-see\|([^|}]+)", sec)
        if m:
            return {"see": m.group(1).strip(), "tpls": ["zh-see"], "prose": "", "type": None}
        return None
    info = {"tpls": [], "types": [], "hcs": []}
    prose = render(origins[0], info)
    info["prose"] = prose
    info["n_origins"] = len(origins)
    p = prose.lower()
    if not info["types"]:
        for k, ty in (("phono-semantic", "psc"), ("ideogrammic compound", "ic"), ("pictogram", "pic"),
                      ("ideogram", "ind"), ("phonetic loan", "loan"), ("simplified from", "simp")):
            if k in p:
                info["types"].append(ty); info["type_from_prose"] = True; break
    # a "Simplified from X" / variant line followed by the real analysis: use the analysis
    real = [t for t in info["types"] if t != "simp"]
    info["type"] = (real or info["types"] or [None])[0]
    # prose roles: "semantic X", "phonetic Y" (also covers analyses written without a template)
    info["prose_roles"] = [(m.group(2), m.group(1)[0]) for m in re.finditer(r"(?<![\w-])(semantic|phonetic) (\S)", prose)]
    for m in re.finditer(r"phono-semantic compound \(形聲\): ((?:(?:semantic|phonetic) \S[^+]*?(?: \+ |$|[.;–]))+)", prose, re.I):
        rs = [(x.group(2), x.group(1)[0]) for x in re.finditer(r"(?<![\w-])(semantic|phonetic) (\S)", m.group(1))]
        if rs and not any(rs == h for _, h in info["hcs"]):
            info["hcs"].append(("psc", rs))
    info["hc"] = info["hcs"][0][1] if info["hcs"] else []
    return info


def load_wikt(path):
    raw = {}
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        raw[d["t"]] = d["text"]
    out = {}
    for t, text in raw.items():
        w = parse_wikt(text) if text else None
        if w and w.get("see") and raw.get(w["see"]):
            w2 = parse_wikt(raw[w["see"]])
            if w2 and not w2.get("see"):
                w2 = dict(w2); w2["via"] = w["see"]
                w = w2
        out[t] = w
    return out


# -------------------------------------------------------------- merge

A_TYPE = {"pictographic": "pic", "ideographic": "ic", "pictophonetic": "psc"}


class Merger:
    def __init__(self, A, B, C, E, use_b=True, use_c=True):
        self.A, self.B, self.C, self.E = A, B, (C if use_c else {}), E
        self.use_b = use_b
        self.rev = {}
        if use_b:
            for ch, alts in B.items():
                for a, _ in alts:
                    if a != ch and len(a) > 1:
                        self.rev.setdefault(a, ch)
        for ch, d in A.items():
            dec = d.get("decomposition", "")
            if "？" not in dec and len(dec) > 1:
                self.rev.setdefault(dec, ch)

    def ids_of(self, ch):
        """-> (ids, src): the structural decomposition whose named top-level parts read best:
        fewest unencoded pieces (？, ①-⑳), then fewest parts (unnamed subtrees get spliced), A on ties."""
        a = self.A.get(ch, {}).get("decomposition", "")
        b = ids_pick_t(self.B[ch])[0] if self.use_b and ch in self.B else ""
        cands = []
        for ids, src in ((a, "A"), (b, "B")):
            if not ids or len(ids) < 2 or ids[0] not in IDC:
                continue
            ps = self.top_parts(ids)
            unk = sum(p in UNENC for p in ps)
            nogloss = sum(1 for p in ps if p not in UNENC and not self.gloss(p)[0])
            cands.append((3 * unk + 2 * nogloss + len(ps), src != "A", ids, src))
        if not cands:
            return "", "-"
        best = min(cands)
        return best[2], best[3]

    def top_parts(self, ids):
        """Named immediate parts of an IDS: name unnamed subtrees by reverse lookup, else splice."""
        t = ids_parse(ids)
        if isinstance(t, str):
            return []
        out = []

        def add(n):
            if isinstance(n, str):
                out.append(n); return
            s = ids_str(n)
            if s in self.rev:
                out.append(self.rev[s]); return
            for c in n[1]:
                add(c)

        for c in t[1]:
            add(c)
        return out

    def visible(self, ch):
        """Components visible in the modern glyph: every leaf and named subtree of A's and B's IDS
        for ch, plus the named top-level parts of ch's own top-level parts (two levels, no deeper)."""
        got = set()
        for ids in (self.A.get(ch, {}).get("decomposition", ""),
                    ids_pick_t(self.B[ch])[0] if self.use_b and ch in self.B else ""):
            if not ids or len(ids) < 2:
                continue
            t = ids_parse(ids)
            got.update(ids_leaves(t))

            def walk(n):
                if isinstance(n, str):
                    return
                k = ids_str(n)
                if k in self.rev:
                    got.add(self.rev[k])
                for m in n[1]:
                    walk(m)
            walk(t)
        ids, _ = self.ids_of(ch)
        for p in (self.top_parts(ids) if ids else []):
            pi, _ = self.ids_of(p)
            if pi:
                got.update(self.top_parts(pi))
        got.discard(ch)
        return got

    def gloss(self, ch):
        if ch in STROKE_NAMES:
            return STROKE_NAMES[ch], "R"
        if ch in RADICAL_TABLE:
            return RADICAL_TABLE[ch], "R"
        d = self.A.get(ch, {}).get("definition")
        if d:
            return re.split(r"[;,]", d)[0].strip(), "A"
        if ch in self.E:
            return re.split(r"[;,(]", self.E[ch])[0].strip() or self.E[ch], "E"
        if ch in RADICAL_TABLE:
            return RADICAL_TABLE[ch], "R"
        if "_weak_" + ch in self.E:
            return self.E["_weak_" + ch], "E"
        return "", "-"

    def merge(self, ch, origin_max=400):
        a = self.A.get(ch, {})
        ae = a.get("etymology") or {}
        c = self.C.get(ch) or {}
        ids, dsrc = self.ids_of(ch)
        parts = self.top_parts(ids) if ids else []
        roles = {p: "f" for p in parts}
        rsrc, psrc = "-", dsrc
        # C: roles from the first compound whose components are all visible in the glyph.
        # C's component list replaces the structural parts only when those are missing or unencoded.
        hcs = [(t, [(x, r) for x, r in h if x]) for t, h in c.get("hcs", [])]
        vis = self.visible(ch)
        broken = not parts or any(p in UNENC for p in parts)
        # pick the analysis that best matches the modern glyph: most visible parts, then psc, then later
        def find(x):
            for k in roles:
                if same_form(k, x):
                    return k
            return None

        ranked = sorted(((sum(1 for x, _ in h if x in vis or find(x)), t == "psc", i, t, h)
                         for i, (t, h) in enumerate(hcs) if h), reverse=True)
        c_type = c.get("type")
        if ranked and ranked[0][0]:
            nvis, _, _, t, h = ranked[0]
            if t:
                c_type = t
            if nvis == len(h) and broken:
                parts = [x for x, _ in h]
                roles = {x: r if r in ("s", "p") else "f" for x, r in h}
                psrc = "C"
            for x, r in h:
                k = find(x)
                if k and r in ("s", "p"):
                    roles[k] = r; rsrc = "C"
        if rsrc == "-":
            for x, r in c.get("prose_roles", []):
                k = find(x)
                if k and r in ("s", "p") and roles[k] == "f":
                    roles[k] = r; rsrc = "c"
        if rsrc == "-" and ae:
            hit = False
            for key, r in (("semantic", "s"), ("phonetic", "p")):
                x = ae.get(key)
                k = find(x) if x else None
                if k:
                    roles[k] = r; hit = True
                elif x and len(x) == 1 and x not in roles and parts:
                    # A names a part that the structure only holds nested; show A's view, unless it's a sound part
                    # that sounds nothing like the character: then A misread the glyph (蹋 is 足 + 𦐇, not 日)
                    xp = self.A.get(x, {}).get("pinyin")
                    if r == "p" and xp and a.get("pinyin") and not sounds_alike(a["pinyin"], xp):
                        continue
                    parts.append(x); roles[x] = r; hit = True
            if hit:
                rsrc = "A"
        ty, tsrc = "", "-"
        if c_type:
            ty, tsrc = c_type, "C"
        elif ae.get("type"):
            ty, tsrc = A_TYPE[ae["type"]], "A"
        if c.get("via"):
            ty = ty or f"var:{c['via']}"
        if ty == "ic":
            for x in roles:
                if roles[x] == "f" and x not in UNENC and x not in STROKES:
                    roles[x] = "s"
        g, gsrc = self.gloss(ch)
        prose = "" if origin_max < 0 else (c.get("prose") or "").replace("\t", " ").replace("\n", " ¶ ")
        if origin_max > 0 and len(prose) > origin_max:
            cut = prose[:origin_max]
            k = max(cut.rfind(". "), cut.rfind("。"))
            prose = cut[:k + 1] if k > origin_max // 3 else cut.rstrip() + "…"
        # Parts with no meaning or sound role are only the glyph's shapes: show none (木 is not 十 + 八; 用 is not
        # 冂 + 二 + 丨), unless the hint names them all (我: "A hand 扌 holding a weapon 戈").
        if not any(r in ("s", "p") for r in roles.values()) \
                and not all(any(same_form(x, h) for h in ae.get("hint", "")) for x in parts):
            parts = []
        # Wiktionary's analysis, when the parts shown don't hold it: the glyph changed (用 is 同 + a handle;
        # 星 was 晶 + 生). Its components with their roles; failing that, the characters its first sentence names.
        # Only analyses that say what each part does (or 會意, where every part is a meaning part).
        cands = [(t, h) for *_, t, h in ranked if t == "ic" or any(r in ("s", "p") for _, r in h)]
        if cands:   # the one naming the most roles (年: 禾 + 人, not 禾 alone); the best-matching one on a tie
            t, h = max(cands, key=lambda th: sum(r in ("s", "p") for _, r in th[1]))
            best = [(x, r if r in ("s", "p") else "s" if t == "ic" else "f") for x, r in h]
        elif c.get("prose_roles"):
            best = c["prose_roles"]
        else:
            best = [(x, "f") for x in mentioned(c.get("prose") or "", ch)] if ty in ("psc", "ic") and not parts else []
        best = [(x, r if r in ("s", "p") else "f") for x, r in dict(best).items() if x != ch and x not in UNENC]
        hist = [] if all(any(same_form(x, k) for k in parts) for x, _ in best) else best
        if parts and not any(self.gloss(x)[0] for x in parts if x not in UNENC):
            parts = []  # e.g. 門 -> 𠁣 𠃛: halves with no meaning in any source; show none
        plist = []
        for x in parts:
            plist.append(x + roles.get(x, "f"))
        return {
            "ch": ch, "parts": " ".join(plist), "type": ty, "gloss": g, "hint": (ae.get("hint") or ""),
            "origin": prose, "src": psrc + tsrc + rsrc + gsrc, "from": " ".join(x + r for x, r in hist),
        }


def build(args):
    A = load_mmah(args.mmah)
    B = load_ids(args.ids) if args.ids and not args.no_ids else {}
    C = load_wikt(args.wikt) if args.wikt and not args.no_wikt else {}
    E = load_cedict(args.cedict) if args.cedict else {}
    M = Merger(A, B, C, E, use_b=bool(B), use_c=bool(C))
    chars = []
    for line in open(args.chars, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            chars.append(line.split()[0])
    todo, done, rows = list(dict.fromkeys(chars)), set(), []
    while todo:
        ch = todo.pop()
        if ch in done:
            continue
        done.add(ch)
        r = M.merge(ch, args.origin_max)
        rows.append(r)
        for p in (r["parts"] + " " + r["from"]).split():
            x = p[:-1]
            if x not in done and x not in UNENC:
                todo.append(x)
    rows.sort(key=lambda r: r["ch"])
    lines = ["\t".join([r["ch"], r["parts"], r["type"], r["gloss"].replace("\t", " "), r["hint"].replace("\t", " "),
                        r["origin"], r["src"], r["from"]]) for r in rows]
    head = ("# zhuyin-anywhere character components (data/README.md). Fields: char parts type gloss hint origin src from\n"
            "# License: GPL-3.0-or-later. Built by tools/components/build.py from: Make Me a Hanzi dictionary.txt (LGPL-3.0-or-later), "
            "CJKVI-IDS ids.txt / CHISE-IDS (GPL-2.0-or-later), English Wiktionary glyph origins by Wiktionary contributors "
            "(CC BY-SA 4.0, https://en.wiktionary.org/wiki/<char>; shortened and converted to plain text), CC-CEDICT (CC BY-SA 4.0).\n")
    data = (head + "\n".join(lines) + "\n").encode("utf-8")
    with gzip.open(args.out, "wb", compresslevel=9) as f:
        f.write(data)
    return M, rows, len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mmah", required=True)
    ap.add_argument("--ids")
    ap.add_argument("--wikt")
    ap.add_argument("--cedict")
    ap.add_argument("--chars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--origin-max", type=int, default=400, help="cut origin prose (0 = full, -1 = drop)")
    ap.add_argument("--no-ids", action="store_true")
    ap.add_argument("--no-wikt", action="store_true")
    ap.add_argument("--sample", default="")
    ap.add_argument("--list-out", help="also write every character in the output, one per line (for fetching their Wiktionary pages)")
    args = ap.parse_args()
    M, rows, raw = build(args)
    if args.list_out:
        with open(args.list_out, "w", encoding="utf-8") as f:
            f.write("".join(r["ch"] + "\n" for r in rows))
    import os
    print(f"rows {len(rows)}  raw {raw / 1024:.0f} KiB  gz {os.path.getsize(args.out) / 1024:.0f} KiB", file=sys.stderr)
    by = {r["ch"]: r for r in rows}
    for ch in args.sample:
        r = by.get(ch)
        if r:
            print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
