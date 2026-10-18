// ==UserScript==
// @name         注音 anywhere (Traditional Mandarin → zhuyin + select-to-translate)
// @namespace    local.zhuyin-anywhere
// @version      0.8.0
// @description  Annotates Traditional Chinese on any page with textbook-style zhuyin (word-segmented, Taiwan readings from McBopomofo via yt-zhuyin's dictionary). Hover a word for its meaning (CC-CEDICT, or Google in other languages); select text to translate it into English, Lithuanian or another language. Speaker buttons read words and selections aloud in Taiwan Mandarin. ⚙ on the popups opens the settings.
// @match        *://*/*
// @match        file:///*
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
// @connect      translate.google.com
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
 *     also stripped from the selection text, so copy/translate see only the Chinese. "Zhuyin on page" can
 *     hide it everywhere ('off') or show it only over the hovered word ('hover', an overlay that moves nothing);
 *     the text stays annotated either way, so the card still works. In the popups the zhuyin goes after the
 *     word, or beside each character ("Zhuyin in popups"), drawn with the same zy-col/zy-zs/zy-tn parts.
 *  5. Hover gloss: CC-CEDICT (CC BY-SA 4.0, MDBG) as a gzipped @resource — fetched once by Violentmonkey,
 *     stored base64 in extension storage, read lazily via GM_getResourceURL and gunzipped with
 *     DecompressionStream. Not GM_setValue: Violentmonkey ships every stored value into every page on
 *     injection, so 10 MB there would cost every site load. Entries are sorted so the one matching the
 *     zhuyin on the page comes first (incl. CEDICT's "Taiwan pr. [...]" notes). A segmenter word that
 *     CEDICT doesn't have (IME phrases like 最好的) is split into CEDICT words for the card and word list.
 *  6. Selection → translation popup (shadow DOM, isolated from page CSS) in the target language. Google
 *     gtx endpoint by default, or yt-zhuyin's local asr_server /translate (opus-mt, English only). With
 *     a target other than English the hover card and the word list are Google too (one batched request),
 *     as CC-CEDICT is English-only. "Hide meaning" blurs every translation until the reveal key is held.
 *  7. Read aloud: speaker button on both popups. Google's zh-TW voice (Taiwan Mandarin) as MP3, played
 *     through Web Audio, which page CSP media-src can't block. Offline or refused → the browser's own
 *     voice (speechSynthesis). Every row of the selection word list has its own speaker.
 *  8. Google translations and voice clips are cached in the page origin's IndexedDB (cacheMB per site, LRU).
 *  9. Touch: a tap opens a word's card; a long-press selection translates once it settles.
 * 10. Settings: one table (SETTINGS) drives both the Violentmonkey menu and the ⚙ panel in the popups.
 *
 * Hotkeys: Alt+Z cycles zhuyin on page (on → hover → off) · Alt (held) + hover shows gloss in 'alt' mode · Alt+T translate selection (when autoTranslate is off) ·
 *          R (configurable, Alt optional) read the open card or popup aloud · Shift (configurable, held) shows hidden meanings · Esc closes popups and stops reading aloud
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  const CFG = {
    zhuyin: GM_getValue('zhuyin', 'on'),             // on the page: 'on' | 'hover' (over the hovered word only) | 'off'; the card always shows it
    popupZhuyin: GM_getValue('popupZhuyin', 'after'),// card, selected text, word list: 'after' (after the word, one line) | 'beside' (by each character)
    hoverZhuyin: GM_getValue('hoverZhuyin', 'label'),// 'hover' mode: 'label' (one label above the word, moves nothing) | 'inline' (drawn in the line)
    layout: GM_getValue('layout', 'side'),           // 'side' (textbook column) | 'top' (horizontal, above)
    scale: 0.5,                                       // zhuyin size relative to the annotated text
    wordGap: 0.12,                                    // em of space between dictionary words (0 = none)
    showPolyphones: GM_getValue('poly', false),       // tint single chars whose reading is a guess among several
    translator: GM_getValue('translator', 'google'),  // 'google' | 'local'
    localServer: 'http://127.0.0.1:8765',             // yt-zhuyin asr_server.py
    targetLang: GM_getValue('targetLang', 'en'),     // Google language code; CC-CEDICT senses only for 'en'
    targetLang2: GM_getValue('targetLang2', ''),     // optional second language, shown under the first; '' = none
    autoTranslate: GM_getValue('autoTranslate', true),// popup on every CJK selection; false = Alt+T only
    pinyin: GM_getValue('pinyin', false),             // selection popup: pinyin line, and pinyin instead of zhuyin in the word list
    compactChrome: GM_getValue('compactChrome', true),// buttons + fixed/sticky boxes (popups, headers): zhuyin hidden, gloss on hover
    overflowGuard: true,                              // a box that starts overflowing after annotation goes compact
    theme: GM_getValue('theme', 'auto'),              // popups: 'auto' (follows the system) | 'dark' | 'light'
    cacheMB: GM_getValue('cacheMB', 100),             // Google translations + voice kept in IndexedDB, per site; 0 = off
    gloss: GM_getValue('gloss', 'hover'),             // 'hover' | 'alt' (hold Alt while hovering) | 'off' (plain title tooltip)
    hideMeaning: GM_getValue('hideMeaning', false),   // popups open, but translations stay blurred until revealKey is held
    revealKey: GM_getValue('revealKey', 'Shift'),     // KeyboardEvent.key: 'Shift' | 'Alt' | 'Control'
    speakKey: GM_getValue('speakKey', 'R'),           // 'R' or 'Alt+R': reads the open card or popup aloud (only while one is open)
    glossDelay: 220,                                  // ms of hover before the card shows
    glossHideDelay: 400,                              // ms off the word and card before the card hides
    glossSlack: 40,                                   // px around the word and card that still count as on them
    glossMaxEntries: 4,                               // CEDICT entries per word
    glossMaxDefs: 6,                                  // definitions per entry
    selWordList: 24,                                  // selection popup: list word glosses if ≤ this many Han chars
    minHanAuto: 20,                                   // auto mode: need at least this many Han chars on the page
    sliceMs: 8,                                       // per idle slice of DOM work
    debug: false,
  };
  const log = (...a) => CFG.debug && console.log('[zhuyin]', ...a);
  // Local files have no hostname: they share one "local files" setting instead of colliding on ''.
  const host = location.protocol === 'file:' ? 'local files' : location.hostname;
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
      ['html.zyh-off zy-z, html.zyh-hover zy-z', 'display:none'],
      ['html.zyh-off zy-w, html.zyh-hover zy-w', 'margin-right:0'],
      ['zy-run[data-c] zy-z', 'display:none'],
      ['zy-run[data-c] zy-w', 'margin-right:0'],
      // Hover: one label with the word's zhuyin floats above it, out of the flow so no text moves (shown in the
      // line, the word would widen, slip from under the pointer and flicker). One label, not one per character:
      // a syllable is wider than its character, so per-character labels overlap. Not for compact text.
      ['html.zyh-hover zy-w', 'position:relative'],
      ['html.zyh-hover:not(.zyh-inline) zy-run:not([data-c]) zy-w:hover::before', `content:attr(data-zl);position:absolute;bottom:100%;left:50%;
        transform:translateX(-50%);z-index:1;margin:0 0 .15em 0;padding:.15em .4em;border-radius:.3em;
        font-size:max(.6em,11px);line-height:1.2;font-weight:400;font-style:normal;letter-spacing:.05em;white-space:nowrap;
        background:Canvas;color:CanvasText;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;-webkit-user-select:none;user-select:none;
        font-family:"Noto Sans TC","Noto Sans CJK TC","PingFang TC","Microsoft JhengHei","Source Han Sans TW",sans-serif`],
      // Hover in the line: drawn as in 'on'. The word widens, so at a line end it can wrap away from the pointer.
      ['html.zyh-hover.zyh-inline zy-run:not([data-c]) zy-w:hover zy-z', 'display:inline-flex'],
      ['zy-c[data-on]', 'background:rgba(66,133,244,.16);box-shadow:0 .1em 0 rgba(66,133,244,.16),0 -.1em 0 rgba(66,133,244,.16)'],   // word of the open card; per character, as the card may show part of a zy-w
    ];
    const imp = (decls) => decls.split(';').map(d => d.trim()).filter(Boolean)
      .map(d => (d.startsWith('--') ? d : d + '!important')).join(';');
    s.textContent = rules.map(([sel, d]) => `${sel.split(',').map(x => B(x.trim())).join(',')}{${imp(d)}}`).join('\n');
    (document.head || document.documentElement).appendChild(s);
    const root = document.documentElement.classList;
    root.toggle('zyh-top', CFG.layout === 'top');
    root.toggle('zyh-poly', CFG.showPolyphones);
    zhuyinClass(CFG.zhuyin);
  }
  const zhuyinClass = (v) => { const root = document.documentElement.classList; root.toggle('zyh-off', v === 'off'); root.toggle('zyh-hover', v === 'hover'); root.toggle('zyh-inline', CFG.hoverZhuyin === 'inline'); };

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
      word.dataset.zl = w.zy.map(z => (z ? normZhuyin(z) : '?')).join(' ');   // the hover label
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

  // ---------------------------------------------------------------- disk cache
  // Google translations and voice clips, kept in IndexedDB so a reload doesn't ask Google again. IndexedDB
  // belongs to the page's origin, so each site has its own cache of up to cacheMB. (GM_setValue is shared
  // across sites, but Violentmonkey injects all of it into every page.) Least recently used goes first.
  // 'v': key → value. 'm': key → { k, n: bytes, t: last use }, small, so it's cheap to sum and sweep.
  let dbP = null, dbBytes = 0;
  const idbReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function cacheDb() {
    return dbP ??= (async () => {
      const open = indexedDB.open('zhuyin-anywhere', 1);
      open.onupgradeneeded = () => { const db = open.result; db.createObjectStore('v'); db.createObjectStore('m', { keyPath: 'k' }).createIndex('t', 't'); };
      const db = await idbReq(open);
      dbBytes = (await idbReq(db.transaction('m').objectStore('m').getAll())).reduce((s, m) => s + m.n, 0);
      return db;
    })().catch((e) => { log('cache unavailable', e); return null; });   // sandboxed frames, some private modes
  }
  async function cacheGet(k) {
    const db = CFG.cacheMB > 0 && await cacheDb(); if (!db) return undefined;
    try {
      const tx = db.transaction(['v', 'm'], 'readwrite'), m = tx.objectStore('m');
      const [v, meta] = await Promise.all([idbReq(tx.objectStore('v').get(k)), idbReq(m.get(k))]);
      if (v !== undefined && meta) m.put({ ...meta, t: Date.now() });
      return v;
    } catch (e) { log('cache read failed', e); return undefined; }
  }
  async function cachePut(k, v, n) {
    const db = CFG.cacheMB > 0 && await cacheDb(); if (!db) return;
    try {
      const tx = db.transaction(['v', 'm'], 'readwrite'), vs = tx.objectStore('v'), m = tx.objectStore('m');
      vs.put(v, k); m.put({ k, n, t: Date.now() }); dbBytes += n;
      const cap = CFG.cacheMB * 2 ** 20;
      if (dbBytes > cap) m.index('t').openCursor().onsuccess = (e) => {   // oldest first, down to 90%
        const c = e.target.result; if (!c || dbBytes <= cap * 0.9) return;
        dbBytes -= c.value.n; vs.delete(c.value.k); c.delete(); c.continue();
      };
    } catch (e) { log('cache write failed', e); }
  }

  // ---------------------------------------------------------------- translation
  const tCache = new Map();
  function gmFetch(opts) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ timeout: 15000, ...opts,
      onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(opts.responseType ? r.response : r.responseText) : reject(new Error('HTTP ' + r.status))),
      onerror: () => reject(new Error('network error')), ontimeout: () => reject(new Error('timeout')) }));
  }
  // Every target language Google Translate offers (codes as its gtx endpoint takes them), English and
  // Lithuanian first. The menu prompt also takes any other code.
  const LANGS = [['en', 'English'], ['lt', 'Lithuanian'], ...`af Afrikaans|sq Albanian|am Amharic|ar Arabic|hy Armenian|as Assamese|ay Aymara|
    az Azerbaijani|bm Bambara|eu Basque|be Belarusian|bn Bengali|bho Bhojpuri|bs Bosnian|bg Bulgarian|ca Catalan|ceb Cebuano|
    ny Chichewa|zh-CN Chinese (Simplified)|co Corsican|hr Croatian|cs Czech|da Danish|dv Dhivehi|doi Dogri|nl Dutch|eo Esperanto|
    et Estonian|ee Ewe|tl Filipino|fi Finnish|fr French|fy Frisian|gl Galician|ka Georgian|de German|el Greek|gn Guarani|
    gu Gujarati|ht Haitian Creole|ha Hausa|haw Hawaiian|iw Hebrew|hi Hindi|hmn Hmong|hu Hungarian|is Icelandic|ig Igbo|
    ilo Ilocano|id Indonesian|ga Irish|it Italian|ja Japanese|jw Javanese|kn Kannada|kk Kazakh|km Khmer|rw Kinyarwanda|
    gom Konkani|ko Korean|kri Krio|ku Kurdish (Kurmanji)|ckb Kurdish (Sorani)|ky Kyrgyz|lo Lao|la Latin|lv Latvian|ln Lingala|
    lg Luganda|lb Luxembourgish|mk Macedonian|mai Maithili|mg Malagasy|ms Malay|ml Malayalam|mt Maltese|mi Maori|mr Marathi|
    mni-Mtei Meiteilon (Manipuri)|lus Mizo|mn Mongolian|my Myanmar (Burmese)|ne Nepali|no Norwegian|or Odia|om Oromo|ps Pashto|
    fa Persian|pl Polish|pt Portuguese|pa Punjabi|qu Quechua|ro Romanian|ru Russian|sm Samoan|sa Sanskrit|gd Scots Gaelic|
    nso Sepedi|sr Serbian|st Sesotho|sn Shona|sd Sindhi|si Sinhala|sk Slovak|sl Slovenian|so Somali|es Spanish|su Sundanese|
    sw Swahili|sv Swedish|tg Tajik|ta Tamil|tt Tatar|te Telugu|th Thai|ti Tigrinya|ts Tsonga|tr Turkish|tk Turkmen|ak Twi|
    uk Ukrainian|ur Urdu|ug Uyghur|uz Uzbek|vi Vietnamese|cy Welsh|xh Xhosa|yi Yiddish|yo Yoruba|zu Zulu`
    .split('|').map(x => { x = x.trim(); const k = x.indexOf(' '); return [x.slice(0, k), x.slice(k + 1)]; })];
  const langName = (c) => LANGS.find(l => l[0] === c)?.[1] ?? c;
  const langs = () => [...new Set([CFG.targetLang, CFG.targetLang2].filter(Boolean))];
  const translator = (lang) => (CFG.translator === 'local' && lang === 'en' ? 'local' : 'google');   // opus-mt only knows English
  const viaText = () => {
    const ls = langs(), by = [...new Set(ls.map(l => (translator(l) === 'local' ? 'local opus-mt' : 'Google')))].join(' + ');
    return by + (ls.join() === 'en' ? '' : ' · ' + ls.map(langName).join(' + '));
  };
  // With two languages every translation line carries a small language tag.
  const langTag = (l) => (langs().length > 1 ? el('span', 'lg', l.toUpperCase()) : '');

  // The language is passed in, not read from CFG: a switch mid-request mustn't file the answer under the new one.
  const google = async (text, lang) => {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-TW&tl=' + encodeURIComponent(lang) +
      '&dt=t&q=' + encodeURIComponent(text);
    const body = await gmFetch({ method: 'GET', url });
    let j; try { j = JSON.parse(body); } catch { throw new Error('Google returned a non-JSON page (rate-limited / captcha?)'); }
    return (j[0] || []).map(seg => seg[0]).join('');
  };
  const putTr = (k, v) => cachePut(k, v, 2 * (k.length + v.length));
  async function translate(text, lang) {
    const tr = translator(lang), key = tr + '|' + lang + '|' + text;
    if (tCache.has(key)) return tCache.get(key);
    let out;
    if (tr === 'local') {
      const r = JSON.parse(await gmFetch({ method: 'POST', url: CFG.localServer + '/translate',
        headers: { 'Content-Type': 'application/json' }, data: JSON.stringify({ lines: [text] }) }));
      out = r.lines?.[0] ?? '';
    } else {
      const k = 'tr|' + lang + '|' + text;
      out = await cacheGet(k);
      if (out === undefined) { out = await google(text, lang); putTr(k, out); }
    }
    tCache.set(key, out);
    return out;
  }
  // Words for the hover card and the word list, Google only: the ones not cached go in one request, one
  // per line; Google keeps the lines apart. If it ever merges lines, each word is asked on its own.
  async function translateWords(words, lang) {
    const mk = (w) => 'google|' + lang + '|' + w, dk = (w) => 'tr|' + lang + '|' + w;
    const out = await Promise.all(words.map(async (w) => tCache.get(mk(w)) ?? cacheGet(dk(w))));
    const miss = words.filter((w, i) => out[i] === undefined);
    if (miss.length) {
      const lines = (await google(miss.join('\n'), lang)).split('\n').map(l => l.trim());
      const got = lines.length === miss.length ? lines : await Promise.all(miss.map(w => google(w, lang)));
      miss.forEach((w, i) => putTr(dk(w), got[i]));
      let m = 0; out.forEach((v, i) => { if (v === undefined) out[i] = got[m++]; });
    }
    words.forEach((w, i) => tCache.set(mk(w), out[i]));
    return out;
  }

  // ---------------------------------------------------------------- read aloud
  // Google's zh-TW voice, decoded and played through Web Audio: an <audio> element would be subject to
  // the page's CSP media-src, Web Audio isn't. Offline or refused → the browser's own voice, which on
  // Linux is often espeak-ng: worse, but better than silence.
  const ttsCache = new Map();   // chunk → Promise<AudioBuffer>; the MP3s also go to the disk cache
  let actx = null, playing = null;
  // Google takes at most 200 characters per request: split at punctuation, cut hard if a run is longer.
  function ttsChunks(text) {
    const out = [];
    let cur = '';
    for (let p of text.split(/(?<=[。！？；，、,.!?;\n])/)) {
      if (cur && cur.length + p.length > 200) { out.push(cur); cur = ''; }
      while (p.length > 200) { out.push(p.slice(0, 200)); p = p.slice(200); }
      cur += p;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  function ttsBuffer(chunk) {
    if (!ttsCache.has(chunk)) {
      const p = (async () => {
        const k = 'tts|zh-TW|' + chunk, hit = await cacheGet(k);
        const b = hit ?? await gmFetch({ method: 'GET', responseType: 'arraybuffer',
          url: 'https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=zh-TW&q=' + encodeURIComponent(chunk) });
        const buf = await actx.decodeAudioData(b.slice(0));   // decoding detaches its input
        if (!hit) cachePut(k, b, b.byteLength + 2 * k.length);   // only audio that decoded: not a captcha page
        return buf;
      })();
      p.catch(() => ttsCache.delete(chunk));
      ttsCache.set(chunk, p);
    }
    return ttsCache.get(chunk);
  }
  function speakBrowser(text, me) {
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => /^zh[-_]TW/i.test(v.lang)) || voices.find(v => /^(cmn|zh)(?![-_](HK|MO))/i.test(v.lang));
    if (!voice) return Promise.reject(new Error('no Mandarin voice in this browser'));
    return new Promise((res, rej) => {
      const u = me.utter = new SpeechSynthesisUtterance(text);
      u.voice = voice; u.lang = voice.lang;
      u.onend = res; u.onerror = (e) => rej(new Error(e.error));
      speechSynthesis.speak(u);
    });
  }
  function stopSpeaking() {
    if (!playing) return;
    const me = playing; playing = null;
    me.stopped = true;
    try { me.src?.stop(); } catch {}
    if (me.utter) speechSynthesis.cancel();
    me.btn.classList.remove('on');
  }
  // Click on a speaker: start reading; a second click on the same one stops it.
  async function speak(text, btn) {
    const same = playing?.btn === btn;
    stopSpeaking();
    text = text.trim();
    if (same || !text) return;
    actx ??= new AudioContext();
    actx.resume();   // still inside the click: autoplay rules want the gesture in this task
    speechSynthesis.getVoices();   // Chrome fills the list lazily
    const me = playing = { btn, stopped: false, src: null, utter: null };
    btn.classList.remove('err'); btn.classList.add('on'); btn.title = 'Stop';
    const chunks = ttsChunks(text);
    let i = 0, title = 'Read aloud';
    try {
      for (; i < chunks.length; i++) {
        const buf = await ttsBuffer(chunks[i]);
        if (i + 1 < chunks.length) ttsBuffer(chunks[i + 1]).catch(() => {});   // fetch the next while this plays
        if (me.stopped) return;
        await new Promise((res) => {
          const s = me.src = actx.createBufferSource();
          s.buffer = buf; s.connect(actx.destination); s.onended = res; s.start();
        });
        if (me.stopped) return;
      }
    } catch (e) {
      if (me.stopped) return;
      try {
        await speakBrowser(chunks.slice(i).join(''), me);
        title = `Read aloud (browser voice; Google voice failed: ${e.message})`;
      } catch (e2) {
        if (me.stopped) return;
        btn.classList.add('err');
        title = `Read aloud failed: Google voice: ${e.message}; browser voice: ${e2.message}`;
      }
    }
    if (me.stopped) return;
    playing = null;
    btn.classList.remove('on'); btn.title = title;
  }

  // Popup lives in a closed shadow root: page CSS can't touch it, and our CSS can't leak out.
  // Dark by default; the light rules apply under the host's data-theme (auto: when the system is light).
  const LIGHT = (host) => `.box{color:#1a1a1a;background:rgba(252,252,252,.97);border-color:rgba(0,0,0,.1)}
    .src{color:#555}.hw .zy{color:#333}.py,.wl .p,.hw .pyl,.ent .epy{color:#1a5fb4}.ent .tag,.lg{color:#1a5fb4;background:rgba(26,95,180,.1)}
    button{background:rgba(0,0,0,.06);color:#222}button:hover{background:rgba(0,0,0,.12)}
    .say.on{color:#1a5fb4;background:rgba(26,95,180,.12)}.box{color-scheme:light}
    .seg button.on{color:#fff;background:#1a5fb4}.set select,.set input{background:rgba(0,0,0,.06);color:#222}`
    .replace(/([^{}]+)\{/g, (_, sel) => sel.split(',').map(x => host + ' ' + x.trim()).join(',') + '{');
  let pop = null;
  function popup() {
    if (pop) return pop;
    const hostEl = document.createElement('div'); hostEl.id = 'zyh-host';
    hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0';
    hostEl.dataset.theme = CFG.theme;
    const sh = hostEl.attachShadow({ mode: 'closed' });
    // Built with DOM calls and a <style> element, not innerHTML: pages that enforce Trusted Types block
    // innerHTML (also on a shadow root), and the popup would never appear there.
    const css = el('style'); css.textContent = `
      .box{position:fixed;max-width:min(460px,calc(100vw - 24px));padding:10px 12px;border-radius:10px;display:none;color-scheme:dark;
        font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eee;background:rgba(22,22,24,.96);
        box-shadow:0 6px 28px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(6px)}
      .src{font-size:13px;color:#aaa;margin-bottom:6px;max-height:4.4em;overflow:hidden;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .src.zb{font-size:20px;line-height:1.5;color:inherit;max-height:9em;overflow:auto}
      .zc{display:inline-flex;align-items:center}
      .zz{display:inline-flex;align-items:flex-end;font-size:.45em;line-height:1;margin:0 .1em 0 .12em;opacity:.75;-webkit-user-select:none;user-select:none}
      .src .zz,.wl .zz{font-size:.5em}
      zy-col{display:inline-flex;flex-direction:column;align-items:center}
      zy-zs{writing-mode:vertical-lr;text-orientation:upright}
      zy-dot{display:block;width:.32em;height:.32em;border-radius:50%;background:currentColor;margin-bottom:.2em}
      zy-tn{font-size:1.5em;line-height:.6;width:.5em;margin-left:-.02em}
      .wl .h .zc{font-size:20px}
      .py{font-size:12px;color:#8ab4f8;margin-bottom:6px;max-height:3em;overflow:hidden}
      .py:empty{display:none}
      .en{white-space:pre-wrap;word-break:break-word}
      .en+.en{margin-top:4px}
      .lg{font-size:10px;padding:0 4px;border-radius:4px;background:rgba(138,180,248,.18);color:#8ab4f8;margin-right:6px;vertical-align:1px}
      .wl .d span+span::before{content:" · ";opacity:.5}
      .en.err{color:#ff8a80}
      .bar{display:flex;gap:6px;margin-top:8px;font-size:12px;color:#888;align-items:center}
      .bar span{flex:1}
      .say{display:inline-flex;align-items:center;padding:2px 6px}
      .say.on{color:#8ab4f8;background:rgba(138,180,248,.22)}
      .say.err{color:#ff8a80}
      .hw .say{align-self:center;padding:6px}
      .hw .say svg{width:18px;height:18px}
      button{all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.08);color:#ddd;font-size:12px}
      button:hover{background:rgba(255,255,255,.16)}
      .words{margin-top:8px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25);font-size:13px;max-height:40vh;overflow:auto}
      .wl{display:grid;grid-template-columns:auto auto auto 1fr;gap:1px 8px;align-items:baseline}
      .wl .say{align-self:center;padding:1px 4px}
      .wl .h{font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:15px}
      .wl .p{color:#8ab4f8;font-size:12px;white-space:nowrap;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .wl .d{color:inherit;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .gl{max-width:min(480px,calc(100vw - 24px));padding:12px 15px;font-size:15px}
      .hw{display:flex;align-items:baseline;gap:6px 12px;flex-wrap:wrap;margin-bottom:6px}
      .hw .han{font-size:32px;font-family:"Noto Sans TC","PingFang TC",sans-serif;line-height:1.1}
      .hw .zy{font-size:20px;color:#ccc;letter-spacing:.04em;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .hw .pyl{font-size:13px;color:#8ab4f8}
      .ent{margin-top:4px}
      .ent.dim{opacity:.55}
      .ent .epy{color:#8ab4f8;font-size:12px;margin-right:6px}
      .ent .tag{font-size:10px;padding:0 4px;border-radius:4px;background:rgba(138,180,248,.18);color:#8ab4f8;margin-right:6px}
      .ent .defs{display:block}
      .ent .defs span:not(.lg)+span::before,.part .m+.m::before{content:" · ";opacity:.5}
      .parts{margin-top:8px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25);font-size:13px;opacity:.85}
      .parts b{font-weight:400;font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:17px;margin-right:6px}
      .part{padding:1px 4px;border-radius:4px;margin:0 -4px}
      .part.on{background:rgba(138,180,248,.16);opacity:1}
      .note{font-size:13px;opacity:.6;margin-top:4px}
      .foot{font-size:10px;opacity:.4;margin-top:6px;text-align:right}
      .m{transition:filter .12s}
      :host([data-hide]) .m{filter:blur(5px);-webkit-user-select:none;user-select:none;cursor:pointer}
      .cfg{display:inline-flex;align-items:center;padding:2px 5px}
      .gl .cfg{position:absolute;top:6px;right:6px;background:none;opacity:.45}
      .gl .cfg:hover{opacity:1}
      .gl .hw{padding-right:22px}
      .gl .tl{font-size:17px;margin:2px 0 4px}
      .set{width:min(380px,calc(100vw - 24px));box-sizing:border-box;max-height:calc(100vh - 16px);overflow:auto;font-size:13px}
      .set .ttl{display:flex;align-items:center;font-weight:600;margin-bottom:8px}
      .set .ttl span{flex:1}
      .set .row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:4px 0}
      .set .row+.row{border-top:1px solid rgba(127,127,127,.15)}
      .set .hint{grid-column:1/-1;font-size:11px;opacity:.55;margin-top:-2px}
      .seg{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:2px}
      .seg button.on{color:#111;background:#8ab4f8}
      .set select,.set input{font:inherit;font-size:12px;color:#ddd;background:rgba(255,255,255,.08);border:0;border-radius:6px;padding:3px 6px}
      .set input{width:5em}
      @media (prefers-color-scheme: light){${LIGHT(':host([data-theme=auto])')}}
      ${LIGHT(':host([data-theme=light])')}
    `;
    const icon = (...paths) => {
      const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
      for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: 14, height: 14, fill: 'currentColor', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
      for (const at of paths) { const pa = document.createElementNS(NS, 'path'); for (const [k, v] of Object.entries(at)) pa.setAttribute(k, v); svg.append(pa); }
      return svg;
    };
    const btn = (cls, title, child) => { const b = el('button', cls); if (title) b.title = title; b.append(child); return b; };
    const bar = el('div', 'bar');
    bar.append(el('span', 'via'),
      btn('say', 'Read aloud', icon({ d: 'M2 6h3l4-3v10l-4-3H2z' },
        { d: 'M11 5.5a3.5 3.5 0 0 1 0 5', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' })),
      btn('cp', null, 'copy'),
      btn('cfg', 'Settings', icon({ 'fill-rule': 'evenodd', d: 'M6.9 1h2.2l.4 1.9 1.2.5 1.6-1.1 1.6 1.6-1.1 1.6.5 1.2 1.9.4v2.2l-1.9.4-.5 1.2 1.1 1.6-1.6 1.6-1.6-1.1-1.2.5-.4 1.9H6.9l-.4-1.9-1.2-.5-1.6 1.1-1.6-1.6 1.1-1.6-.5-1.2L1 9.1V6.9l1.9-.4.5-1.2-1.1-1.6 1.6-1.6 1.6 1.1 1.2-.5zM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z' })),
      btn('x', null, '✕'));
    const tr = el('div', 'box tr');
    tr.append(el('div', 'src'), el('div', 'py'), el('div', 'tx'), el('div', 'words'), bar);
    sh.append(css, tr, el('div', 'box gl'), el('div', 'box set'));
    document.documentElement.appendChild(hostEl);
    const $ = (s) => sh.querySelector(s);
    pop = { hostEl, box: $('.tr'), gl: $('.gl'), set: $('.set'), src: $('.src'), py: $('.py'), tx: $('.tx'), via: $('.via'), words: $('.words'), say: $('.say'), cfg: $('.cfg') };
    $('.x').onclick = hidePopup;
    $('.cp').onclick = () => GM_setClipboard([...pop.tx.querySelectorAll('.t')].map(t => t.textContent).join('\n'));
    pop.say.onclick = () => speak(pop.text, pop.say);
    pop.cfg.onclick = () => openSettings(pop.box.getBoundingClientRect());
    for (const b of [pop.box, pop.gl, pop.set]) b.addEventListener('mousedown', (e) => e.stopPropagation());
    // Holding the pointer on a blurred meaning reveals it too: touch has no reveal key.
    sh.addEventListener('pointerdown', (e) => { if (e.target.closest('.m')) { revealPtr = true; reveal(); } });
    addEventListener('pointerup', () => { if (revealPtr) { revealPtr = false; reveal(); } }, true);
    addEventListener('pointercancel', () => { if (revealPtr) { revealPtr = false; reveal(); } }, true);
    reveal();
    return pop;
  }
  function hidePopup() { if (pop) { pop.box.style.display = 'none'; if (playing && pop.box.contains(playing.btn)) stopSpeaking(); } }
  // Popup Chinese with each character's zhuyin beside it ('beside'), drawn like on the page. zys: one per char; null or '?' = none.
  function zyChars(chars, zys) {
    const f = document.createDocumentFragment();
    chars.forEach((ch, i) => {
      const z = zys?.[i];
      if (!z || z === '?') { f.append(ch); return; }
      const c = el('span', 'zc', ch), zz = el('span', 'zz'); zz.append(...zhuyinParts(normZhuyin(z))); c.append(zz); f.append(c);
    });
    return f;
  }
  function zyLine(text) {
    const f = document.createDocumentFragment(), D = loadDict(); let last = 0;
    for (const m of text.matchAll(HAN_RUN)) {
      f.append(text.slice(last, m.index));
      for (const w of segment([...m[0]], D)) f.append(zyChars(w.chars, w.zy));
      last = m.index + m[0].length;
    }
    f.append(text.slice(last));
    return f;
  }
  const sayBtn = (text) => { const b = pop.say.cloneNode(true); b.className = 'say'; b.title = 'Read aloud'; b.onclick = () => speak(text, b); return b; };
  const cfgBtn = (onclick) => { const b = pop.cfg.cloneNode(true); b.onclick = onclick; return b; };
  const shown = (b) => pop?.[b].style.display === 'block';

  // "Hide meaning": translations carry class .m and are blurred unless the reveal key or the pointer is held.
  let revealKeyDown = false, revealPtr = false;
  const reveal = () => pop?.hostEl.toggleAttribute('data-hide', CFG.hideMeaning && !revealKeyDown && !revealPtr);
  const KEY_NAMES = { Shift: 'Shift', Alt: 'Alt', Control: 'Ctrl' };
  const holdHint = () => (CFG.hideMeaning ? ' · hold ' + KEY_NAMES[CFG.revealKey] : '');

  // The segmenter's words come from an IME dictionary, which also lists phrases for typing (我在, 最好的).
  // Where CC-CEDICT has no such word, the card and the word list split it into the fewest CC-CEDICT
  // words, single characters always allowed. Returns [start, end) pairs; the page's zhuyin is kept.
  function ceSplit(chars) {
    const n = chars.length;
    if (n < 2 || CEDICT.has(chars.join(''))) return [[0, n]];
    const best = [0], back = [];
    for (let j = 1; j <= n; j++) {
      best[j] = Infinity;
      for (let i = Math.max(0, j - 8); i < j; i++)   // ascending i: the longest piece wins a tie
        if (best[i] + 1 < best[j] && (j - i === 1 || CEDICT.has(chars.slice(i, j).join('')))) { best[j] = best[i] + 1; back[j] = i; }
    }
    const out = [];
    for (let j = n; j > 0; j = back[j]) out.unshift([back[j], j]);
    return out;
  }

  // Below the anchor, else above it. The hover card also keeps off an open translation popup: below or
  // above the word if that's clear of it, else beside, below or above the popup; overlapping only if the
  // window is too small for any of those.
  function place(rect, b = pop.box) {
    b.style.display = 'block'; b.style.left = '0px'; b.style.top = '0px';
    const w = b.offsetWidth, h = b.offsetHeight, m = 8;
    const g = b === pop.box ? m : 2;   // hover card hugs its word: less way to travel, fewer words to cross
    const x = Math.min(Math.max(m, rect.left), innerWidth - w - m);
    const below = rect.bottom + g, above = rect.top - h - g;
    let spot = [x, below + h > innerHeight - m ? Math.max(m, above) : below];
    if (b !== pop.box && pop.box.style.display === 'block') {
      const t = pop.box.getBoundingClientRect(), y = Math.min(Math.max(m, rect.top), innerHeight - h - m);
      const ok = ([sx, sy]) => sx >= m && sx + w <= innerWidth - m && sy >= m && sy + h <= innerHeight - m &&
        (sx >= t.right + m / 2 || sx + w <= t.left - m / 2 || sy >= t.bottom + m / 2 || sy + h <= t.top - m / 2);
      spot = [[x, below], [x, above], [t.right + m, y], [t.left - w - m, y], [x, t.bottom + m], [x, t.top - h - m]].find(ok) ?? spot;
    }
    b.style.left = spot[0] + 'px'; b.style.top = spot[1] + 'px';
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
  // Short selections: one row per dictionary word — reading as on the page, then per target language its
  // best CEDICT sense (English) or Google's translation (any other language, all words in one request).
  async function fillWordList(text, id, rect) {
    if (CFG.gloss === 'off') return;
    const han = text.match(HAN_RUN)?.join('') ?? '';
    if (!han || [...han].length > CFG.selWordList) return;
    try { await loadCedict(); } catch { return; }
    if (id !== reqId) return;
    const D = loadDict(), ls = langs(), seen = new Set(), grid = el('div', 'wl'), words = [];
    const goog = new Map(ls.filter(l => l !== 'en').map(l => [l, []]));   // language → cells waiting for Google
    for (const run of text.match(HAN_RUN)) for (const w of segment([...run], D)) for (const [a, b] of ceSplit(w.chars)) {
      const word = w.chars.slice(a, b).join('');
      if (seen.has(word)) continue; seen.add(word); words.push(word);
      const zys = w.zy[0] === null ? null : w.zy.slice(a, b);
      const e = lookup(word, zys)[0], d = el('span', 'd m');
      for (const l of ls) { const c = el('span', null, l === 'en' ? (e && shortDef(e)) || '—' : '…'); d.append(c); goog.get(l)?.push(c); }
      const beside = CFG.popupZhuyin === 'beside' && !CFG.pinyin && zys, h = el('span', 'h');
      h.append(beside ? zyChars(w.chars.slice(a, b), zys) : word);
      grid.append(sayBtn(word), h, el('span', 'p', beside ? '' : !CFG.pinyin ? (zys ? zys.map(normZhuyin).join(' ') : '')
        : zys ? zys.map(zhuyinToPinyin).join('') : (e ? numToMarked(e.num).replace(/ /g, '') : '')), d);
    }
    if (!grid.childElementCount) return;
    pop.words.replaceChildren(grid); pop.words.style.display = 'block';
    place(rect);
    if (!goog.size) return;
    await Promise.all([...goog].map(async ([l, cells]) => {
      try { const out = await translateWords(words, l); cells.forEach((c, i) => { c.textContent = out[i] || '—'; }); }
      catch (e) { cells.forEach((c) => { c.textContent = '—'; c.title = 'Translation failed: ' + e.message; }); }
    }));
    if (id === reqId) place(rect);
  }
  let selRect = null;
  async function translateSelection(force = false) {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    if (pop && sel.anchorNode && pop.hostEl.contains(sel.anchorNode)) return;
    const text = selectionText(sel).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 4500) return;
    if (!force && !HAN.test(text)) return;
    showTranslation(text, sel.getRangeAt(0).getBoundingClientRect());
  }
  // One line per target language. Also called again by the settings when a language, the translator or pinyin changes.
  async function showTranslation(text, rect) {
    selRect = rect;
    const p = popup(), id = ++reqId;
    p.text = text;
    const beside = CFG.popupZhuyin === 'beside' && text.length <= 120;   // longer: plain, it would fill the screen
    p.src.classList.toggle('zb', beside);
    p.src.replaceChildren(beside ? zyLine(text) : text);
    try { p.py.textContent = CFG.pinyin && text.length <= 300 ? pinyinOf(text) : ''; } catch { p.py.textContent = ''; }
    const lines = langs().map((l) => { const t = el('span', 't', '…'), d = el('div', 'en m'); d.append(langTag(l), t); return [l, d, t]; });
    p.tx.replaceChildren(...lines.map(x => x[1]));
    p.via.textContent = viaText() + holdHint();
    p.words.replaceChildren(); p.words.style.display = 'none';
    hideGloss();   // a card opened before the popup wasn't placed clear of it (Alt+T while hovering)
    place(rect);
    fillWordList(text, id, rect);
    await Promise.all(lines.map(async ([l, d, t]) => {
      try {
        const out = await translate(text, l);
        if (id === reqId) t.textContent = out || '(empty)';
      } catch (e) {
        if (id !== reqId) return;
        d.className = 'en err';
        t.textContent = 'Translation failed: ' + e.message + (translator(l) === 'local' ? ' — is asr_server.py running?' : '');
      }
    }));
    if (id === reqId) place(rect);
  }

  // ---------------------------------------------------------------- hover gloss
  let hoverWord = null, glossWord = null, glossChar = null, showT = 0, hideT = 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let onCells = [];
  const tint = (cells) => { onCells.forEach(c => c.removeAttribute('data-on')); (onCells = cells).forEach(c => c.setAttribute('data-on', '')); };
  function hideGloss() { clearTimeout(showT); if (pop) pop.gl.style.display = 'none'; tint([]); glossWord = null; }
  // Slipping a little off the word or card isn't leaving: while the pointer stays close, check again.
  let mx = 0, my = 0;
  document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, { capture: true, passive: true });
  const near = (r, d = CFG.glossSlack) => mx > r.left - d && mx < r.right + d && my > r.top - d && my < r.bottom + d;
  // The strip between the word and its card above or below it overlaps the next line's words; crossing it
  // on the way to the card mustn't switch the card to them.
  function onWayToCard(x, y) {
    if (!glossWord || pop.gl.style.display !== 'block') return false;
    const a = glossWord.getBoundingClientRect(), b = pop.gl.getBoundingClientRect(), d = 2;
    if (x < b.left - d || x > b.right + d) return false;
    return b.top >= a.bottom ? y >= a.bottom - d && y <= b.top + d : b.bottom <= a.top && y >= b.bottom - d && y <= a.top + d;
  }
  function scheduleHide() {
    clearTimeout(hideT);
    hideT = setTimeout(() => {
      if (glossWord && (near(pop.gl.getBoundingClientRect()) || near(glossWord.getBoundingClientRect()))) scheduleHide();
      else hideGloss();
    }, CFG.glossHideDelay);
  }

  // Meaning-only card: the word's senses for the reading shown on the page, then what the hovered
  // character means on its own, for each target language: CC-CEDICT for English, Google for the others
  // (CC-CEDICT still decides where the word ends). No pinyin — the zhuyin is already on the page.
  let glossReq = 0;
  async function showGloss(w, cc = null) {
    const p = popup(), req = ++glossReq;
    glossWord = w; glossChar = cc;
    const stale = () => req !== glossReq || glossWord !== w;   // hidden or moved on while Google answered
    let cells = [...w.querySelectorAll('zy-c')];
    let chars = cells.map(c => c.firstChild?.nodeValue ?? '');
    let zys = (w.dataset.zy || '').split(' ').filter(Boolean);
    const known = zys.length === chars.length && !zys.includes('?');
    let hi = cc ? cells.indexOf(cc) : -1;
    if (!CEDICT) {
      tint(cells);
      p.gl.replaceChildren(el('div', 'note', 'loading CC-CEDICT…'));
      place(w.getBoundingClientRect(), p.gl);
      try { await loadCedict(); } catch (e) {
        if (glossWord === w) { p.gl.lastChild.textContent = 'CC-CEDICT unavailable: ' + e.message; place(w.getBoundingClientRect(), p.gl); }
        return;
      }
      if (glossWord !== w) return;
      hi = glossChar ? cells.indexOf(glossChar) : -1;   // the pointer may have moved on within the word
    }
    // Not one CC-CEDICT word: the card is for the piece under the pointer (the first one with Alt).
    const [a, b] = ceSplit(chars).find(([, b]) => hi < b);
    cells = cells.slice(a, b); chars = chars.slice(a, b); if (known) zys = zys.slice(a, b); if (hi >= 0) hi -= a;
    const word = chars.join('');
    tint(cells);
    const rs = cells.map(c => c.getBoundingClientRect());
    const rect = { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) };
    // Speaker first: the card opens under the word's left edge, so it's the shortest way from the word.
    const beside = known && CFG.popupZhuyin === 'beside', han = el('span', 'han');
    han.append(beside ? zyChars(chars, zys) : word);
    const hw = el('div', 'hw'); hw.append(sayBtn(word), han);
    // Larger than on the page, where it's half the text size and hard to read; also the only place it
    // shows for compact (UI) text or with "Zhuyin on page" off.
    if (known && !beside)
      hw.append(el('span', 'zy', zys.map(normZhuyin).join(' ')));
    p.gl.replaceChildren(hw, cfgBtn(() => { const r = p.gl.getBoundingClientRect(); hideGloss(); openSettings(r); }));
    const senses = (list) => {
      // Prefer the entries whose reading matches the page; fall back to everything if none do.
      const match = list.filter(e => e.score >= 3);
      return (match.length ? match : list).slice(0, CFG.glossMaxEntries);
    };
    const ls = langs(), ents = ls.includes('en') ? senses(lookup(word, known ? zys : null)) : [];
    const goog = new Map(ls.filter(l => l !== 'en').map(l => [l, [[word], []]]));   // language → [words, cells] for Google
    for (const l of ls) {
      if (l !== 'en') {
        const t = el('span', 't', '…'), line = el('div', 'tl m');
        line.append(langTag(l), t); p.gl.append(line); goog.get(l)[1].push(t);
        continue;
      }
      let tag = langTag('en');
      for (const e of ents) {
        const defs = e.defs.filter(d => !PRON_ONLY.test(d)).map(d => fmtDef(d, false)).filter(Boolean);
        if (!defs.length) continue;
        const box = el('div', 'ent m'), list = el('span', 'defs');
        list.append(tag); tag = '';
        for (const d of defs.slice(0, CFG.glossMaxDefs)) list.append(el('span', null, d));
        if (defs.length > CFG.glossMaxDefs) list.append(el('span', null, `+${defs.length - CFG.glossMaxDefs}`));
        box.append(list); p.gl.append(box);
      }
      if (!ents.length) { const n = el('div', 'note'); n.append(langTag('en'), 'not in CC-CEDICT'); p.gl.append(n); }
    }
    // Per-character meanings for compounds, one per language; the character under the cursor is highlighted.
    // When CEDICT reads the word with a neutral tone the IME dictionary doesn't have (長得 zhang3 de5 vs
    // ㄓㄤˇ ㄉㄜˊ), the character is looked up with CEDICT's syllable, so 得 is the particle, not "obtain".
    if (chars.length > 1 && chars.length <= 8) {
      const parts = el('div', 'parts');
      const wordSyl = ents[0] && ents[0].score >= 1 ? numKey(ents[0].num).split(' ') : null;
      chars.forEach((ch, i) => {
        const row = el('div', 'part' + (i === hi ? ' on' : ''));
        row.append(el('b', null, ch));
        for (const l of ls) {
          if (l === 'en') {
            const pageKey = known ? zyKey([zys[i]]) : null, ceKey = wordSyl?.[i];
            const useCe = ceKey && pageKey && ceKey !== pageKey && ceKey.endsWith('5') && toneless(ceKey) === toneless(pageKey);
            const x = senses(lookupKey(ch, useCe ? ceKey : pageKey))[0];
            row.append(el('span', 'm', x ? shortDef(x, false) : '—'));
          } else {
            const c = el('span', 'm', '…'); row.append(c);
            const g = goog.get(l); g[0].push(ch); g[1].push(c);
          }
        }
        parts.append(row);
      });
      p.gl.append(parts);
    }
    if (w.dataset.alts && chars.length === 1) p.gl.append(el('div', 'note', 'other readings: ' + w.dataset.alts.split(' ').map(normZhuyin).join(' / ')));
    p.gl.append(el('div', 'foot', [ls.includes('en') && 'CC-CEDICT · MDBG', goog.size && 'Google'].filter(Boolean).join(' · ') + holdHint()));
    place(rect, p.gl);
    if (!goog.size) return;
    await Promise.all([...goog].map(async ([l, [ws, cells]]) => {
      try {
        const out = await translateWords(ws, l);
        if (!stale()) cells.forEach((c, i) => { c.textContent = out[i] || '—'; });
      } catch (e) {
        if (stale()) return;
        cells.forEach((c) => { c.textContent = '—'; });
        cells[0].textContent = 'Translation failed: ' + e.message;
      }
    }));
    if (!stale()) place(rect, p.gl);
  }

  // Touch (Firefox for Android): no hover, so a tap on a word opens its card, and a selection made by
  // long-press translates once the handles stop moving. Taps also fire emulated mouse events; those are
  // ignored, the pointer type of the last pointer event tells them apart.
  let pointer = 'mouse', selTimer = 0;
  const notePointer = (e) => { pointer = e.pointerType; };
  document.addEventListener('pointerdown', notePointer, { capture: true, passive: true });
  document.addEventListener('pointermove', notePointer, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    if (pointer !== 'touch' || CFG.gloss === 'off' || (pop && e.composedPath().includes(pop.hostEl))) return;
    const w = e.target.closest?.('zy-w');
    if (!w || e.target.closest('a,button,label,summary') || !getSelection().isCollapsed) return;   // links still work
    hoverWord = w; clearTimeout(hideT);
    showGloss(w, e.target.closest('zy-c'));
  }, true);
  document.addEventListener('selectionchange', () => {
    if (pointer !== 'touch' || !CFG.autoTranslate || siteMode() === 'off') return;
    clearTimeout(selTimer); selTimer = setTimeout(() => translateSelection(false), 600);
  });

  document.addEventListener('mouseover', (e) => {
    if (CFG.gloss === 'off' || pointer === 'touch') return;
    if (pop && e.composedPath().includes(pop.hostEl)) {   // moved onto the card: keep it, drop words crossed on the way
      clearTimeout(hideT); clearTimeout(showT); hoverWord = glossWord; return;
    }
    if (e.buttons) { hoverWord = null; hideGloss(); return; }   // drag-selecting: no card over the selection
    const w = e.target.closest?.('zy-w') ?? null;
    if (w && w !== glossWord && onWayToCard(e.clientX, e.clientY)) { clearTimeout(hideT); return; }
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

  document.addEventListener('mouseup', (e) => {
    if (pointer === 'touch' || (pop && e.composedPath().includes(pop.hostEl))) return;
    if (!CFG.autoTranslate || siteMode() === 'off') return;
    clearTimeout(selTimer); selTimer = setTimeout(() => translateSelection(false), 180);
  }, true);
  document.addEventListener('mousedown', (e) => { if (!pop || !e.composedPath().includes(pop.hostEl)) { hidePopup(); hideGloss(); hideSettings(); } }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === CFG.revealKey && revealKeyDown) { revealKeyDown = false; reveal(); }
    // Alt alone toggles Firefox's menu bar on release: keep it shut when the Alt press was ours.
    if (e.key === 'Alt' && ((CFG.gloss === 'alt' && hoverWord) || (CFG.hideMeaning && CFG.revealKey === 'Alt' && (shown('box') || shown('gl'))))) e.preventDefault();
  }, true);
  addEventListener('blur', () => { if (revealKeyDown) { revealKeyDown = false; reveal(); } });   // released in another window
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hidePopup(); hideGloss(); hideSettings(); stopSpeaking(); }
    if (e.key === CFG.revealKey && CFG.hideMeaning && !revealKeyDown) { revealKeyDown = true; reveal(); }   // no return: Alt may also open the card
    if (e.key === 'Alt' && CFG.gloss === 'alt' && hoverWord && !e.repeat) { e.preventDefault(); showGloss(hoverWord, null); return; }
    // Read-aloud key, with or without Alt; Shift is allowed, it may be the reveal key. Only while a card or
    // popup is open and not while typing, and then it's ours: the page's own shortcut on that letter doesn't fire.
    if (e.code === 'Key' + CFG.speakKey.at(-1) && e.altKey === CFG.speakKey.startsWith('Alt+') && !e.ctrlKey && !e.metaKey &&
        !e.repeat && (shown('gl') || shown('box')) && !typing(e)) { e.preventDefault(); e.stopPropagation(); speakOpen(); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.code;
    if (k === 'KeyZ') {
      e.preventDefault();
      if (!active) { start(); return; }
      const r = SETTINGS.find(r => r.k === 'zhuyin'), i = r.opts.findIndex(o => o[0] === CFG.zhuyin);
      setCfg(r, r.opts[(i + 1) % r.opts.length][0]);
    } else if (k === 'KeyT') { e.preventDefault(); translateSelection(true); }
  }, true);
  // In a text field, or in the settings panel (its select jumps to options by letter). Events from inside
  // the closed shadow root arrive retargeted to its host; a focused speaker button there is fine.
  function typing(e) {
    const t = e.composedPath()[0];
    if (t === pop?.hostEl) return shown('set');
    return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }
  // Read-aloud key: the word card if it's open, else the translation popup. A press is a click on that
  // speaker, so a second press stops it.
  function speakOpen() {
    const b = shown('gl') ? pop.gl.querySelector('.hw .say') : shown('box') ? pop.say : null;
    b?.click();
  }

  // ---------------------------------------------------------------- settings
  // One table drives the Violentmonkey menu and the ⚙ panel. A row stores CFG[k] under GM key `gm ?? k`
  // unless it has its own get/set; `apply` makes the change take effect on the open page.
  // Controls: `opts` (few values: buttons, cycled in the menu), `list` (a select, a prompt in the menu), `num`.
  const onOff = [[true, 'on'], [false, 'off']];
  const retranslate = () => { if (shown('box')) showTranslation(pop.text, selRect); };
  const SETTINGS = [
    { label: host === 'local files' ? 'Local files' : 'This site', get: siteMode, set: (v) => GM_setValue(siteKey, v),
      opts: [['auto', 'auto'], ['on', 'on'], ['off', 'off']], hint: 'auto: only pages that look like Traditional Chinese',
      apply: (v) => { if (v === 'off') stop(); else if (v === 'on' || sniff()) start(); } },
    { label: 'Translate to', k: 'targetLang', list: LANGS, free: true, ask: 'a Google language code or name (lt, en, Lithuanian…)', apply: () => { hideGloss(); retranslate(); },
      hint: 'Not English: word cards and word lists are translated by Google too' },
    { label: 'Second language', k: 'targetLang2', list: [['', 'none'], ...LANGS], free: true, ask: 'a Google language code or name, or none', apply: () => { hideGloss(); retranslate(); },
      hint: 'Shown under the first in every popup' },
    { label: 'Translator', k: 'translator', opts: [['google', 'Google'], ['local', 'local opus-mt']], apply: retranslate,
      hint: 'local (yt-zhuyin asr_server.py) translates to English only' },
    { label: 'Hide meaning', k: 'hideMeaning', opts: onOff, apply: () => { reveal(); retranslate(); },
      hint: 'Popups still open and read aloud; translations stay blurred until the reveal key is held' },
    { label: 'Reveal key', k: 'revealKey', opts: Object.entries(KEY_NAMES), apply: retranslate },
    { label: 'Read aloud key', k: 'speakKey', ask: 'a letter, or Alt+ a letter (R, Alt+R…)', hint: 'Works while a word card or translation is open',
      list: [...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => [c, c]), ...[...'ABCDEFGHIJKLMNOPQRSUVWXY'].map(c => ['Alt+' + c, 'Alt+' + c])] },   // Alt+Z, Alt+T are taken
    { label: 'Word gloss', k: 'gloss', opts: [['hover', 'hover'], ['alt', 'Alt'], ['off', 'off']], apply: hideGloss },
    { label: 'Translate on select', k: 'autoTranslate', opts: [[true, 'on'], [false, 'Alt+T']] },
    { label: 'Pinyin in translation', k: 'pinyin', opts: onOff, apply: retranslate },
    { label: 'Zhuyin on page', k: 'zhuyin', opts: [['on', 'on'], ['hover', 'hover'], ['off', 'off']],
      hint: 'hover: only over the word under the pointer. The word card always shows it. Alt+Z switches',
      // Drawn zhuyin again: restart, so the overflow guard measures it (while hidden, nothing overflowed).
      apply: (v) => { zhuyinClass(v); if (v === 'on' && active) { stop(); start(); } } },
    { label: 'Zhuyin in popups', k: 'popupZhuyin', opts: [['after', 'after the word'], ['beside', 'by each character']],
      apply: () => { hideGloss(); retranslate(); }, hint: 'Word card, selected text and word list' },
    { label: 'Hover zhuyin', k: 'hoverZhuyin', opts: [['label', 'label above'], ['inline', 'in the line']], apply: () => zhuyinClass(CFG.zhuyin),
      hint: 'With Zhuyin on page: hover. In the line can push the word to the next line' },
    { label: 'Layout', k: 'layout', opts: [['side', 'side'], ['top', 'top']],
      apply: (v) => document.documentElement.classList.toggle('zyh-top', v === 'top') },
    { label: 'Highlight polyphones', k: 'showPolyphones', gm: 'poly', opts: onOff,
      apply: (v) => document.documentElement.classList.toggle('zyh-poly', v) },
    { label: 'Buttons & popups', k: 'compactChrome', opts: [[true, 'compact'], [false, 'full zhuyin']], apply: () => { if (active) { stop(); start(); } } },
    { label: 'Popup theme', k: 'theme', opts: [['auto', 'auto'], ['dark', 'dark'], ['light', 'light']], apply: (v) => { if (pop) pop.hostEl.dataset.theme = v; } },
    { label: 'Cache, MB per site', k: 'cacheMB', num: true, hint: 'Google translations and voice clips; 0 = off' },
  ];
  const getCfg = (r) => (r.get ? r.get() : CFG[r.k]);
  const valName = (r, v) => (r.opts ?? r.list)?.find(o => o[0] === v)?.[1] ?? (r.num && !v ? 'off' : String(v));
  function setCfg(r, v) {
    if (r.set) r.set(v); else { CFG[r.k] = v; GM_setValue(r.gm ?? r.k, v); }
    r.apply?.(v);
    buildMenu();
    if (shown('set')) renderSettings();
  }
  // Menu prompt for a list or number row; null when cancelled or invalid.
  function askCfg(r) {
    const v = prompt(r.num ? `${r.label} (0 = off):` : `${r.label}: ${r.ask}`, getCfg(r));
    if (v === null) return null;
    if (r.num) return +v >= 0 ? +v : null;
    const c = v.trim(), hit = r.list.find(o => o[0].toLowerCase() === c.toLowerCase() || o[1].toLowerCase() === c.toLowerCase());
    return hit ? hit[0] : r.free && /^[a-zA-Z-]{2,10}$/.test(c) ? c : null;
  }

  function renderSettings() {
    const ttl = el('div', 'ttl'), x = el('button', null, '✕');
    x.onclick = hideSettings;
    ttl.append(el('span', null, '注音 anywhere · settings'), x);
    const rows = SETTINGS.map((r) => {
      const row = el('div', 'row'), v = getCfg(r);
      let ctl;
      if (r.opts) {
        ctl = el('span', 'seg');
        for (const [ov, name] of r.opts) { const b = el('button', ov === v ? 'on' : null, name); b.onclick = () => setCfg(r, ov); ctl.append(b); }
      } else if (r.list) {
        ctl = el('select');
        const list = r.list.some(o => o[0] === v) ? r.list : [[v, v], ...r.list];   // a code typed into the menu prompt
        for (const [ov, name] of list) { const o = el('option', null, name); o.value = ov; ctl.append(o); }
        ctl.value = v; ctl.onchange = () => setCfg(r, ctl.value);
      } else {
        ctl = el('input'); ctl.type = 'number'; ctl.min = '0'; ctl.value = v;
        ctl.onchange = () => { if (ctl.value !== '' && +ctl.value >= 0) setCfg(r, +ctl.value); };
      }
      row.append(el('span', null, r.label), ctl);
      if (r.hint) row.append(el('div', 'hint', r.hint));
      return row;
    });
    pop.set.replaceChildren(ttl, ...rows);
  }
  // Next to the box whose ⚙ opened it (kept clear of an open translation popup), or top right from the menu.
  function openSettings(rect) {
    popup(); renderSettings();
    place(rect ?? { left: innerWidth, top: 0, bottom: 0 }, pop.set);
  }
  function hideSettings() { if (pop) pop.set.style.display = 'none'; }

  // ---------------------------------------------------------------- menu
  const menuIds = [];
  function buildMenu() {
    menuIds.splice(0).forEach(id => { try { GM_unregisterMenuCommand(id); } catch {} });
    menuIds.push(GM_registerMenuCommand('Settings…', () => openSettings(null)));
    for (const r of SETTINGS) {
      const v = getCfg(r);
      if (r.opts) {
        const [nv, nn] = r.opts[(r.opts.findIndex(o => o[0] === v) + 1) % r.opts.length];
        menuIds.push(GM_registerMenuCommand(`${r.label}: ${valName(r, v)} → ${nn}`, () => setCfg(r, nv)));
      } else {
        menuIds.push(GM_registerMenuCommand(`${r.label}: ${valName(r, v)} (change…)`, () => { const nv = askCfg(r); if (nv !== null) setCfg(r, nv); }));
      }
    }
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
