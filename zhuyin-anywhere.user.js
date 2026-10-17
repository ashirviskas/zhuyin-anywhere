// ==UserScript==
// @name         注音 anywhere (Traditional Mandarin → zhuyin + select-to-translate)
// @namespace    local.zhuyin-anywhere
// @version      0.4.0
// @description  Annotates Traditional Chinese on any page with textbook-style zhuyin (word-segmented, Taiwan readings from McBopomofo via yt-zhuyin's dictionary). Hover a word for its CC-CEDICT gloss; select text to get an English translation.
// @match        *://*/*
// @noframes
// @homepageURL  https://github.com/ashirviskas/zhuyin-anywhere
// @downloadURL  https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js
// @updateURL    https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js
// @resource     zydict https://cdn.jsdelivr.net/gh/ashirviskas/yt-zhuyin@main/zhuyin-dict.js
// @resource     cedict https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
// @grant        GM_getResourceText
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      translate.googleapis.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      www.mdbg.net
// @run-at       document-idle
// ==/UserScript==

/*
 * Pipeline
 *  1. Decide whether this page is worth it: per-site mode (auto / on / off). "auto" samples the page
 *     text and only runs if it has enough Han characters and they look Traditional, not Simplified.
 *  2. Lazily load the dictionary (@resource, cached by Violentmonkey, parsed only when needed — the
 *     6.5 MB @require that yt-zhuyin uses would be parsed on every page load of every site).
 *  3. TreeWalker over text nodes, time-sliced in idle callbacks. Each Han run is segmented with the
 *     same unigram max-likelihood segmenter as yt-zhuyin, so polyphones get word-level readings
 *     (銀行 ㄏㄤˊ, not ㄒㄧㄥˊ). MutationObserver feeds new content into the same queue.
 *  4. Rendering: yt-zhuyin's textbook layout — vertical column right of the character, ˙ drawn as a
 *     dot above, ˊˇˋ in their own slot. Optional 'top' layout. Zhuyin is user-select:none and is
 *     also stripped from the selection text, so copy/translate see only the Chinese.
 *  5. Hover gloss: CC-CEDICT (CC BY-SA 4.0, MDBG) as a gzipped @resource — fetched once by Violentmonkey,
 *     stored base64 in extension storage, read lazily via GM_getResourceURL and gunzipped with
 *     DecompressionStream. Not GM_setValue: Violentmonkey ships every stored value into every page on
 *     injection, so 10 MB there would cost every site load. Entries are sorted so the one matching the
 *     zhuyin on the page comes first (incl. CEDICT's "Taiwan pr. [...]" notes).
 *  6. Selection → English popup (shadow DOM, isolated from page CSS). Google gtx endpoint by default,
 *     or yt-zhuyin's local asr_server /translate (opus-mt) if you run it.
 *
 * Hotkeys: Alt+Z show/hide zhuyin · Alt (held) + hover shows gloss in 'alt' mode · Alt+T translate selection (when autoTranslate is off) · Esc closes popup
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const CFG = {
    layout: GM_getValue('layout', 'side'),           // 'side' (textbook column) | 'top' (horizontal, above)
    scale: 0.5,                                       // zhuyin size relative to the annotated text
    wordGap: 0.12,                                    // em of space between dictionary words (0 = none)
    showPolyphones: GM_getValue('poly', false),       // tint single chars whose reading is a guess among several
    translator: GM_getValue('translator', 'google'),  // 'google' | 'local'
    localServer: 'http://127.0.0.1:8765',             // yt-zhuyin asr_server.py
    targetLang: 'en',
    autoTranslate: GM_getValue('autoTranslate', true),// popup on every CJK selection; false = Alt+T only
    compactChrome: GM_getValue('compactChrome', true),// buttons + fixed/sticky boxes (popups, headers): zhuyin hidden, gloss on hover
    overflowGuard: true,                              // a box that starts overflowing after annotation goes compact
    gloss: GM_getValue('gloss', 'hover'),             // 'hover' | 'alt' (hold Alt while hovering) | 'off' (plain title tooltip)
    glossDelay: 220,                                  // ms of hover before the card shows
    glossMaxEntries: 4,                               // CEDICT entries per word
    glossMaxDefs: 6,                                  // definitions per entry
    selWordList: 24,                                  // selection popup: list word glosses if ≤ this many Han chars
    minHanAuto: 20,                                   // auto mode: need at least this many Han chars on the page
    sliceMs: 8,                                       // per idle slice of DOM work
    debug: false,
  };
  const log = (...a) => CFG.debug && console.log('[zhuyin]', ...a);
  const host = location.hostname;
  const siteKey = 'site:' + host;
  const siteMode = () => GM_getValue(siteKey, 'auto'); // 'auto' | 'on' | 'off'

  // ---------------------------------------------------------------- text classes
  const HAN = /[㐀-䶿一-鿿豈-﫿〇]|[\ud840-\ud87f][\udc00-\udfff]/;
  const HAN_RUN = /(?:[㐀-䶿一-鿿豈-﫿〇]|[\ud840-\ud87f][\udc00-\udfff])+/g;
  const ZY_JUNK = /[㄀-ㄯㆠ-ㆿˊˇˋ˙]/g;  // stripped from selections, belt and braces
  // Characters that exist in only one script. Enough to tell a Simplified page from a Traditional one.
  const SIMP_ONLY = new Set('这们来时个说为国会对发经过还没开问见长东车门马么书给让认样学现边头点进动实种关应机');
  const TRAD_ONLY = new Set('這們來時個說為國會對發經過還沒開問見長東車門馬麼書給讓認樣學現邊頭點進動實種關應機');

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'KBD',
    'SAMP', 'VAR', 'TITLE', 'SVG', 'MATH', 'RUBY', 'RT', 'RP', 'IFRAME', 'CANVAS', 'TEMPLATE']);

  const SKIP_IDS = new Set(['zyh-host', 'ytz-panel']);   // ours + yt-zhuyin's transcript panel (already has zhuyin)
  function shouldSkipElement(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName)) return true;
      if (e.isContentEditable) return true;
      if (e.tagName === 'ZY-RUN' || SKIP_IDS.has(e.id)) return true;
      if (e.getAttribute && e.getAttribute('translate') === 'no') return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- dictionary
  let DICT = null;
  function loadDict() {
    if (DICT) return DICT;
    const t0 = performance.now();
    const raw = GM_getResourceText('zydict');
    if (!raw) throw new Error('zhuyin dictionary resource missing');
    DICT = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    DICT.LT = Math.log(DICT.total || 2e7);
    log('dict parsed in', Math.round(performance.now() - t0), 'ms');
    return DICT;
  }

  // ---- segmentation (from yt-zhuyin: unigram max-likelihood over the zhuyin-native dictionary) ----
  // Works on code points, so Extension-B characters don't get split into surrogate halves.
  function segment(chars, D, maxLen = 6) {
    const n = chars.length, best = new Array(n + 1).fill(-Infinity), back = new Array(n + 1).fill(null);
    const UNK = -14;
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      const push = (cand) => { const s = best[i] + cand.score, j = i + cand.len; if (s > best[j]) { best[j] = s; back[j] = { i, cand }; } };
      const c = D.c[chars[i]];
      push(c ? { len: 1, zy: [c[0][0]], score: Math.log((c[1] || 0) + 1) - D.LT - 1, alts: c[0] }
             : { len: 1, zy: [null], score: UNK, alts: null });
      let key = chars[i];
      for (let L = 2; L <= maxLen && i + L <= n; L++) {
        key += chars[i + L - 1];
        const w = D.w[key];
        if (w) push({ len: L, zy: w[0].split(' '), score: Math.log((w[1] || 0) + 1) - D.LT, alts: null });
      }
    }
    const out = [];
    for (let j = n; j > 0; j = back[j].i) { const { cand, i } = back[j]; out.unshift({ chars: chars.slice(i, j), zy: cand.zy, alts: cand.alts }); }
    return out;
  }

  // ---- zhuyin helpers (from yt-zhuyin) ----
  const Z_INIT = { 'ㄅ':'b','ㄆ':'p','ㄇ':'m','ㄈ':'f','ㄉ':'d','ㄊ':'t','ㄋ':'n','ㄌ':'l','ㄍ':'g','ㄎ':'k','ㄏ':'h','ㄐ':'j','ㄑ':'q','ㄒ':'x','ㄓ':'zh','ㄔ':'ch','ㄕ':'sh','ㄖ':'r','ㄗ':'z','ㄘ':'c','ㄙ':'s' };
  const Z_FIN = { 'ㄚ':'a','ㄛ':'o','ㄜ':'e','ㄝ':'ê','ㄞ':'ai','ㄟ':'ei','ㄠ':'ao','ㄡ':'ou','ㄢ':'an','ㄣ':'en','ㄤ':'ang','ㄥ':'eng','ㄦ':'er',
    'ㄧ':'i','ㄧㄚ':'ia','ㄧㄛ':'io','ㄧㄝ':'ie','ㄧㄞ':'iai','ㄧㄠ':'iao','ㄧㄡ':'iu','ㄧㄢ':'ian','ㄧㄣ':'in','ㄧㄤ':'iang','ㄧㄥ':'ing',
    'ㄨ':'u','ㄨㄚ':'ua','ㄨㄛ':'uo','ㄨㄞ':'uai','ㄨㄟ':'ui','ㄨㄢ':'uan','ㄨㄣ':'un','ㄨㄤ':'uang','ㄨㄥ':'ong',
    'ㄩ':'ü','ㄩㄝ':'üe','ㄩㄢ':'üan','ㄩㄣ':'ün','ㄩㄥ':'iong' };
  const Z_STANDALONE = { 'ㄧ':'yi','ㄧㄚ':'ya','ㄧㄛ':'yo','ㄧㄝ':'ye','ㄧㄞ':'yai','ㄧㄠ':'yao','ㄧㄡ':'you','ㄧㄢ':'yan','ㄧㄣ':'yin','ㄧㄤ':'yang','ㄧㄥ':'ying',
    'ㄨ':'wu','ㄨㄚ':'wa','ㄨㄛ':'wo','ㄨㄞ':'wai','ㄨㄟ':'wei','ㄨㄢ':'wan','ㄨㄣ':'wen','ㄨㄤ':'wang','ㄨㄥ':'weng',
    'ㄩ':'yu','ㄩㄝ':'yue','ㄩㄢ':'yuan','ㄩㄣ':'yun','ㄩㄥ':'yong' };
  const normZhuyin = (s) => s.endsWith('˙') ? '˙' + s.slice(0, -1) : s;   // textbook: neutral dot in front
  // One zhuyin syllable → { py: toneless pinyin, tone: 1-5 }.
  function zySyl(s) {
    let tone = 1;
    if (s.startsWith('˙')) { tone = 5; s = s.slice(1); }
    else if (s.endsWith('˙')) { tone = 5; s = s.slice(0, -1); }
    else { const k = 'ˊˇˋ'.indexOf(s.at(-1)); if (k >= 0) { tone = k + 2; s = s.slice(0, -1); } }
    const init = Z_INIT[s[0]] ? s[0] : '', fin = s.slice(init.length);
    let py;
    if (!init) py = Z_STANDALONE[fin] ?? Z_FIN[fin];
    else { py = Z_INIT[init] + (fin ? (Z_FIN[fin] ?? '?') : 'i'); if ('jqx'.includes(Z_INIT[init])) py = py.replace('ü', 'u'); }
    return { py: py || '?', tone };
  }
  const MARKS = ['', '\u0304', '\u0301', '\u030c', '\u0300', ''];
  function markPinyin(py, tone) {
    const m = MARKS[tone]; if (!m) return py;
    const lower = py.toLowerCase(), vowels = 'aoeêiuü';
    let idx = -1;
    for (const v of ['a', 'e', 'ê']) { idx = lower.indexOf(v); if (idx >= 0) break; }
    if (idx < 0 && lower.includes('ou')) idx = lower.indexOf('o');
    if (idx < 0) for (let k = lower.length - 1; k >= 0; k--) if (vowels.includes(lower[k])) { idx = k; break; }
    if (idx < 0) return py;
    return (py.slice(0, idx + 1) + m + py.slice(idx + 1)).normalize('NFC');
  }
  function zhuyinToPinyin(s) { const { py, tone } = zySyl(s); return markPinyin(py, tone); }
  // Comparable reading key: "yin2 hang2" style, ü as v.
  const zyKey = (zys) => zys.map(z => { const { py, tone } = zySyl(z); return py.replace(/ü/g, 'v') + tone; }).join(' ');
  // CEDICT numbered pinyin "zhang3 de5" / "lu:e4" / "Tai2 wan1" → marked "zhǎng de" / "lüè" / "Táiwān"
  function numToMarked(num) {
    return num.split(/\s+/).map(sy => {
      const m = /^([A-Za-zü:]+?)([1-5])?$/.exec(sy); if (!m) return sy;
      return markPinyin(m[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü'), m[2] ? +m[2] : 5);
    }).join(' ');
  }
  const numKey = (num) => num.toLowerCase().replace(/u:/g, 'v').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const toneless = (k) => k.replace(/[0-9]/g, '');

  // ---------------------------------------------------------------- styles
  // Markup uses custom tags (<zy-w>, <zy-c>, <zy-z>…), not <span>: news sites style bare `span`
  // ("span+span::before{content:'、'}", "p span{font-size:20px!important}"), which wrecked the layout.
  // Nothing on a page targets zy-* tags; for the `*` / `.text *` rules that remain, every selector is
  // boosted with :is(#zyh#zyh#zyh, tag) — an impossible ID compound that never matches but lifts the
  // specificity to (3,0,1) — and `all:unset` wipes whatever non-inherited props got through.
  // Inherited text props (letter-spacing, text-indent, line-height…) are pinned explicitly on zhuyin.
  const B = (sel) => sel.replace(/\bzy-[a-z]+\b(?![^(]*\))/g, (t) => `${t}:is(#zyh#zyh#zyh,${t})`);
  function injectCss() {
    if (document.getElementById('zyh-css')) return;
    const s = document.createElement('style'); s.id = 'zyh-css';
    const rules = [
      ['zy-run, zy-w, zy-c, zy-z, zy-col, zy-zs, zy-dot, zy-tn', 'all:unset'],
      ['zy-run', `display:inline;word-break:normal;line-break:auto;--zyh-s:${CFG.scale}em`],   // a keep-all/strict parent would forbid breaks between words
      ['zy-w', `display:inline;white-space:nowrap;margin-right:${CFG.wordGap}em`],
      ['zy-c', 'display:inline-flex;align-items:center;vertical-align:baseline;text-indent:0'],   // each char is its own flex box: an inherited paragraph indent would hit every character
      ['zy-z', `display:inline-flex;align-items:flex-end;font-size:var(--zyh-s);line-height:1;margin:0 .1em 0 .15em;padding:0;
        color:currentColor;opacity:.72;white-space:nowrap;font-style:normal;font-weight:400;font-variant:normal;
        letter-spacing:0;word-spacing:0;text-indent:0;text-transform:none;text-align:left;text-decoration:none;text-shadow:none;
        writing-mode:horizontal-tb;vertical-align:baseline;float:none;position:static;
        font-family:"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei","Source Han Sans TW",sans-serif;
        -webkit-user-select:none;user-select:none;pointer-events:none`],
      ['zy-col', 'display:inline-flex;flex-direction:column;align-items:center'],
      ['zy-zs', 'display:inline;writing-mode:vertical-lr;text-orientation:upright'],
      ['zy-dot', 'display:block;width:.32em;height:.32em;border-radius:50%;background:currentColor;margin-bottom:.2em'],
      ['zy-tn', 'display:inline;font-size:1.5em;line-height:.6;width:.5em;margin-left:-.02em'],
      ['html.zyh-poly zy-c[data-p] zy-z', 'color:#d4a020;opacity:.9'],
      ['html.zyh-top zy-c', 'flex-direction:column-reverse;vertical-align:bottom'],
      ['html.zyh-top zy-z', 'align-items:center;margin:0 0 .05em 0;font-size:calc(var(--zyh-s) * .9)'],
      ['html.zyh-top zy-zs', 'writing-mode:horizontal-tb;text-orientation:mixed'],
      ['html.zyh-top zy-col', 'flex-direction:row'],
      ['html.zyh-top zy-dot', 'margin:0 .15em 0 0'],
      ['html.zyh-top zy-tn', 'font-size:1.3em;line-height:.7;width:auto;margin:0 0 0 .05em'],
      ['html.zyh-hidden zy-z', 'display:none'],
      ['zy-run[data-c] zy-z', 'display:none'],
      ['zy-run[data-c] zy-w', 'margin-right:0'],
      ['html.zyh-hidden zy-w', 'margin-right:0'],
    ];
    const imp = (decls) => decls.split(';').map(d => d.trim()).filter(Boolean)
      .map(d => (d.startsWith('--') ? d : d + '!important')).join(';');
    s.textContent = rules.map(([sel, d]) => `${sel.split(',').map(x => B(x.trim())).join(',')}{${imp(d)}}`).join('\n');
    (document.head || document.documentElement).appendChild(s);
    const root = document.documentElement.classList;
    root.toggle('zyh-top', CFG.layout === 'top');
    root.toggle('zyh-poly', CFG.showPolyphones);
  }

  // ---------------------------------------------------------------- rendering
  function zhuyinParts(z) {
    const dot = z.startsWith('˙'); if (dot) z = z.slice(1);
    const tone = 'ˊˇˋ'.includes(z.at(-1)) ? z.at(-1) : '';
    const col = document.createElement('zy-col');
    if (dot) { const d = document.createElement('zy-dot'); col.appendChild(d); }
    const syms = document.createElement('zy-zs'); syms.textContent = tone ? z.slice(0, -1) : z;
    col.appendChild(syms);
    if (!tone) return [col];
    const t = document.createElement('zy-tn'); t.textContent = tone;
    return [col, t];
  }

  // One Han run → fragment of word spans. Unknown characters are left as plain text.
  function renderRun(text, D) {
    const frag = document.createDocumentFragment();
    for (const w of segment([...text], D)) {
      if (w.zy[0] === null) { frag.appendChild(document.createTextNode(w.chars.join(''))); continue; }
      const word = document.createElement('zy-w');
      word.dataset.zy = w.zy.map(z => z || '?').join(' ');
      if (w.alts && w.alts.length > 1) word.dataset.alts = w.alts.slice(1).join(' ');
      w.chars.forEach((ch, i) => {
        const z = w.zy[i];
        const cc = document.createElement('zy-c');
        cc.appendChild(document.createTextNode(ch));
        if (z) {
          const zy = document.createElement('zy-z'); zy.setAttribute('aria-hidden', 'true');
          zy.append(...zhuyinParts(normZhuyin(z)));
          cc.appendChild(zy);
          if (w.alts && w.alts.length > 1) {
            cc.setAttribute('data-p', '');
            if (CFG.gloss === 'off') cc.title = 'also: ' + w.alts.slice(1).map(normZhuyin).join(' / ');
          }
        }
        word.appendChild(cc);
      });
      frag.appendChild(word);
      // Explicit break opportunity. Firefox won't wrap between two adjacent inline-flex boxes on some
      // sites (LTN: lines only broke at punctuation and overflowed the column); <wbr> works everywhere
      // and adds nothing to copied text.
      frag.appendChild(document.createElement('wbr'));
    }
    return frag;
  }

  // Replace one text node in place. The wrapper keeps the original string so 'off' can restore it.
  function annotateTextNode(node, D, compact) {
    const text = node.nodeValue;
    HAN_RUN.lastIndex = 0;
    if (!HAN_RUN.test(text)) return null;
    HAN_RUN.lastIndex = 0;
    const run = document.createElement('zy-run'); run.dataset.src = text;
    if (compact) run.setAttribute('data-c', '');
    let last = 0, m;
    while ((m = HAN_RUN.exec(text))) {
      if (m.index > last) run.appendChild(document.createTextNode(text.slice(last, m.index)));
      run.appendChild(renderRun(m[0], D));
      last = m.index + m[0].length;
    }
    if (last < text.length) run.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(run, node);
    return run;
  }

  // ---- compact mode: annotated (hover gloss works) but zhuyin hidden ----
  // UI chrome is sized for the bare text; 40% wider text overlaps buttons and clips in popups.
  const CHROME_SEL = 'button,[role=button],select,label,[role=tab],[role=menuitem]';
  const fixedMemo = new WeakMap();
  function inFixed(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    let v = fixedMemo.get(el);
    if (v === undefined) {
      const pos = getComputedStyle(el).position;
      v = pos === 'fixed' || pos === 'sticky' || inFixed(el.parentElement);
      fixedMemo.set(el, v);
    }
    return v;
  }
  const isChrome = (el) => CFG.compactChrome && (!!el.closest(CHROME_SEL) || inFixed(el));

  // How far content sticks out of a box, in px (0 for inline boxes, which report no client size).
  // The zhuyin column hangs a few px below an ordinary line, so the guard compares amounts against a
  // threshold instead of treating any overflow as breakage.
  const overflowOf = (a) => a.clientHeight ? Math.max(a.scrollHeight - a.clientHeight, a.scrollWidth - a.clientWidth, 0) : 0;
  function brokeBox(a, before) {
    const grew = overflowOf(a) - before;
    if (grew <= 6) return false;
    const cs = getComputedStyle(a);
    if (grew <= parseFloat(cs.fontSize) * 0.5) return false;
    return !(/auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX));   // scrollers are fine
  }
  const GUARD_DEPTH = 4;
  function guardAncestors(el, out) {
    for (let a = el, i = 0; a && i < GUARD_DEPTH && a !== document.body; a = a.parentElement, i++) out.add(a);
  }

  function restoreAll() {
    document.querySelectorAll('zy-run').forEach(r => r.replaceWith(document.createTextNode(r.dataset.src)));
  }

  // ---------------------------------------------------------------- work queue
  const queue = [];               // roots (elements or text nodes) waiting to be walked
  let scheduled = false, observer = null, active = false;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => CFG.sliceMs }), 16));

  function enqueue(n) { queue.push(n); if (!scheduled) { scheduled = true; idle(work, { timeout: 500 }); } }

  function collectTextNodes(root, out) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (HAN.test(root.nodeValue) && root.parentElement && !shouldSkipElement(root.parentElement)) out.push(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || shouldSkipElement(root)) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(n.tagName) || n.isContentEditable || n.tagName === 'ZY-RUN' || SKIP_IDS.has(n.id) ||
              n.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return HAN.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let n; (n = tw.nextNode());) out.push(n);
  }

  let pending = [];
  function work(deadline) {
    const D = loadDict();
    const t0 = performance.now();
    const budget = () => Math.min(deadline.timeRemaining(), CFG.sliceMs - (performance.now() - t0)) > 1;
    observer?.disconnect();
    try {
      // Batched so layout is read twice per slice, not once per node: gather → measure → write → measure.
      const batch = [];
      while ((pending.length || queue.length) && budget() && batch.length < 300) {
        if (!pending.length) { collectTextNodes(queue.shift(), pending); continue; }
        const n = pending.shift();
        if (n.isConnected && n.parentNode) batch.push(n);
      }
      if (batch.length) {
        const boxes = new Set(), compact = batch.map(n => isChrome(n.parentElement));
        if (CFG.overflowGuard) batch.forEach((n, i) => { if (!compact[i]) guardAncestors(n.parentElement, boxes); });
        const was = new Map([...boxes].map(a => [a, overflowOf(a)]));             // read
        batch.forEach((n, i) => { if (n.isConnected) annotateTextNode(n, D, compact[i]); });   // write
        for (const [a, before] of was) {                                          // read
          // already clipping before we touched it = a "Read more" clamp or ellipsis line, built to cut text off
          if (before > 2 || !a.isConnected || !brokeBox(a, before)) continue;
          a.querySelectorAll('zy-run:not([data-c])').forEach(r => r.setAttribute('data-c', ''));
          log('overflow guard → compact', a);
        }
      }
    } finally { observe(); }
    scheduled = false;
    if (pending.length || queue.length) { scheduled = true; idle(work, { timeout: 500 }); }
  }

  function observe() {
    if (!active) return;
    observer ??= new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') {
          // A site rewrote a text node we haven't touched (we only ever observe untouched ones).
          if (m.target.parentElement && !m.target.parentElement.closest('zy-run')) enqueue(m.target);
          continue;
        }
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'ZY-RUN' || SKIP_IDS.has(n.id))) continue;
          if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) enqueue(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------- page detection
  function sniff() {
    const lang = (document.documentElement.lang || '').toLowerCase();
    const sample = (document.body?.innerText || '').slice(0, 200000);
    let han = 0, s = 0, t = 0;
    for (const ch of sample) {
      if (!HAN.test(ch)) continue;
      han++;
      if (SIMP_ONLY.has(ch)) s++; else if (TRAD_ONLY.has(ch)) t++;
    }
    const tradLang = /^zh-(tw|hk|mo|hant)/.test(lang);
    const ok = han >= CFG.minHanAuto && (tradLang || t >= s);
    log('sniff', { lang, han, simp: s, trad: t, ok });
    return ok;
  }

  function start() {
    if (active) return;
    active = true;
    document.documentElement.classList.remove('zyh-hidden');
    injectCss();
    enqueue(document.body);
  }
  function stop() {
    active = false;
    observer?.disconnect(); observer = null;
    queue.length = 0; pending = [];
    restoreAll();
  }

  // ---------------------------------------------------------------- CC-CEDICT
  const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';
  let CEDICT = null, cedictP = null;

  async function gunzipMaybe(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0x1f && u8[1] === 0x8b) {   // still gzipped (a server may also have sent Content-Encoding and we got it plain)
      return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return new TextDecoder().decode(u8);
  }
  async function fetchCedictBytes() {
    try {
      const url = GM_getResourceURL('cedict');
      if (url) { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); }
    } catch (e) { log('cedict @resource unavailable, downloading', e); }
    return new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url: CEDICT_URL, responseType: 'arraybuffer', timeout: 60000,
      onload: (r) => (r.status === 200 ? res(r.response) : rej(new Error('HTTP ' + r.status))),
      onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout')) }));
  }
  // Index: traditional headword → raw lines. Lines are parsed only when looked up.
  function loadCedict() {
    return cedictP ??= (async () => {
      const t0 = performance.now();
      const text = await gunzipMaybe(await fetchCedictBytes());
      const map = new Map();
      for (let i = 0; i < text.length;) {
        let j = text.indexOf('\n', i); if (j < 0) j = text.length;
        if (text.charCodeAt(i) !== 35) {                       // '#' comment lines
          const sp = text.indexOf(' ', i);
          if (sp > i && sp < j) {
            const k = text.slice(i, sp), line = text.slice(i, text.charCodeAt(j - 1) === 13 ? j - 1 : j);
            const a = map.get(k); a ? a.push(line) : map.set(k, [line]);
          }
        }
        i = j + 1;
      }
      if (map.size < 50000) throw new Error('CC-CEDICT download looks truncated (' + map.size + ' entries)');   // don't cache a broken file as "no entry"
      CEDICT = map;
      log('cedict', map.size, 'headwords in', Math.round(performance.now() - t0), 'ms');
      return map;
    })().catch((e) => { cedictP = null; throw e; });
  }

  const CE_LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/$/;
  const HANC = '㐀-䶿一-鿿豈-﫿〇·';
  const RE_TS = new RegExp(`([${HANC}]+)\\|[${HANC}]+\\[([^\\]]+)\\]`, 'g');   // 個|个[ge4] → 個 gè
  const RE_T = new RegExp(`([${HANC}]+)\\[([^\\]]+)\\]`, 'g');                  // 得[de2]    → 得 dé
  const RE_PY = /\[([A-Za-z:1-5 ,·]+)\]/g;                                     // [le4 se4]  → [lèsè]
  const fmtDef = (d, py = true) => py
    ? d.replace(RE_TS, (_, t, p) => `${t} ${numToMarked(p)}`).replace(RE_T, (_, t, p) => `${t} ${numToMarked(p)}`).replace(RE_PY, (_, p) => `[${numToMarked(p)}]`)
    : d.replace(RE_TS, '$1').replace(RE_T, '$1').replace(/^CL:/, 'measure word: ').replace(/,(?=\S)/g, ', ').replace(/\s*\(?Taiwan pr\. \[[^\]]*\]\)?/g, '').replace(RE_PY, '').trim();
  const PRON_ONLY = /^(Taiwan pr\.|also pr\.|pr\. )/i;   // pronunciation notes, not meanings

  // Entries for a word, best first: the reading shown on the page (incl. "Taiwan pr." notes) beats a
  // toneless match beats the rest; capitalised (proper-noun/surname) readings sink.
  const lookup = (word, zys) => lookupKey(word, zys && zys.length && !zys.includes('?') ? zyKey(zys) : null);
  function lookupKey(word, key) {
    const lines = CEDICT?.get(word); if (!lines) return [];
    return lines.map((line, order) => {
      const m = CE_LINE.exec(line); if (!m) return null;
      const e = { trad: m[1], simp: m[2], num: m[3], defs: m[4].split('/').filter(Boolean), score: 0, order };
      if (key) {
        const k = numKey(e.num);
        const tw = /Taiwan pr\. \[([^\]]+)\]/.exec(m[4]);
        if (k === key) e.score = 3;
        else if (tw && numKey(tw[1]) === key) { e.score = 3; e.tw = tw[1]; }
        else if (toneless(k) === toneless(key)) e.score = 1;
      }
      if (/^[A-Z]/.test(e.num)) e.score -= 0.5;
      return e;
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order);
  }
  const shortDef = (e, py = true) => fmtDef(e.defs.find(d => !/^(surname|variant of|old variant of|used in|see |Taiwan pr)/i.test(d)) ?? e.defs[0] ?? '', py);

  // ---------------------------------------------------------------- translation
  const tCache = new Map();
  function gmFetch(opts) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ timeout: 15000, ...opts,
      onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
      onerror: () => reject(new Error('network error')), ontimeout: () => reject(new Error('timeout')) }));
  }
  async function translate(text) {
    const key = CFG.translator + '|' + text;
    if (tCache.has(key)) return tCache.get(key);
    let out;
    if (CFG.translator === 'local') {
      const r = JSON.parse(await gmFetch({ method: 'POST', url: CFG.localServer + '/translate',
        headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ lines: [text] }) }));
      out = r.lines?.[0] ?? '';
    } else {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-TW&tl=' + CFG.targetLang +
        '&dt=t&q=' + encodeURIComponent(text);
      const body = await gmFetch({ method: 'GET', url });
      let j; try { j = JSON.parse(body); } catch { throw new Error('Google returned a non-JSON page (rate-limited / captcha?)'); }
      out = (j[0] || []).map(seg => seg[0]).join('');
    }
    tCache.set(key, out);
    return out;
  }

  // Popup lives in a closed shadow root: page CSS can't touch it, and our CSS can't leak out.
  let pop = null;
  function popup() {
    if (pop) return pop;
    const hostEl = document.createElement('div'); hostEl.id = 'zyh-host';
    hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0';
    const sh = hostEl.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>
      .box{position:fixed;max-width:min(460px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;display:none;
        font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eee;background:rgba(22,22,24,.96);
        box-shadow:0 6px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(6px)}
      .src{font-size:13px;color:#aaa;margin-bottom:6px;max-height:4.4em;overflow:hidden;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .py{font-size:12px;color:#8ab4f8;margin-bottom:6px;max-height:3em;overflow:hidden}
      .en{white-space:pre-wrap;word-break:break-word}
      .en.err{color:#ff8a80}
      .bar{display:flex;gap:6px;margin-top:8px;font-size:12px;color:#888;align-items:center}
      .bar span{flex:1}
      button{all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.08);color:#ddd;font-size:12px}
      button:hover{background:rgba(255,255,255,.16)}
      .words{margin-top:8px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25);font-size:13px;max-height:40vh;overflow:auto}
      .wl{display:grid;grid-template-columns:auto auto 1fr;gap:1px 8px;align-items:baseline}
      .wl .h{font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:15px}
      .wl .p{color:#8ab4f8;font-size:12px;white-space:nowrap}
      .wl .d{color:inherit;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .gl{max-width:min(380px,calc(100vw - 24px));padding:9px 11px}
      .hw{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}
      .hw .han{font-size:22px;font-family:"Noto Sans TC","PingFang TC",sans-serif;line-height:1.1}
      .hw .zy{font-size:13px;color:#aaa;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .hw .pyl{font-size:13px;color:#8ab4f8}
      .ent{margin-top:4px}
      .ent.dim{opacity:.55}
      .ent .epy{color:#8ab4f8;font-size:12px;margin-right:6px}
      .ent .tag{font-size:10px;padding:0 4px;border-radius:4px;background:rgba(138,180,248,.18);color:#8ab4f8;margin-right:6px}
      .ent .defs{display:block}
      .ent .defs span+span::before{content:" · ";opacity:.5}
      .parts{margin-top:6px;padding-top:5px;border-top:1px solid rgba(127,127,127,.25);font-size:12px;opacity:.85}
      .parts b{font-weight:400;font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:14px;margin-right:6px}
      .part{padding:1px 4px;border-radius:4px;margin:0 -4px}
      .part.on{background:rgba(138,180,248,.16);opacity:1}
      .note{font-size:12px;opacity:.6;margin-top:4px}
      .foot{font-size:10px;opacity:.4;margin-top:6px;text-align:right}
      @media (prefers-color-scheme: light){.box{color:#1a1a1a;background:rgba(252,252,252,.97);border-color:rgba(0,0,0,.1)}
        .src,.hw .zy{color:#555}.py,.wl .p,.hw .pyl,.ent .epy{color:#1a5fb4}.ent .tag{color:#1a5fb4;background:rgba(26,95,180,.1)}
        button{background:rgba(0,0,0,.06);color:#222}button:hover{background:rgba(0,0,0,.12)}}
    </style>
    <div class="box tr"><div class="src"></div><div class="py"></div><div class="en"></div><div class="words"></div>
      <div class="bar"><span class="via"></span><button class="cp">copy</button><button class="x">✕</button></div></div>
    <div class="box gl"></div>`;
    document.documentElement.appendChild(hostEl);
    const $ = (s) => sh.querySelector(s);
    pop = { hostEl, box: $('.tr'), gl: $('.gl'), src: $('.src'), py: $('.py'), en: $('.en'), via: $('.via'), words: $('.words') };
    $('.x').onclick = hidePopup;
    $('.cp').onclick = () => GM_setClipboard(pop.en.textContent);
    pop.box.addEventListener('mousedown', (e) => e.stopPropagation());
    pop.gl.addEventListener('mousedown', (e) => e.stopPropagation());
    return pop;
  }
  function hidePopup() { if (pop) pop.box.style.display = 'none'; }

  function place(rect, b = pop.box) {
    b.style.display = 'block'; b.style.left = '0px'; b.style.top = '0px';
    const w = b.offsetWidth, h = b.offsetHeight, m = 8;
    let x = Math.min(Math.max(m, rect.left), innerWidth - w - m);
    let y = rect.bottom + m;
    if (y + h > innerHeight - m) y = Math.max(m, rect.top - h - m);
    b.style.left = x + 'px'; b.style.top = y + 'px';
  }

  // Pinyin line for the popup, from the same segmenter so it matches the zhuyin on the page.
  function pinyinOf(text) {
    const D = loadDict(), parts = [];
    let last = 0, m; HAN_RUN.lastIndex = 0;
    while ((m = HAN_RUN.exec(text))) {
      const gap = text.slice(last, m.index).trim(); if (gap) parts.push(gap);
      for (const w of segment([...m[0]], D)) parts.push(w.zy[0] === null ? w.chars.join('') : w.zy.map(zhuyinToPinyin).join(''));
      last = m.index + m[0].length;
    }
    const tail = text.slice(last).trim(); if (tail) parts.push(tail);
    return parts.join(' ');
  }

  // Selection text without the zhuyin: clone the range, drop annotation nodes, read textContent.
  // (Chromium includes user-select:none text in Selection.toString(), so stripping is required.)
  function selectionText(sel) {
    let out = '';
    for (let i = 0; i < sel.rangeCount; i++) {
      const frag = sel.getRangeAt(i).cloneContents();
      if (!frag.querySelector('zy-z')) { out += sel.getRangeAt(i).toString(); continue; }
      frag.querySelectorAll('zy-z').forEach(z => z.remove());
      // keep block boundaries as line breaks
      frag.querySelectorAll('p,div,li,br,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(b => b.after('\n'));
      out += frag.textContent;
    }
    return out.replace(ZY_JUNK, '');
  }
  // Ctrl+C: put the clean Chinese on the clipboard, not "銀ㄧㄣˊ行ㄏㄤˊ".
  document.addEventListener('copy', (e) => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.getRangeAt(0).cloneContents().querySelector('zy-z')) return;
    e.clipboardData.setData('text/plain', selectionText(sel));
    e.preventDefault();
  }, true);

  let reqId = 0;
  // Short selections: one row per dictionary word — reading as on the page + its best CEDICT sense.
  async function fillWordList(text, id, rect) {
    if (CFG.gloss === 'off') return;
    const han = text.match(HAN_RUN)?.join('') ?? '';
    if (!han || [...han].length > CFG.selWordList) return;
    try { await loadCedict(); } catch { return; }
    if (id !== reqId) return;
    const D = loadDict(), seen = new Set(), grid = document.createElement('div'); grid.className = 'wl';
    for (const run of text.match(HAN_RUN)) for (const w of segment([...run], D)) {
      const word = w.chars.join('');
      if (seen.has(word)) continue; seen.add(word);
      const zys = w.zy[0] === null ? null : w.zy;
      let e = lookup(word, zys)[0], def = e ? shortDef(e) : '';
      if (!e && w.chars.length > 1) def = w.chars.map((ch, i) => { const x = lookup(ch, zys ? [zys[i]] : null)[0]; return x ? shortDef(x).split(';')[0] : '?'; }).join(' + ');
      const cell = (cls, t) => { const d = document.createElement('span'); d.className = cls; d.textContent = t; grid.appendChild(d); };
      cell('h', word);
      cell('p', zys ? zys.map(zhuyinToPinyin).join('') : (e ? numToMarked(e.num).replace(/ /g, '') : ''));
      cell('d', def || '—');
    }
    if (!grid.childElementCount) return;
    pop.words.replaceChildren(grid); pop.words.style.display = 'block';
    place(rect);
  }
  async function translateSelection(force = false) {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (pop && sel.anchorNode && pop.hostEl.contains(sel.anchorNode)) return;
    const text = selectionText(sel).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 4500) return;
    if (!force && !HAN.test(text)) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const p = popup(), id = ++reqId;
    p.src.textContent = text;
    try { p.py.textContent = text.length <= 300 ? pinyinOf(text) : ''; } catch { p.py.textContent = ''; }
    p.en.className = 'en'; p.en.textContent = '…';
    p.via.textContent = CFG.translator === 'local' ? 'local opus-mt' : 'Google';
    p.words.replaceChildren(); p.words.style.display = 'none';
    place(rect);
    fillWordList(text, id, rect);
    try {
      const en = await translate(text);
      if (id !== reqId) return;
      p.en.textContent = en || '(empty)';
    } catch (e) {
      if (id !== reqId) return;
      p.en.className = 'en err';
      p.en.textContent = 'Translation failed: ' + e.message + (CFG.translator === 'local' ? ' — is asr_server.py running?' : '');
    }
    place(rect);
  }

  // ---------------------------------------------------------------- hover gloss
  let hoverWord = null, glossWord = null, glossChar = null, showT = 0, hideT = 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function hideGloss() { clearTimeout(showT); if (pop) pop.gl.style.display = 'none'; glossWord = null; }
  function scheduleHide() { clearTimeout(hideT); hideT = setTimeout(hideGloss, 200); }

  // Meaning-only card: the word's senses for the reading shown on the page, then what the hovered
  // character means on its own. No pinyin — the zhuyin is already on the page.
  async function showGloss(w, cc = null) {
    const p = popup();
    glossWord = w; glossChar = cc;
    const cells = [...w.querySelectorAll('zy-c')];
    const chars = cells.map(c => c.firstChild?.nodeValue ?? '');
    const word = chars.join('');
    const zys = (w.dataset.zy || '').split(' ').filter(Boolean);
    const known = zys.length === chars.length && !zys.includes('?');
    const hi = cc ? cells.indexOf(cc) : -1;
    const rect = w.getBoundingClientRect();
    const hw = el('div', 'hw'); hw.append(el('span', 'han', word));
    // zhuyin isn't on the page for compact (UI) text or when hidden with Alt+Z: show it here instead
    if (known && (w.closest('zy-run[data-c]') || document.documentElement.classList.contains('zyh-hidden')))
      hw.append(el('span', 'zy', zys.map(normZhuyin).join(' ')));
    p.gl.replaceChildren(hw);
    if (!CEDICT) {
      p.gl.append(el('div', 'note', 'loading CC-CEDICT…'));
      place(rect, p.gl);
      try { await loadCedict(); } catch (e) {
        if (glossWord === w) { p.gl.lastChild.textContent = 'CC-CEDICT unavailable: ' + e.message; place(rect, p.gl); }
        return;
      }
      if (glossWord !== w) return;
      p.gl.lastChild.remove();
    }
    const senses = (list) => {
      // Prefer the entries whose reading matches the page; fall back to everything if none do.
      const match = list.filter(e => e.score >= 3);
      return (match.length ? match : list).slice(0, CFG.glossMaxEntries);
    };
    const ents = senses(lookup(word, known ? zys : null));
    for (const e of ents) {
      const defs = e.defs.filter(d => !PRON_ONLY.test(d)).map(d => fmtDef(d, false)).filter(Boolean);
      if (!defs.length) continue;
      const box = el('div', 'ent'), list = el('span', 'defs');
      for (const d of defs.slice(0, CFG.glossMaxDefs)) list.append(el('span', null, d));
      if (defs.length > CFG.glossMaxDefs) list.append(el('span', null, `+${defs.length - CFG.glossMaxDefs}`));
      box.append(list); p.gl.append(box);
    }
    if (!ents.length) p.gl.append(el('div', 'note', 'not in CC-CEDICT as one word'));
    // Per-character meanings for compounds; the character under the cursor is highlighted.
    // When CEDICT reads the word with a neutral tone the IME dictionary doesn't have (長得 zhang3 de5 vs
    // ㄓㄤˇ ㄉㄜˊ), the character is looked up with CEDICT's syllable, so 得 is the particle, not "obtain".
    if (chars.length > 1 && chars.length <= 8) {
      const parts = el('div', 'parts');
      const wordSyl = ents[0] && ents[0].score >= 1 ? numKey(ents[0].num).split(' ') : null;
      chars.forEach((ch, i) => {
        const pageKey = known ? zyKey([zys[i]]) : null, ceKey = wordSyl?.[i];
        const useCe = ceKey && pageKey && ceKey !== pageKey && ceKey.endsWith('5') && toneless(ceKey) === toneless(pageKey);
        const x = senses(lookupKey(ch, useCe ? ceKey : pageKey))[0];
        const row = el('div', 'part' + (i === hi ? ' on' : ''));
        row.append(el('b', null, ch), ' ' + (x ? shortDef(x, false) : '—'));
        parts.append(row);
      });
      p.gl.append(parts);
    }
    if (w.dataset.alts) p.gl.append(el('div', 'note', 'other readings: ' + w.dataset.alts.split(' ').map(normZhuyin).join(' / ')));
    p.gl.append(el('div', 'foot', 'CC-CEDICT · MDBG'));
    place(rect, p.gl);
  }

  document.addEventListener('mouseover', (e) => {
    if (CFG.gloss === 'off') return;
    if (pop && e.composedPath().includes(pop.hostEl)) { clearTimeout(hideT); return; }   // moved onto the card
    const w = e.target.closest?.('zy-w') ?? null;
    const cc = e.target.closest?.('zy-c') ?? null;
    if (w && w === hoverWord) {   // moved to another character of the same word: just move the highlight
      if (glossWord === w && cc !== glossChar && CEDICT) showGloss(w, cc);
      return;
    }
    hoverWord = w; clearTimeout(showT);
    if (!w) { scheduleHide(); return; }
    clearTimeout(hideT);
    if (!cedictP) loadCedict().catch(() => {});   // start decompressing on first hover, not on page load
    if (CFG.gloss === 'alt' && !e.altKey) return;
    showT = setTimeout(() => { if (hoverWord === w) showGloss(w, cc); }, w === glossWord ? 0 : CFG.glossDelay);
  }, true);
  addEventListener('scroll', hideGloss, { capture: true, passive: true });

  let selTimer = 0;
  document.addEventListener('mouseup', (e) => {
    if (pop && e.composedPath().includes(pop.hostEl)) return;
    if (!CFG.autoTranslate || siteMode() === 'off') return;
    clearTimeout(selTimer); selTimer = setTimeout(() => translateSelection(false), 180);
  }, true);
  document.addEventListener('mousedown', (e) => { if (!pop || !e.composedPath().includes(pop.hostEl)) { hidePopup(); hideGloss(); } }, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Alt' && CFG.gloss === 'alt' && hoverWord) e.preventDefault(); }, true);   // keep Firefox's menu bar shut
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hidePopup(); hideGloss(); }
    if (e.key === 'Alt' && CFG.gloss === 'alt' && hoverWord && !e.repeat) { e.preventDefault(); showGloss(hoverWord, null); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (k === 'KeyZ') {
      e.preventDefault();
      if (!active) { start(); return; }
      document.documentElement.classList.toggle('zyh-hidden');
    } else if (k === 'KeyT') { e.preventDefault(); translateSelection(true); }
  }, true);

  // ---------------------------------------------------------------- menu
  const menuIds = [];
  function buildMenu() {
    menuIds.splice(0).forEach(id => { try { GM_unregisterMenuCommand(id); } catch {} });
    const m = siteMode();
    const next = { auto: 'on', on: 'off', off: 'auto' }[m];
    menuIds.push(GM_registerMenuCommand(`This site: ${m} → ${next}`, () => {
      GM_setValue(siteKey, next);
      if (next === 'off') stop(); else if (next === 'on' || sniff()) start();
      buildMenu();
    }));
    menuIds.push(GM_registerMenuCommand(`Layout: ${CFG.layout} → ${CFG.layout === 'side' ? 'top' : 'side'}`, () => {
      CFG.layout = CFG.layout === 'side' ? 'top' : 'side'; GM_setValue('layout', CFG.layout);
      document.documentElement.classList.toggle('zyh-top', CFG.layout === 'top'); buildMenu();
    }));
    menuIds.push(GM_registerMenuCommand(`Highlight polyphones: ${CFG.showPolyphones ? 'on → off' : 'off → on'}`, () => {
      CFG.showPolyphones = !CFG.showPolyphones; GM_setValue('poly', CFG.showPolyphones);
      document.documentElement.classList.toggle('zyh-poly', CFG.showPolyphones); buildMenu();
    }));
    menuIds.push(GM_registerMenuCommand(`Buttons & popups: ${CFG.compactChrome ? 'compact → full zhuyin' : 'full zhuyin → compact'}`, () => {
      CFG.compactChrome = !CFG.compactChrome; GM_setValue('compactChrome', CFG.compactChrome);
      if (active) { stop(); start(); } buildMenu();
    }));
    const gNext = { hover: 'alt', alt: 'off', off: 'hover' }[CFG.gloss];
    menuIds.push(GM_registerMenuCommand(`Word gloss: ${CFG.gloss} → ${gNext}`, () => {
      CFG.gloss = gNext; GM_setValue('gloss', gNext); hideGloss(); buildMenu();
    }));
    menuIds.push(GM_registerMenuCommand(`Translator: ${CFG.translator} → ${CFG.translator === 'google' ? 'local' : 'google'}`, () => {
      CFG.translator = CFG.translator === 'google' ? 'local' : 'google'; GM_setValue('translator', CFG.translator); buildMenu();
    }));
    menuIds.push(GM_registerMenuCommand(`Translate on select: ${CFG.autoTranslate ? 'on → off (Alt+T)' : 'off → on'}`, () => {
      CFG.autoTranslate = !CFG.autoTranslate; GM_setValue('autoTranslate', CFG.autoTranslate); buildMenu();
    }));
  }

  // ---------------------------------------------------------------- boot
  buildMenu();
  const mode = siteMode();
  if (mode === 'on') start();
  else if (mode === 'auto') {
    if (sniff()) start();
    else setTimeout(() => { if (!active && siteMode() === 'auto' && sniff()) start(); }, 3000);   // SPAs that render late
  }
  // YouTube is one long-lived page: a Chinese video after an English one should still switch us on.
  document.addEventListener('yt-navigate-finish', () => setTimeout(() => {
    if (!active && siteMode() === 'auto' && sniff()) start();
  }, 1500));
})();
