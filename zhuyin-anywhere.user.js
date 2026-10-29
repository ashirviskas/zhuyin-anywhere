// ==UserScript==
// @name         注音 anywhere (Traditional Mandarin → zhuyin + select-to-translate)
// @namespace    local.zhuyin-anywhere
// @version      0.9.5
// @description  Annotates Traditional Chinese on any page with textbook-style zhuyin (word-segmented, Taiwan readings from McBopomofo via yt-zhuyin's dictionary). Hover a word for its meaning (CC-CEDICT, or Google in other languages); select text to translate it into English, Lithuanian or another language. Speaker buttons read words and selections aloud in Taiwan Mandarin. ⚙ on the popups opens the settings.
// @match        *://*/*
// @match        file:///*
// @noframes
// @homepageURL  https://github.com/ashirviskas/zhuyin-anywhere
// @downloadURL  https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js
// @updateURL    https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js
// @resource     zydict https://cdn.jsdelivr.net/gh/ashirviskas/yt-zhuyin@main/zhuyin-dict.js
// @resource     cedict https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
// @resource     comps https://cdn.jsdelivr.net/gh/ashirviskas/zhuyin-anywhere@main/data/components.tsv.gz
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
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
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
 *     (銀行 ㄏㄤˊ, not ㄒㄧㄥˊ). MutationObserver feeds new content into the same queue. With "Zhuyin is
 *     added: near the screen" (lazy), two IntersectionObservers annotate text only within a few screens of
 *     the viewport and put text far away back, so a book-length page stays a few thousand elements.
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
 *  6. Selection → translation popup (shadow DOM, isolated from page CSS) in the target language. place() opens every
 *     popup on the side its anchor's screen position decides, with the edge facing the anchor pinned, so popups
 *     don't jump as they fill or as a card opens from a card; "Popup size" scales every px of their CSS. Google
 *     gtx endpoint by default, or yt-zhuyin's local asr_server /translate (opus-mt, English only). With
 *     a target other than English the hover card and the word list are Google too (one batched request),
 *     as CC-CEDICT is English-only. "Hide meaning" blurs every translation until the reveal key is held.
 *  7. Read aloud: speaker button on both popups. Google's zh-TW voice (Taiwan Mandarin) as MP3, played
 *     through Web Audio, which page CSP media-src can't block. Offline or refused → the browser's own
 *     voice (speechSynthesis). Every row of the selection word list has its own speaker.
 *  8. Google translations and voice clips are cached in the page origin's IndexedDB (cacheMB per site, LRU).
 *  9. Touch: a tap opens a word's card; a long-press selection translates once it settles.
 * 10. Settings: one table (SETTINGS) drives both the Violentmonkey menu and the ⚙ panel in the popups. The panel
 *     has tabs (Page, Popups, Translate, Learn); Learn-only rows (`ui`) aren't in the menu.
 * 11. Character parts: data/components.tsv.gz (Make Me a Hanzi + CJKVI-IDS + Wiktionary, built by tools/components),
 *     another lazy @resource. A one-character card shows the parts and origin; a click on a part, or on a
 *     character row of a word's card, redraws the card for it (renderCard), with a crumb back.
 * 12. Tints: the N most common characters (counted from the zhuyin dictionary) and My characters get a colour
 *     hashed from the character, set per zy-c as --zyt; an html class picks the style. Drawn behind the glyph, so
 *     nothing moves. Hovering a look in the settings previews it without storing it.
 * 13. Notes: "what's new" once after an update; "update available" when main's @version is newer (checked daily).
 *
 * Hotkeys: Alt+Z cycles zhuyin on page (on → hover → off) · Alt (held) + hover shows gloss in 'alt' mode · Alt+T translate selection (when autoTranslate is off) ·
 *          R (configurable, Alt optional) read the open card or popup aloud · Shift (configurable, held) shows hidden meanings, double-tapped on an open card or popup switches Hide meaning · Esc closes popups and stops reading aloud
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------- config
  // A newcomer's language: the browser's, with English second; English alone for English and Chinese browsers.
  const BROWSER_LANG = (() => {
    const b = (navigator.language || 'en').toLowerCase().split('-')[0];
    return b === 'zh' ? 'en' : ({ nb: 'no', nn: 'no', fil: 'tl' })[b] ?? b;
  })();
  const CFG = {
    zhuyin: GM_getValue('zhuyin', 'on'),             // on the page: 'on' | 'hover' (over the hovered word only) | 'off'; the card always shows it
    popupZhuyin: GM_getValue('popupZhuyin', 'beside'),// card, selected text, word list: 'beside' (by each character) | 'after' (after the word, one line)
    hoverZhuyin: GM_getValue('hoverZhuyin', 'label'),// 'hover' mode: 'label' (one label above the word, moves nothing) | 'inline' (drawn in the line)
    layout: GM_getValue('layout', 'side'),           // 'side' (textbook column) | 'top' (horizontal, above)
    scale: 0.5,                                       // zhuyin size relative to the annotated text
    wordGap: 0.12,                                    // em of space between dictionary words (0 = none)
    showPolyphones: GM_getValue('poly', false),       // tint single chars whose reading is a guess among several
    translator: GM_getValue('translator', 'google'),  // 'google' | 'local'
    localServer: 'http://127.0.0.1:8765',             // yt-zhuyin asr_server.py
    targetLang: GM_getValue('targetLang', BROWSER_LANG),// Google language code; CC-CEDICT senses only for 'en'
    targetLang2: GM_getValue('targetLang2', BROWSER_LANG === 'en' ? '' : 'en'),// optional second language, shown under the first; '' = none
    autoTranslate: GM_getValue('autoTranslate', true),// popup on every CJK selection; false = Alt+T only
    pinyin: GM_getValue('pinyin', false),             // selection popup: pinyin line, and pinyin instead of zhuyin in the word list
    compactChrome: GM_getValue('compactChrome', true),// buttons + fixed/sticky boxes (popups, headers): zhuyin hidden, gloss on hover
    overflowGuard: true,                              // a box that starts overflowing after annotation goes compact
    lazy: GM_getValue('lazy', true),                  // annotate only text near the screen, put far-off text back (long pages stay fast)
    nearScreens: 2,                                   // lazy: annotated once this many viewport heights away, or closer
    farScreens: 6,                                    // lazy: back to plain text once this far
    theme: GM_getValue('theme', 'auto'),              // popups: 'auto' (follows the system) | 'dark' | 'light'
    cacheMB: GM_getValue('cacheMB', 100),             // Google translations + voice kept in IndexedDB, per site; 0 = off
    gloss: GM_getValue('gloss', 'hover'),             // 'hover' | 'alt' (hold Alt while hovering) | 'off' (plain title tooltip)
    popupScale: GM_getValue('popupScale', 100),       // % size of the popups: text, spacing and boxes
    hideMeaning: GM_getValue('hideMeaning', false),   // popups open, but translations stay blurred until revealKey is held
    revealKey: GM_getValue('revealKey', 'Shift'),     // KeyboardEvent.key: 'Shift' | 'Alt' | 'Control'
    speakKey: GM_getValue('speakKey', 'R'),           // 'R' or 'Alt+R': reads the open card or popup aloud (only while one is open)
    parts: GM_getValue('parts', true),                // word card: what a character is made of, its origin; click a part to open it
    partsLang: GM_getValue('partsLang', true),        // part meanings, hint and origin also in the target language(s) when not English
    tintTop: GM_getValue('tintTop', 0),               // tint the N most common characters; 0 = off, up to 1000
    tintMine: GM_getValue('tintMine', true),          // tint (and underline) My characters
    myChars: GM_getValue('myChars', ''),              // My characters, one string; added from the card's highlighter or the settings
    tintStyle: GM_getValue('tintStyle', 'box'),       // 'box' | 'marker' (highlighter) | 'ink' (coloured text) | 'under' (underline)
    tintCovers: GM_getValue('tintCovers', 'char'),    // 'char' (the character only) | 'both' (character + its zhuyin)
    tintPalette: GM_getValue('tintPalette', 'pastel'),// key of PALETTES
    tintStrength: GM_getValue('tintStrength', 35),    // % opacity of box, highlighter and underline
    glossDelay: 220,                                  // ms of hover before the card shows
    glossHideDelay: 400,                              // ms off the word and card before the card hides
    glossKeep: 1500,                                  // ms, at least, after a card is opened from a card
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
      ['zy-run, zy-w, zy-c, zy-h, zy-z, zy-col, zy-zs, zy-dot, zy-tn', 'all:unset'],
      ['zy-h', 'display:inline;position:relative;isolation:isolate'],   // the tint's ::before sits behind the glyph
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
      ['html.zyh-tc zy-c[data-t] zy-h::before', `content:"";position:absolute;left:-.06em;right:-.06em;top:50%;height:1.2em;
        transform:translateY(-50%);z-index:-1;border-radius:.18em;pointer-events:none`],
      ...Object.entries(TINT_CSS).flatMap(([st, [glyph, cell]]) => [[`html.zyh-t-${st}.zyh-tc zy-c[data-t] zy-h${st === 'ink' ? '' : '::before'}`, glyph],
        [`html.zyh-t-${st}:not(.zyh-tc) zy-c[data-t]`, cell]]),
      ['zy-c[data-t="m"] zy-h', 'text-decoration:underline .1em var(--zyu);text-underline-offset:.18em'],
      ['zy-c[data-on]', 'background:rgba(66,133,244,.16);box-shadow:0 .1em 0 rgba(66,133,244,.16),0 -.1em 0 rgba(66,133,244,.16)'],   // word of the open card; per character, as the card may show part of a zy-w
    ];
    const imp = (decls) => decls.split(';').map(d => d.trim()).filter(Boolean)
      .map(d => (d.startsWith('--') ? d : d + '!important')).join(';');
    s.textContent = rules.map(([sel, d]) => `${sel.split(',').map(x => B(x.trim())).join(',')}{${imp(d)}}`).join('\n');
    (document.head || document.documentElement).appendChild(s);
    const root = document.documentElement.classList;
    tintClass();
    root.toggle('zyh-top', CFG.layout === 'top');
    root.toggle('zyh-poly', CFG.showPolyphones);
    zhuyinClass(CFG.zhuyin);
  }
  const zhuyinClass = (v) => { const root = document.documentElement.classList; root.toggle('zyh-off', v === 'off'); root.toggle('zyh-hover', v === 'hover'); root.toggle('zyh-inline', CFG.hoverZhuyin === 'inline'); };

  // ---------------------------------------------------------------- tints
  // The N most common characters and My characters get a light colour of their own. A character's colour is
  // a function of the character and the palette only (FNV-1a hash → hue), so it's the same on every page and
  // for everyone. Each tinted zy-c carries data-t ('t', or 'm' for My characters, which are also underlined)
  // and its colour in --zyt; the html class picks how it's drawn: box, highlighter, coloured text, underline.
  // [the glyph alone ("covers: character": drawn on zy-h::before, a box 1.2em tall behind it, so the layout doesn't
  // change and boxes on neighbouring lines don't touch), the whole cell with its zhuyin (trimmed top and bottom)].
  const TINT_CSS = {
    box: ['background:var(--zyt)', 'background:linear-gradient(transparent 10%,var(--zyt) 10%,var(--zyt) 90%,transparent 90%);border-radius:.18em'],
    marker: ['background:linear-gradient(transparent 50%,var(--zyt) 50%,var(--zyt) 92%,transparent 92%);border-radius:0',
      'background:linear-gradient(transparent 55%,var(--zyt) 55%,var(--zyt) 85%,transparent 85%)'],
    ink: ['color:var(--zyt)', 'color:var(--zyt)'],
    under: ['background:linear-gradient(transparent 86%,var(--zyt) 86%);border-radius:0', 'box-shadow:inset 0 -.14em 0 var(--zyt)'],
  };
  // [name, (hash) → [OKLCH lightness, chroma, hue] on a light page]. One hash bit varies the lightness, so
  // neighbouring hues still differ. Colour-blind safe: the 8 Okabe–Ito colours, so they repeat.
  const OKABE_ITO = [[.74, .15, 70], [.76, .1, 230], [.62, .12, 165], [.92, .15, 105], [.5, .13, 250], [.62, .18, 40], [.7, .12, 340], [.7, 0, 0]];
  const PALETTES = {
    pastel: ['Pastel', (h) => [.87 + ((h >>> 9) & 1) * .04, .085, h % 360]],
    vivid: ['Vivid', (h) => [.76 + ((h >>> 9) & 1) * .05, .16, h % 360]],
    earth: ['Earth', (h) => [.8 + ((h >>> 9) & 1) * .05, .065, 30 + h % 110]],
    ocean: ['Ocean', (h) => [.82 + ((h >>> 9) & 3) * .025, .09, 175 + h % 95]],
    forest: ['Forest', (h) => [.82 + ((h >>> 9) & 3) * .025, .09, 95 + h % 75]],
    sunset: ['Sunset', (h) => [.84 + ((h >>> 9) & 1) * .04, .11, (330 + h % 100) % 360]],
    berry: ['Berry', (h) => [.83 + ((h >>> 9) & 1) * .05, .11, 290 + h % 80]],
    mono: ['Mono', (h) => [.72 + (h % 8) * .03, .09, 255]],
    cb: ['Colour-blind safe', (h) => OKABE_ITO[h % 8]],
  };
  const fnv = (s) => { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(s)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  // A dark page (light text) gets darker, stronger tints; coloured text gets a lightness that stays readable.
  // Cached per character until a tint setting changes (refreshTints clears it): a page has thousands of cells.
  const colours = new Map();
  function tintColour(ch, dark, under = false) {
    const key = ch + (dark ? 'd' : '') + (under ? 'u' : '');
    let col = colours.get(key);
    if (!col) colours.set(key, (col = tintRgb(ch, dark, under)));
    return col;
  }
  function tintRgb(ch, dark, under) {
    let [L, C, H] = (PALETTES[CFG.tintPalette] ?? PALETTES.pastel)[1](fnv(ch)), a = CFG.tintStrength / 100;
    if (under || CFG.tintStyle === 'ink') { L = dark ? .78 : .52; C = Math.max(C, .12); a = 1; }
    else if (dark) { L = Math.max(.32, L - .42); C *= .9; a = Math.min(1, a * 1.6); }
    return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H} / ${a.toFixed(2)})`;
  }
  // The N most common characters, by their counts summed over the zhuyin dictionary's words.
  let TOP = null;
  function topChars() {
    if (TOP) return TOP;
    const D = loadDict(), n = new Map(), add = (c, k) => n.set(c, (n.get(c) || 0) + k);
    for (const w in D.w) for (const c of w) add(c, D.w[w][1] || 0);
    for (const c in D.c) add(c, D.c[c][1] || 0);
    return (TOP = [...n].filter(([c]) => HAN.test(c)).sort((a, b) => b[1] - a[1]).slice(0, 1000).map(x => x[0]));
  }
  let tints = null, pageDark = false;   // character → 't' | 'm'
  function tintSet() {
    if (tints) return tints;
    tints = new Map();
    if (CFG.tintTop > 0) for (const c of topChars().slice(0, CFG.tintTop)) tints.set(c, 't');
    if (CFG.tintMine) for (const c of CFG.myChars) tints.set(c, 'm');
    return tints;
  }
  // Light text on the body = a dark page. Its background is less reliable: often transparent, set on a wrapper.
  function isDarkPage() {
    const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(getComputedStyle(document.body || document.documentElement).color);
    return !!m && (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.6;
  }
  // Mark one element as tinted ('t', or 'm' for My characters), or unmark it (t falsy). dark: colours for a dark background.
  // Writes only what changed: each write restyles the cell, and a refresh visits every cell on the page.
  function paint(e, ch, t, dark) {
    if (!t) { if (e.hasAttribute('data-t')) { e.removeAttribute('data-t'); e.style.removeProperty('--zyt'); e.style.removeProperty('--zyu'); } return; }
    const set = (k, v) => { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); };
    if (e.getAttribute('data-t') !== t) e.setAttribute('data-t', t);
    set('--zyt', tintColour(ch, dark));
    if (t === 'm') set('--zyu', tintColour(ch, dark, true)); else if (e.style.getPropertyValue('--zyu')) e.style.removeProperty('--zyu');
  }
  // A page cell, or a character in the popups (dark: the popup's theme).
  const tintCell = (e, ch, dark = pageDark) => paint(e, ch, tintSet().get(ch), dark);
  const popDark = () => CFG.theme === 'dark' || (CFG.theme === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  const tintClass = () => {
    const root = document.documentElement.classList;
    for (const s of ['box', 'marker', 'ink', 'under']) root.toggle('zyh-t-' + s, CFG.tintStyle === s);
    root.toggle('zyh-tc', CFG.tintCovers === 'char');
  };
  // After a tint setting changes (or while one is previewed): every cell on the page, and the settings sample.
  let refreshQ = 0;
  function refreshTints() {
    cancelAnimationFrame(refreshQ); refreshQ = 0;
    tints = null; colours.clear(); pageDark = isDarkPage();
    tintClass();
    if (active) for (const c of document.querySelectorAll('zy-c')) tintCell(c, c.firstChild?.textContent ?? '');
    if (pop) { pop.hostEl.dataset.ts = CFG.tintStyle; const pv = pop.set.querySelector('.pv'); if (pv) paintSample(pv); }
  }
  // Once per frame at most: sweeping the pointer across the settings leaves one button and enters the next in one frame.
  const refreshSoon = () => { refreshQ ||= requestAnimationFrame(refreshTints); };

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
        const cc = document.createElement('zy-c'), h = document.createElement('zy-h');   // zy-h: the glyph alone, for "tint covers: character"
        h.textContent = ch; cc.appendChild(h); tintCell(cc, ch);
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
    // Called because the timeout ran out (the page is never idle), timeRemaining() is 0: take a slice anyway,
    // or nothing would ever get done.
    const budget = () => Math.min(deadline.didTimeout ? CFG.sliceMs : deadline.timeRemaining(), CFG.sliceMs - (performance.now() - t0)) > 1;
    observer?.disconnect();
    try {
      // Batched so layout is read twice per slice, not once per node: gather → measure → write → measure.
      const batch = [];
      while ((pending.length || queue.length) && budget() && batch.length < 300) {
        if (!pending.length) { collectTextNodes(queue.shift(), pending); continue; }
        const n = pending.shift(), pe = n.parentElement;
        if (!n.isConnected || !pe) continue;
        if (CFG.lazy && !nearEls.has(pe)) watch(pe); else batch.push(n);
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

  // ---- long pages: only text near the screen is annotated ----
  // A book annotated whole is 150k+ elements, and every scroll, tint change and settings preview pays for all of them.
  // So a text node waits until its parent element comes within nearScreens of the viewport, and goes back to plain
  // text once it's farScreens away. The distance is also measured from the element's box, as the observers report an
  // element clipped by a scrolling box as off screen however close it is. A hidden element (a zero box) counts as near:
  // annotated up front as before, so a menu doesn't reflow as it opens.
  let nearEls = new WeakSet(), nearIO = null, farIO = null;
  const screensAway = (r) => Math.max(0, r.top - innerHeight, -r.bottom) / innerHeight;
  function watch(el) {
    nearIO ??= new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.target.isConnected) { nearIO.unobserve(e.target); farIO.unobserve(e.target); }
        else if (e.isIntersecting || screensAway(e.boundingClientRect) < CFG.nearScreens) { if (!nearEls.has(e.target)) { nearEls.add(e.target); enqueue(e.target); } }
        else nearEls.delete(e.target);
      }
    }, { rootMargin: `${CFG.nearScreens * 100}% 0px` });
    farIO ??= new IntersectionObserver((es) => {
      const far = es.filter(e => !e.isIntersecting && e.target.isConnected && screensAway(e.boundingClientRect) >= CFG.farScreens);
      if (!far.length) return;
      observer?.disconnect();
      const sel = getSelection(), keep = sel.isCollapsed ? () => false : (r) => sel.containsNode(r, true);   // a selection stays whole
      for (const { target } of far) {
        nearEls.delete(target);
        for (const r of target.querySelectorAll('zy-run')) if (!keep(r)) r.replaceWith(r.dataset.src);
      }
      observe();
    }, { rootMargin: `${CFG.farScreens * 100}% 0px` });
    nearIO.observe(el); farIO.observe(el);
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
    pageDark = isDarkPage();
    injectCss();
    enqueue(document.body);
    whatsNew();
    checkUpdate();
  }
  function stop() {
    active = false;
    observer?.disconnect(); observer = null;
    nearIO?.disconnect(); farIO?.disconnect(); nearIO = farIO = null; nearEls = new WeakSet();
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

  // ---------------------------------------------------------------- character parts
  // components.tsv.gz, built by tools/components from Make Me a Hanzi, CJKVI-IDS and Wiktionary (GPL-3.0-or-later,
  // see data/). One line per character: char, parts ("女s 馬p": s meaning, p sound, f shape), type, gloss, hint,
  // origin, src, older parts (Wiktionary's, when today's glyph doesn't show them: 年 "禾s 人p"). Loaded like
  // CC-CEDICT: an @resource, read the first time a card wants it.
  const COMPS_URL = 'https://cdn.jsdelivr.net/gh/ashirviskas/zhuyin-anywhere@main/data/components.tsv.gz';
  let COMPS = null, compsP = null;
  const SOUND_IN = new Map();   // part → characters it gives the sound to
  function loadComps() {
    return compsP ??= (async () => {
      let buf = null;
      try { const url = GM_getResourceURL('comps'); if (url) { const r = await fetch(url); if (r.ok) buf = await r.arrayBuffer(); } }
      catch (e) { log('components @resource unavailable, downloading', e); }
      buf ??= await gmFetch({ method: 'GET', url: COMPS_URL, responseType: 'arraybuffer', timeout: 60000 });
      const map = new Map();
      for (const line of (await gunzipMaybe(buf)).split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const [ch, parts, type, gloss, hint, origin, , from] = line.split('\t');
        const split = (f) => (f ? f.split(' ').map(x => [x.slice(0, -1), x.at(-1)]) : []), ps = split(parts);
        map.set(ch, { parts: ps, type, gloss, hint, origin, from: split(from) });
        for (const [pc, role] of ps) if (role === 'p') { const a = SOUND_IN.get(pc); a ? a.push(ch) : SOUND_IN.set(pc, [ch]); }
      }
      if (map.size < 1000) throw new Error('character parts download looks truncated');
      return (COMPS = map);
    })().catch((e) => { compsP = null; throw e; });
  }
  const UNENCODED = /^[？?①-⑳]$/;
  const FORMS = { psc: ['形聲', 'meaning + sound'], ic: ['會意', 'idea from parts'], pic: ['象形', 'picture'], ind: ['指事', 'pointer'], loan: ['假借', 'borrowed for its sound'] };

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
  const google = async (text, lang, sl = 'zh-TW') => {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + sl + '&tl=' + encodeURIComponent(lang) +
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
  // sl 'en': English part meanings (飠 "food"), hints and origins for "Translate explanations".
  async function translateWords(words, lang, sl = 'zh-TW') {
    const from = sl === 'zh-TW' ? '' : sl + '>';
    const mk = (w) => 'google|' + from + lang + '|' + w, dk = (w) => 'tr|' + from + lang + '|' + w;
    const out = await Promise.all(words.map(async (w) => tCache.get(mk(w)) ?? cacheGet(dk(w))));
    const miss = words.filter((w, i) => out[i] === undefined);
    if (miss.length) {
      const lines = (await google(miss.join('\n'), lang, sl)).split('\n').map(l => l.trim());
      const got = lines.length === miss.length ? lines : await Promise.all(miss.map(w => google(w, lang, sl)));
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
    .seg button.on{color:#fff;background:#1a5fb4}.set select,.set input{background:rgba(0,0,0,.06);color:#222}
    .k{color:#8a6100;background:rgba(200,150,0,.13)}.r.sem{color:#1e7e34;background:rgba(30,126,52,.1)}.r.pho{color:#1a5fb4;background:rgba(26,95,180,.1)}
    .org a,.news a,.org.old .go:hover{color:#1a5fb4}.pal.on{outline-color:#1a5fb4}.gl .mk.on{color:#b07d00}.tabs button.on{background:rgba(26,95,180,.15)}.gl .cfg,.gl .mk,.tabs button{background:none}`
    .replace(/([^{}]+)\{/g, (_, sel) => sel.split(',').map(x => host + ' ' + x.trim()).join(',') + '{');
  // "Popup size": every px in the popups' CSS is a multiple of --zs, set on the host. Not CSS zoom: a zoomed box
  // scales its own left/top and vw, so placing it on screen would need the zoom undone in every measurement.
  const scalePx = (css) => css.replace(/(-?\d*\.?\d+)px/g, 'calc($1px * var(--zs))');
  const popScale = (h) => h.style.setProperty('--zs', CFG.popupScale / 100);
  let pop = null;
  function popup() {
    if (pop) return pop;
    const hostEl = document.createElement('div'); hostEl.id = 'zyh-host';
    hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0';
    hostEl.dataset.theme = CFG.theme; hostEl.dataset.ts = CFG.tintStyle; popScale(hostEl);
    const sh = hostEl.attachShadow({ mode: 'closed' });
    // Built with DOM calls and a <style> element, not innerHTML: pages that enforce Trusted Types block
    // innerHTML (also on a shadow root), and the popup would never appear there.
    const css = el('style'); css.textContent = scalePx(`
      svg{width:14px;height:14px}
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
      .wl{display:grid;grid-template-columns:auto auto auto 1fr auto;gap:1px 8px;align-items:baseline}
      .wl .go{align-self:center;padding:0 7px;font-size:15px;line-height:1.3;opacity:.7}.wl .go:hover{opacity:1}
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
      .set{width:min(380px,calc(100vw - 24px));max-width:none;box-sizing:border-box;max-height:calc(100vh - 16px);overflow:auto;font-size:13px}
      .tr,.gl{overflow:hidden auto}
      .set .ttl{display:flex;align-items:center;font-weight:600;margin-bottom:8px}
      .set .ttl span{flex:1}
      .set .row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:4px 0}
      .set .row+.row{border-top:1px solid rgba(127,127,127,.15)}
      .set .hint{grid-column:1/-1;font-size:11px;opacity:.55;margin-top:-2px}
      .seg{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:2px}
      .seg button.on{color:#111;background:#8ab4f8}
      .set select,.set input{font:inherit;font-size:12px;color:#ddd;background:rgba(255,255,255,.08);border:0;border-radius:6px;padding:3px 6px}
      .set input{width:5em}
      .news{right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));box-sizing:border-box;font-size:13px}
      .news .ttl{font-weight:600;margin-bottom:4px}.news p{margin:0 0 8px;opacity:.85}.news .bar{margin-top:0}
      .tabs{display:flex;gap:2px;margin:0 0 8px;padding:2px;border-radius:8px;background:rgba(127,127,127,.12)}
      .tabs button{flex:1;text-align:center;background:none;padding:4px 0}
      .tabs button.on{background:rgba(138,180,248,.25)}
      .sec{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.55;margin:10px 0 0}
      .sec+.row{border-top:0}
      .set .full{grid-column:1/-1}
      .sld{display:inline-flex;align-items:center;gap:8px}.set .sld input{width:130px;padding:0;accent-color:#8ab4f8;background:none}
      .sld b{font-weight:400;font-size:12px;opacity:.8;min-width:4.5em}
      .pals{display:grid;grid-template-columns:repeat(2,auto);gap:3px}
      .pal{display:flex;align-items:center;gap:6px;padding:3px 6px}
      .pal.on{outline:1px solid #8ab4f8;background:rgba(138,180,248,.15)}
      .sws{display:inline-flex}.sws i{width:6px;height:13px;display:block}
      .pv{font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:19px;letter-spacing:2px;padding:2px 0}
      .mine .chips{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px}
      .chip{display:inline-flex;align-items:center;font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:16px;background:rgba(127,127,127,.12);border-radius:6px;padding:1px 2px 1px 4px}
      .chip b{font-weight:400}.chip button{background:none;padding:0 4px;opacity:.6}
      .mtools{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.set .mtools input{flex:1;min-width:120px;width:auto}
      button:disabled{opacity:.4;cursor:default}
      :host([data-ts=box]) [data-t]{background:var(--zyt);border-radius:.18em;box-shadow:.05em 0 0 var(--zyt),-.05em 0 0 var(--zyt)}
      :host([data-ts=marker]) [data-t]{background:linear-gradient(transparent 52%,var(--zyt) 52%,var(--zyt) 92%,transparent 92%)}
      :host([data-ts=ink]) [data-t]{color:var(--zyt)}
      :host([data-ts=under]) [data-t]{box-shadow:inset 0 -.14em 0 var(--zyt)}
      [data-t=m]{text-decoration:underline .1em var(--zyu);text-underline-offset:.18em}
      .gl .mk{position:absolute;top:6px;right:30px;background:none;opacity:.45;display:inline-flex;padding:2px 5px}
      .gl .mk:hover{opacity:1}.gl .mk.on{opacity:1;color:#fdd663}
      .gl .hw.hasmk{padding-right:48px}
      .crumb{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:14px;margin:-2px 0 6px;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .crumb button{padding:0 6px}.crumb .cur{opacity:.6}
      .comp{margin-top:8px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25);font-size:13px}
      .how{display:flex;gap:8px;align-items:baseline;margin-bottom:3px}.how .h{opacity:.75}
      .k{font-size:11px;padding:0 5px;border-radius:4px;background:rgba(253,214,99,.15);color:#fdd663;font-family:"Noto Sans TC","PingFang TC",sans-serif;white-space:nowrap}
      .cr{display:grid;grid-template-columns:auto 1fr auto 12px;gap:10px;align-items:center;padding:1px 6px;margin:0 -6px;border-radius:6px}
      .cr.go,.part.go{cursor:pointer}.cr.go:hover,.part.go:hover{background:rgba(138,180,248,.13);opacity:1}
      .cr .g{font-family:"Noto Sans TC","PingFang TC",sans-serif;font-size:21px;line-height:1.3}
      .cr .g .zz{font-size:.5em}
      .r{font-size:11px;padding:0 5px;border-radius:4px;white-space:nowrap}
      .r.sem{background:rgba(129,201,149,.15);color:#81c995}.r.pho{background:rgba(138,180,248,.17);color:#8ab4f8}
      .arr{opacity:.45;font-size:16px;line-height:1}
      .org{font-size:12px;opacity:.7;margin-top:5px;line-height:1.45;white-space:pre-line}.org b{font-weight:600}
      .org a,.news a{color:#8ab4f8;text-decoration:none}.org.ot{margin-top:2px}.org.ot:empty{display:none}
      .org.old{opacity:.85;white-space:normal}.org.old .zc{font-size:16px;font-family:"Noto Sans TC","PingFang TC",sans-serif}.org.old .go{cursor:pointer}.org.old .go:hover{color:#8ab4f8}
      .ser{font-size:12px;margin-top:4px;opacity:.85}.ser .zc{font-size:16px;margin-right:6px;cursor:pointer;font-family:"Noto Sans TC","PingFang TC",sans-serif}
      .parts .part.go{display:grid;grid-template-columns:auto 1fr 12px;align-items:baseline}
      @media (prefers-color-scheme: light){${LIGHT(':host([data-theme=auto])')}}
      ${LIGHT(':host([data-theme=light])')}
    `);
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
    sh.append(css, tr, el('div', 'box gl'), el('div', 'box set'), el('div', 'box news'));
    document.documentElement.appendChild(hostEl);
    const $ = (s) => sh.querySelector(s);
    pop = { hostEl, box: $('.tr'), gl: $('.gl'), set: $('.set'), src: $('.src'), py: $('.py'), tx: $('.tx'), via: $('.via'), words: $('.words'), say: $('.say'), cfg: $('.cfg'), news: $('.news') };
    $('.x').onclick = hidePopup;
    $('.cp').onclick = () => GM_setClipboard([...pop.tx.querySelectorAll('.t')].map(t => t.textContent).join('\n'));
    pop.say.onclick = () => speak(pop.text, pop.say);
    pop.cfg.onclick = () => openSettings(pop.box.getBoundingClientRect());
    for (const b of [pop.box, pop.gl, pop.set, pop.news]) b.addEventListener('mousedown', (e) => e.stopPropagation());
    // Holding the pointer on a blurred meaning reveals it too: touch has no reveal key.
    sh.addEventListener('pointerdown', (e) => { if (e.target.closest('.m')) { revealPtr = true; reveal(); } });
    addEventListener('pointerup', () => { if (revealPtr) { revealPtr = false; reveal(); } }, true);
    addEventListener('pointercancel', () => { if (revealPtr) { revealPtr = false; reveal(); } }, true);
    reveal();
    return pop;
  }
  function hidePopup() { if (pop) { pop.box.style.display = 'none'; if (playing && pop.box.contains(playing.btn)) stopSpeaking(); } }
  // Popup Chinese with each character's zhuyin beside it ('beside'), drawn like on the page. zys: one per char; null or '?' = none.
  // One character in a popup, tinted like on the page.
  const glyph = (ch, cls = null) => { const g = el('span', cls, ch); if (HAN.test(ch)) tintCell(g, ch, popDark()); return g; };
  function zyChars(chars, zys) {
    const f = document.createDocumentFragment();
    chars.forEach((ch, i) => {
      const z = zys?.[i];
      if (!z || z === '?') { f.append(glyph(ch)); return; }
      const c = el('span', 'zc'), zz = el('span', 'zz'); zz.append(...zhuyinParts(normZhuyin(z))); c.append(glyph(ch), zz); f.append(c);
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
  // A double tap of the reveal key, with a card or popup open, switches Hide meaning itself. A tap is a short press
  // and release with no other key between: not Shift, Shift+A (typing a capital), nor a hold to read, then a tap.
  let revealKeyDown = false, revealPtr = false, revealTap = 0, revealAt = 0;   // revealAt: when a clean press began
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
  // Where a box opens depends only on where its anchor is on screen, never on what the box holds right now: in the
  // upper half it opens below, in the lower half above, with the edge facing the anchor pinned (top or bottom), and
  // never taller than the room on that side (it scrolls). Its left edge is the anchor's, moved left only as far as the
  // box's widest possible size needs. So a box that grows as text arrives, or a smaller card opened from a bigger
  // one, stays where the pointer is.
  // The settings panel is the exception: always as tall as its tab (up to the window), in a free spot next to
  // the box whose ⚙ opened it. Capped to the room beside a big word card it was a few lines tall.
  function place(rect, b = pop.box) {
    const st = b.style, m = 8, px = (v) => Math.round(v) + 'px';
    const g = b === pop.box ? m : 2;   // hover card hugs its word: less way to travel, fewer words to cross
    const box = pop.box.style.display === 'block';
    st.display = 'block'; b.zyRect = rect;
    if (b === pop.set || (b !== pop.box && box)) {   // a free spot around the anchor, clear of an open translation popup
      Object.assign(st, { left: '0px', top: '0px', right: 'auto', bottom: 'auto', maxHeight: '' });
      const w = b.offsetWidth, h = b.offsetHeight, t = box ? pop.box.getBoundingClientRect() : null;
      const x = Math.min(Math.max(m, rect.left), innerWidth - w - m), y = Math.min(Math.max(m, rect.top), innerHeight - h - m);
      const ok = ([sx, sy]) => sx >= m && sx + w <= innerWidth - m && sy >= m && sy + h <= innerHeight - m &&
        (!t || sx >= t.right + m / 2 || sx + w <= t.left - m / 2 || sy >= t.bottom + m / 2 || sy + h <= t.top - m / 2);
      const spot = [[x, rect.bottom + g], [x, rect.top - h - g], ...(t ? [[t.right + m, y], [t.left - w - m, y], [x, t.bottom + m], [x, t.top - h - m]] : [])].find(ok) ?? [x, y];
      st.left = px(spot[0]); st.top = px(spot[1]);
      return;
    }
    const cs = getComputedStyle(b), sum = (...ks) => ks.reduce((a, k) => a + parseFloat(cs[k]), 0);
    const content = cs.boxSizing !== 'border-box';   // the popups' max-width/max-height leave out padding and border
    const edges = content ? sum('paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth') : 0;
    const widest = parseFloat(cs.maxWidth) + (content ? sum('paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth') : 0) || b.offsetWidth;
    const down = rect.top + rect.bottom < innerHeight;
    Object.assign(st, down ? { top: px(rect.bottom + g), bottom: 'auto', maxHeight: px(innerHeight - rect.bottom - g - m - edges) }
      : { top: 'auto', bottom: px(innerHeight - rect.top + g), maxHeight: px(rect.top - g - m - edges) });
    Object.assign(st, { left: px(Math.max(m, Math.min(rect.left, innerWidth - widest - m))), right: 'auto' });
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
      const go = el('button', 'go', '›'); go.title = 'Open ' + word; go.onclick = () => openWord(w.chars.slice(a, b), zys);
      grid.append(sayBtn(word), h, el('span', 'p', beside ? '' : !CFG.pinyin ? (zys ? zys.map(normZhuyin).join(' ') : '')
        : zys ? zys.map(zhuyinToPinyin).join('') : (e ? numToMarked(e.num).replace(/ /g, '') : '')), d, go);
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
    }, Math.max(CFG.glossHideDelay, keepUntil - performance.now()));
  }
  // A card opened from a card (a part, a character row, the crumb) can be smaller than the one clicked, leaving the
  // pointer outside it: it gets glossKeep ms to reach it before the card hides.
  let keepUntil = 0;
  const openFromCard = (c) => { keepUntil = performance.now() + CFG.glossKeep; renderCard(c); };

  // The parts section of a one-character card: how it was formed, each part with its zhuyin, meaning and role
  // (click to open its card), the hint, the origin, and the characters it gives its sound to. False if there's
  // nothing to show.
  function fillParts(box, ch, z, stale) {
    const e = COMPS.get(ch), D = loadDict();
    const sounds = (SOUND_IN.get(ch) ?? []).filter(c => D.c[c]);
    if (!e && !sounds.length) return false;
    const reading = (c) => D.c[c]?.[0][0];
    const form = e?.type?.startsWith('var:') ? ['異體', 'variant of ' + e.type.slice(4)] : FORMS[e?.type];
    // A meaning + sound (or idea) character whose parts today's glyph doesn't show: say so rather than promise rows.
    const lost = (e?.type === 'psc' || e?.type === 'ic') && !e.parts.some(([, r]) => r === 's' || r === 'p');
    if (form) {
      const how = el('div', 'how'); how.append(el('span', 'k', form[0]), el('span', 'h', form[1] + (lost ? ' · no longer visible in today’s form' : '')));
      box.append(how);
    }
    const glosses = [], notes = [];   // [English text, its element] for "Translate explanations": part meanings, hint and origin
    const counts = new Map();
    for (const [pc, role] of e?.parts ?? []) { const k = pc + role; counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [k, n] of counts) {
      const pc = k.slice(0, -1), role = k.at(-1), pz = reading(pc), pe = COMPS.get(pc);
      const meaning = pe?.gloss || (CEDICT && shortDef(lookup(pc, null)[0] ?? { defs: [] }, false)) || '';
      const row = el('div', 'cr'), g = el('span', 'g'), m = el('span', 'm', meaning + (n > 1 ? ' ×' + n : ''));
      g.append(zyChars([pc], pz ? [pz] : null));
      let r = el('span');
      if (role === 's') r = el('span', 'r sem', 'meaning');
      else if (role === 'p') r = el('span', 'r pho', 'sound ' + (pz ? normZhuyin(pz) + (z && pz !== z ? ' → ' + normZhuyin(z) : '') : ''));
      row.append(g, m, r, el('span', 'arr', ''));
      if (pe && !UNENCODED.test(pc)) { row.classList.add('go'); row.lastChild.textContent = '›'; row.title = 'Open ' + pc; row.onclick = () => openChar(pc); }
      if (meaning) glosses.push([meaning, m]);
      box.append(row);
    }
    // Wiktionary's parts when the glyph has changed since (年: 禾 meaning + 人 sound), each clickable.
    if (e?.from.length) {
      const o = el('div', 'org old'); o.append(el('b', null, 'Older parts'), ' · ');
      e.from.forEach(([pc, role], i) => {
        if (i) o.append(' + ');
        const g = el('span', 'zc', pc);
        if (COMPS.get(pc) && !UNENCODED.test(pc)) { g.classList.add('go'); g.title = 'Open ' + pc; g.onclick = () => openChar(pc); }
        o.append(g);
        if (role === 's' || role === 'p') o.append(' ', el('span', 'r ' + (role === 's' ? 'sem' : 'pho'), role === 's' ? 'meaning' : 'sound'));
      });
      box.append(o);
    }
    // Make Me a Hanzi's hint, when it says more than the meaning part's name ("woman"); it's a memory aid, not history.
    if (e?.hint && e.hint.includes(' ')) { const h = el('div', 'org m'); h.append(el('b', null, 'Hint'), ' · ' + e.hint); box.append(h); notes.push([e.hint, h]); }
    if (e?.origin) {
      const o = el('div', 'org m'), a = el('a', null, 'Wiktionary ↗');
      a.href = 'https://en.wiktionary.org/wiki/' + encodeURIComponent(ch); a.target = '_blank'; a.rel = 'noopener';
      o.append(el('b', null, 'Origin'), ' · ' + e.origin.replaceAll(' ¶ ', '\n') + ' ', a); box.append(o); notes.push([e.origin, o]);
    }
    if (sounds.length) {   // most common first
      const rank = (c) => { const i = (TOP ?? topChars()).indexOf(c); return i < 0 ? 1e4 : i; };
      const ser = el('div', 'ser'); ser.append('Sound part in: ');
      for (const c of sounds.sort((a, b) => rank(a) - rank(b)).slice(0, 8)) {
        const s = el('span', 'zc'); s.append(zyChars([c], reading(c) ? [reading(c)] : null)); s.title = 'Open ' + c; s.onclick = () => openChar(c);
        ser.append(s);
      }
      box.append(ser);
    }
    // The English also in the target language(s): part meanings after the English, the hint and origin
    // under theirs, one line per language, in the order of the languages whichever answers first.
    const ls = langs().filter(l => l !== 'en'), texts = [...glosses, ...notes].map(x => x[0]);
    if (CFG.partsLang && ls.length && texts.length) {
      const slots = notes.map(() => ls.map(() => el('div', 'org ot')));
      slots.forEach((ds, i) => notes[i][1].after(...ds));
      ls.forEach((l, li) => translateWords(texts, l, 'en').then((out) => {
        if (stale()) return;
        glosses.forEach(([, m], i) => { if (out[i]) m.append(el('span', 'tp', ' · ' + out[i])); });
        slots.forEach((ds, i) => {
          const t = out[glosses.length + i];
          if (t) ds[li].append(el('span', 'lg', l.toUpperCase()), t.replace(/\s*¶\s*/g, '\n'));
        });
      }).catch(() => {}));
    }
    return true;
  }
  // The highlighter on a one-character card.
  function mkIcon() {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 16 16', width: 14, height: 14, fill: 'currentColor', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of ['M10.5 1.5l4 4-7 7H3.5v-4z', 'M2 14.6h12v1.2H2z']) { const pa = document.createElementNS(NS, 'path'); pa.setAttribute('d', d); svg.append(pa); }
    return svg;
  }

  // Meaning-only card: the word's senses for the reading shown on the page, then what the hovered
  // character means on its own, for each target language: CC-CEDICT for English, Google for the others
  // (CC-CEDICT still decides where the word ends). No pinyin — the zhuyin is already on the page.
  let glossReq = 0;
  async function showGloss(w, cc = null) {
    const p = popup();
    glossWord = w; glossChar = cc;
    let cells = [...w.querySelectorAll('zy-c')];
    let chars = cells.map(c => c.firstChild?.textContent ?? '');
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
    tint(cells);
    const rs = cells.map(c => c.getBoundingClientRect());
    const rect = { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) };
    renderCard({ chars, zys: known ? zys : null, hi, alts: chars.length === 1 ? w.dataset.alts : null, rect, trail: [] });
  }

  // The card on screen, kept so a click on a part, the crumb or the highlighter can draw it again. `trail`:
  // the cards opened before it by clicking a part or a character, shown as a crumb (媽 › 馬) to go back.
  let card = null;
  const rerenderCard = () => { if (card && shown('gl')) renderCard(card); };
  // A word of the translation popup's list, opened with its ›: its card takes the popup's place, under the selection,
  // with the sentence first in the crumb to go back. Like the popup it stays until a click elsewhere (pinned).
  function openWord(chars, zys) {
    const text = pop.text;
    hidePopup(); hideGloss(); glossWord = pop.box;
    renderCard({ chars, zys, hi: -1, alts: null, rect: selRect, trail: [{ sentence: text, chars: [text.length > 6 ? text.slice(0, 5) + '…' : text] }] });
  }
  const pinned = () => shown('box') || (shown('gl') && !!card?.trail[0]?.sentence);
  // A crumb entry: a card, or the sentence the cards were opened from.
  const goBack = (t, trail) => (t.sentence ? showTranslation(t.sentence, selRect) : openFromCard({ ...t, trail }));
  // A character's own card, opened from a part or a character row of the open card.
  function openChar(ch) {
    const z = loadDict().c[ch]?.[0][0];
    openFromCard({ chars: [ch], zys: z ? [z] : null, hi: -1, alts: null, rect: card.rect, trail: [...card.trail, card] });
  }
  async function renderCard(c) {
    const p = popup(), req = ++glossReq, w = glossWord;
    const stale = () => req !== glossReq || glossWord !== w;   // hidden or moved on while Google answered
    card = c;
    const { chars, zys, hi, rect, trail } = c, word = chars.join(''), known = !!zys, one = chars.length === 1;
    // Speaker first: the card opens under the word's left edge, so it's the shortest way from the word.
    const beside = known && CFG.popupZhuyin === 'beside', han = el('span', 'han');
    han.append(beside ? zyChars(chars, zys) : chars.map(ch => glyph(ch)).reduce((f, g) => (f.append(g), f), document.createDocumentFragment()));
    const hw = el('div', 'hw'); hw.append(sayBtn(word), han);
    // Larger than on the page, where it's half the text size and hard to read; also the only place it
    // shows for compact (UI) text or with "Zhuyin on page" off.
    if (known && !beside)
      hw.append(el('span', 'zy', zys.map(normZhuyin).join(' ')));
    const top = [];
    if (trail.length) {
      const cr = el('div', 'crumb'), back = el('button', null, '‹');
      back.title = 'Back'; back.onclick = () => goBack(trail.at(-1), trail.slice(0, -1));
      cr.append(back);
      trail.forEach((t, i) => {
        const b = el('button', null, t.chars.join('')); b.onclick = () => goBack(t, trail.slice(0, i));
        cr.append(b, ' › ');
      });
      cr.append(el('span', 'cur', word));
      top.push(cr);
    }
    top.push(hw, cfgBtn(() => { const r = p.gl.getBoundingClientRect(); hideGloss(); openSettings(r); }));
    if (one && HAN.test(word)) {   // highlighter: add the character to My characters, or take it out
      const mine = CFG.myChars.includes(word), mk = cfgBtn(() => toggleMine(word));
      mk.className = 'mk' + (mine ? ' on' : ''); mk.title = mine ? 'Remove from My characters' : 'Add to My characters: tinted on every page';
      mk.replaceChildren(mkIcon());
      hw.classList.add('hasmk'); top.push(mk);
    }
    p.gl.replaceChildren(...top);
    const senses = (list) => {
      // Prefer the entries whose reading matches the page; fall back to everything if none do.
      const match = list.filter(e => e.score >= 3);
      return (match.length ? match : list).slice(0, CFG.glossMaxEntries);
    };
    const ls = langs(), ents = ls.includes('en') ? senses(lookup(word, zys)) : [];
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
      // A part that isn't a word of its own (氵, 戠): the parts file's meaning, if it has one.
      const g = !ents.length && one && COMPS?.get(word)?.gloss;
      if (g) { const box = el('div', 'ent m'), list = el('span', 'defs'); list.append(langTag('en'), el('span', null, g)); box.append(list); p.gl.append(box); }
      else if (!ents.length) { const n = el('div', 'note'); n.append(langTag('en'), 'not in CC-CEDICT'); p.gl.append(n); }
    }
    // Per-character meanings for compounds, one per language; the character under the cursor is highlighted.
    // When CEDICT reads the word with a neutral tone the IME dictionary doesn't have (長得 zhang3 de5 vs
    // ㄓㄤˇ ㄉㄜˊ), the character is looked up with CEDICT's syllable, so 得 is the particle, not "obtain".
    // With parts on, a row opens that character's card.
    if (chars.length > 1 && chars.length <= 8) {
      const parts = el('div', 'parts');
      const wordSyl = ents[0] && ents[0].score >= 1 ? numKey(ents[0].num).split(' ') : null;
      chars.forEach((ch, i) => {
        const row = el('div', 'part' + (i === hi ? ' on' : '')), b = el('b');
        b.append(glyph(ch)); row.append(b);
        const ms = el('span');
        for (const l of ls) {
          if (l === 'en') {
            const pageKey = known ? zyKey([zys[i]]) : null, ceKey = wordSyl?.[i];
            const useCe = ceKey && pageKey && ceKey !== pageKey && ceKey.endsWith('5') && toneless(ceKey) === toneless(pageKey);
            const x = senses(lookupKey(ch, useCe ? ceKey : pageKey))[0];
            ms.append(el('span', 'm', x ? shortDef(x, false) : '—'));
          } else {
            const c = el('span', 'm', '…'); ms.append(c);
            const g = goog.get(l); g[0].push(ch); g[1].push(c);
          }
        }
        row.append(ms);
        if (CFG.parts && HAN.test(ch)) {
          row.classList.add('go'); row.title = 'Open ' + ch; row.append(el('span', 'arr', '›'));
          row.onclick = () => openFromCard({ chars: [ch], zys: known ? [zys[i]] : null, hi: -1, alts: null, rect, trail: [...trail, c] });
        }
        parts.append(row);
      });
      p.gl.append(parts);
    }
    if (c.alts) p.gl.append(el('div', 'note', 'other readings: ' + c.alts.split(' ').map(normZhuyin).join(' / ')));
    let partsBox = null;
    if (CFG.parts && one && HAN.test(word)) { partsBox = el('div', 'comp'); p.gl.append(partsBox); }
    const foot = el('div', 'foot', [ls.includes('en') && 'CC-CEDICT · MDBG', goog.size && 'Google'].filter(Boolean).join(' · ') + holdHint());
    p.gl.append(foot);
    place(rect, p.gl);
    if (partsBox) {
      try { await loadComps(); } catch (e) { partsBox.replaceWith(el('div', 'note', 'Character parts unavailable: ' + e.message)); place(rect, p.gl); }
      if (stale()) return;
      if (COMPS && fillParts(partsBox, word, zys?.[0], stale)) foot.prepend('Make Me a Hanzi · CJKVI-IDS · Wiktionary · ');
      else partsBox.remove();
      place(rect, p.gl);
    }
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
    if (pinned()) { hoverWord = null; return; }   // the translation, or a card from it, is open: the page behind it stays quiet
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
  addEventListener('scroll', () => { if (!pinned()) hideGloss(); }, { capture: true, passive: true });

  document.addEventListener('mouseup', (e) => {
    if (pointer === 'touch' || (pop && e.composedPath().includes(pop.hostEl))) return;
    if (!CFG.autoTranslate || siteMode() === 'off') return;
    clearTimeout(selTimer); selTimer = setTimeout(() => translateSelection(false), 180);
  }, true);
  document.addEventListener('mousedown', (e) => { if (!pop || !e.composedPath().includes(pop.hostEl)) { hidePopup(); hideGloss(); hideSettings(); } }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key === CFG.revealKey && revealKeyDown) { revealKeyDown = false; reveal(); }
    if (e.key === CFG.revealKey) {
      const now = performance.now(), tap = revealAt && now - revealAt < 300;
      const dbl = tap && now - revealTap < 400 && (shown('gl') || shown('box')) && !typing(e);
      revealTap = tap && !dbl ? now : 0; revealAt = 0;
      if (dbl) setCfg(SETTINGS.find(r => r.k === 'hideMeaning'), !CFG.hideMeaning);
    }
    // Alt alone toggles Firefox's menu bar on release: keep it shut when the Alt press was ours.
    if (e.key === 'Alt' && ((CFG.gloss === 'alt' && hoverWord) || (CFG.hideMeaning && CFG.revealKey === 'Alt' && (shown('box') || shown('gl'))))) e.preventDefault();
  }, true);
  addEventListener('blur', () => { if (revealKeyDown) { revealKeyDown = false; reveal(); } });   // released in another window
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hidePopup(); hideGloss(); hideSettings(); stopSpeaking(); }
    if (e.key === CFG.revealKey) { if (!e.repeat) revealAt = performance.now(); } else { revealAt = 0; revealTap = 0; }
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

  // ---------------------------------------------------------------- what's new
  // After an update that brings something to try, the first page the script runs on shows one small note,
  // once: what's new in every version since the last one seen, a link to the changelog and to the settings. Any
  // click on it, or ✕, puts it away for good.
  const VERSION = GM_info.script.version;
  const NEWS = {
    '0.9.0': 'Word cards show what a character is made of: click a part to open it. Tint the most common characters, or your own, on every page. Settings now have tabs.',
    '0.9.1': 'A character’s hint and origin come in your language too (Learn › Translate explanations).',
    '0.9.2': 'Select a sentence, then click › next to a word in its list to open that word’s card.',
    '0.9.3': 'When a character’s parts changed over time (年 was 禾 + 人), its card shows the older parts instead of misleading shapes.',
    '0.9.4': 'Long pages stay fast: zhuyin is added near the screen as you scroll. Popups can be made bigger or smaller (Popups › Popup size), and cards no longer jump: they open on the same side every time.',
    '0.9.5': 'Double-tap the reveal key (Shift) on an open card or popup to switch Hide meaning on or off. The settings panel opens full height.',
  };
  function whatsNew() {
    const seenV = GM_getValue('seenVersion', '') || '0', vs = Object.keys(NEWS).filter(v => newer(v, seenV) && !newer(v, VERSION));
    if (!vs.length) return;
    const p = popup(), seen = () => { GM_setValue('seenVersion', VERSION); p.news.style.display = 'none'; };
    const link = el('a', null, 'What’s new'), learnBtn = el('button', null, 'Open Learn settings'), x = el('button', null, '✕');
    link.href = 'https://github.com/ashirviskas/zhuyin-anywhere/blob/main/CHANGELOG.md#' + vs.at(-1).replaceAll('.', '');
    link.target = '_blank'; link.rel = 'noopener'; link.onclick = seen;
    learnBtn.onclick = () => { seen(); setTab = 'learn'; openSettings(null); };
    x.title = 'Close'; x.onclick = seen;
    const bar = el('div', 'bar'); bar.append(el('span'), link, learnBtn, x);
    p.news.replaceChildren(el('div', 'ttl', '注音 anywhere ' + VERSION), ...vs.map(v => el('p', null, NEWS[v])), bar);
    p.news.style.display = 'block';
  }

  // Update available: at most once a day, on a page the script runs on, the first KB of the script on main is read
  // for its @version. Newer → a note: Install (Violentmonkey's update page), Later (asks again tomorrow), Skip this
  // version. Violentmonkey updates by itself too; this is for when its auto-update is off or not due yet.
  const UPDATE_URL = 'https://raw.githubusercontent.com/ashirviskas/zhuyin-anywhere/main/zhuyin-anywhere.user.js';
  const newer = (a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  async function checkUpdate() {
    if (Date.now() - GM_getValue('updateCheck', 0) < 864e5) return;
    GM_setValue('updateCheck', Date.now());
    let head;
    try { head = await gmFetch({ method: 'GET', url: UPDATE_URL, headers: { Range: 'bytes=0-1023' } }); } catch (e) { log('update check failed', e); return; }
    const v = /@version\s+(\S+)/.exec(head)?.[1];
    if (!v || !newer(v, VERSION) || GM_getValue('skipVersion', '') === v || shown('news')) return;
    const p = popup(), hide = () => { p.news.style.display = 'none'; };
    const install = el('a', null, 'Install'), changes = el('a', null, 'What’s new'), later = el('button', null, 'Later'), skip = el('button', null, 'Skip this version');
    install.href = UPDATE_URL; changes.href = 'https://github.com/ashirviskas/zhuyin-anywhere/blob/main/CHANGELOG.md';
    for (const a of [install, changes]) { a.target = '_blank'; a.rel = 'noopener'; }
    install.onclick = hide; later.onclick = hide; skip.onclick = () => { GM_setValue('skipVersion', v); hide(); };
    const bar = el('div', 'bar'); bar.append(el('span'), install, changes, later, skip);
    p.news.replaceChildren(el('div', 'ttl', `注音 anywhere ${v} is out`),
      el('p', null, `You have ${VERSION}. Install opens Violentmonkey's update page for it.`), bar);
    p.news.style.display = 'block';
  }

  // ---------------------------------------------------------------- settings
  // One table drives the Violentmonkey menu and the ⚙ panel. A row stores CFG[k] under GM key `gm ?? k`
  // unless it has its own get/set; `apply` makes the change take effect on the open page.
  // Controls: `opts` (few values: buttons, cycled in the menu), `list` (a select, a prompt in the menu), `num`.
  const onOff = [[true, 'on'], [false, 'off']];
  const retranslate = () => { if (shown('box')) showTranslation(pop.text, selRect); };
  const reTint = () => { refreshTints(); rerenderCard(); };
  // One-click looks: style, covers, palette and strength together.
  const LOOKS = [
    ['Soft box', { tintStyle: 'box', tintCovers: 'char', tintPalette: 'pastel', tintStrength: 35 }],
    ['Box + zhuyin', { tintStyle: 'box', tintCovers: 'both', tintPalette: 'pastel', tintStrength: 35 }],
    ['Highlighter', { tintStyle: 'marker', tintCovers: 'char', tintPalette: 'pastel', tintStrength: 55 }],
    ['Coloured text', { tintStyle: 'ink', tintCovers: 'char', tintPalette: 'vivid', tintStrength: 100 }],
    ['Underline', { tintStyle: 'under', tintCovers: 'char', tintPalette: 'vivid', tintStrength: 80 }],
  ];
  const TABS = [['page', 'Page'], ['popups', 'Popups'], ['translate', 'Translate'], ['learn', 'Learn']];
  // `tab` is the panel tab, `sec` starts a titled section there. `ui`: panel only, not in the Violentmonkey menu.
  // `live`: hovering an option previews it on the page. `range`: [min, max, step] slider; `render`/`extra`: own controls.
  const SETTINGS = [
    { tab: 'page', label: host === 'local files' ? 'Local files' : 'This site', get: siteMode, set: (v) => GM_setValue(siteKey, v),
      opts: [['auto', 'auto'], ['on', 'on'], ['off', 'off']], hint: 'auto: only pages that look like Traditional Chinese',
      apply: (v) => { if (v === 'off') stop(); else if (v === 'on' || sniff()) start(); } },
    { tab: 'page', label: 'Zhuyin on page', k: 'zhuyin', opts: [['on', 'on'], ['hover', 'hover'], ['off', 'off']],
      hint: 'hover: only over the word under the pointer. The word card always shows it. Alt+Z switches',
      // Drawn zhuyin again: restart, so the overflow guard measures it (while hidden, nothing overflowed).
      apply: (v) => { zhuyinClass(v); if (v === 'on' && active) { stop(); start(); } } },
    { tab: 'page', label: 'Hover zhuyin', k: 'hoverZhuyin', opts: [['label', 'label above'], ['inline', 'in the line']], apply: () => zhuyinClass(CFG.zhuyin),
      hint: 'With Zhuyin on page: hover. In the line can push the word to the next line' },
    { tab: 'page', label: 'Layout', k: 'layout', opts: [['side', 'side'], ['top', 'top']],
      apply: (v) => document.documentElement.classList.toggle('zyh-top', v === 'top') },
    { tab: 'page', label: 'Highlight polyphones', k: 'showPolyphones', gm: 'poly', opts: onOff,
      apply: (v) => document.documentElement.classList.toggle('zyh-poly', v) },
    { tab: 'page', label: 'Buttons & popups', k: 'compactChrome', opts: [[true, 'compact'], [false, 'full zhuyin']], apply: () => { if (active) { stop(); start(); } } },
    { tab: 'page', sec: 'Performance', label: 'Zhuyin is added', k: 'lazy', opts: [[true, 'near the screen'], [false, 'to the whole page']], apply: () => { if (active) { stop(); start(); } },
      hint: 'Near the screen: a few screens ahead as you scroll, and taken off far behind, so long pages and the tint previews stay fast' },
    { tab: 'popups', label: 'Word gloss', k: 'gloss', opts: [['hover', 'hover'], ['alt', 'Alt'], ['off', 'off']], apply: hideGloss },
    { tab: 'popups', label: 'Zhuyin in popups', k: 'popupZhuyin', opts: [['beside', 'by each character'], ['after', 'after the word']],
      apply: () => { hideGloss(); retranslate(); }, hint: 'Word card, selected text and word list' },
    { tab: 'popups', label: 'Translate on select', k: 'autoTranslate', opts: [[true, 'on'], [false, 'Alt+T']] },
    { tab: 'popups', label: 'Pinyin in translation', k: 'pinyin', opts: onOff, apply: retranslate },
    { tab: 'popups', label: 'Read aloud key', k: 'speakKey', ask: 'a letter, or Alt+ a letter (R, Alt+R…)', hint: 'Works while a word card or translation is open',
      list: [...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => [c, c]), ...[...'ABCDEFGHIJKLMNOPQRSUVWXY'].map(c => ['Alt+' + c, 'Alt+' + c])] },   // Alt+Z, Alt+T are taken
    { tab: 'popups', ui: true, label: 'Popup size', k: 'popupScale', range: [70, 200, 10], fmt: (v) => v + ' %', hint: 'Text, buttons and boxes of every popup and this panel',
      apply: () => pop && popScale(pop.hostEl) },
    { tab: 'popups', label: 'Popup theme', k: 'theme', opts: [['auto', 'auto'], ['dark', 'dark'], ['light', 'light']], apply: (v) => { if (pop) pop.hostEl.dataset.theme = v; reTint(); } },
    { tab: 'translate', label: 'Translate to', k: 'targetLang', list: LANGS, free: true, ask: 'a Google language code or name (lt, en, Lithuanian…)', apply: () => { hideGloss(); retranslate(); },
      hint: 'Not English: word cards and word lists are translated by Google too' },
    { tab: 'translate', label: 'Second language', k: 'targetLang2', list: [['', 'none'], ...LANGS], free: true, ask: 'a Google language code or name, or none', apply: () => { hideGloss(); retranslate(); },
      hint: 'Shown under the first in every popup' },
    { tab: 'translate', label: 'Translator', k: 'translator', opts: [['google', 'Google'], ['local', 'local opus-mt']], apply: retranslate,
      hint: 'local (yt-zhuyin asr_server.py) translates to English only' },
    { tab: 'translate', label: 'Cache, MB per site', k: 'cacheMB', num: true, hint: 'Google translations and voice clips; 0 = off' },
    { tab: 'learn', sec: 'Character parts', ui: true, label: 'Parts on word cards', k: 'parts', opts: onOff, apply: hideGloss,
      hint: 'What a character is made of: the meaning part, the sound part, its origin. Click a part, or a character of a word, to open its card' },
    { tab: 'learn', ui: true, label: 'Translate explanations', k: 'partsLang', opts: onOff, apply: hideGloss,
      hint: 'With a target language other than English: part meanings, the hint and the origin in it too, under the English' },
    { tab: 'learn', sec: 'Tint characters', ui: true, label: 'Look', render: looksCtl, hint: 'Hover a look, a style or a palette to preview it on the page' },
    { tab: 'learn', ui: true, label: 'Most common', k: 'tintTop', range: [0, 1000, 10], fmt: (v) => (v ? 'top ' + v : 'off'), apply: reTint,
      hint: 'Each character always gets the same colour, on every page' },
    { tab: 'learn', ui: true, label: 'My characters', k: 'tintMine', opts: onOff, apply: reTint, extra: mineEditor,
      hint: 'Tinted and underlined even with Most common off. Add them with the highlighter on a word card, or here' },
    { tab: 'learn', ui: true, live: true, label: 'Style', k: 'tintStyle', opts: [['box', 'box'], ['marker', 'highlighter'], ['ink', 'text'], ['under', 'underline']], apply: reTint },
    { tab: 'learn', ui: true, live: true, label: 'Covers', k: 'tintCovers', opts: [['char', 'character'], ['both', 'character + zhuyin']], apply: reTint },
    { tab: 'learn', ui: true, live: true, label: 'Palette', k: 'tintPalette', render: palettesCtl, apply: reTint },
    { tab: 'learn', ui: true, label: 'Strength', k: 'tintStrength', range: [5, 100, 5], fmt: (v) => v + ' %', apply: reTint, extra: sampleCtl },
    { tab: 'learn', sec: 'Practice', label: 'Hide meaning', k: 'hideMeaning', opts: onOff, apply: () => { reveal(); retranslate(); rerenderCard(); },
      hint: 'Popups still open and read aloud; translations stay blurred until the reveal key is held. Double-tap the reveal key on an open card or popup to switch' },
    { tab: 'learn', label: 'Reveal key', k: 'revealKey', opts: Object.entries(KEY_NAMES), apply: retranslate },
  ];
  const getCfg = (r) => (r.get ? r.get() : CFG[r.k]);
  const valName = (r, v) => (r.opts ?? r.list)?.find(o => o[0] === v)?.[1] ?? (r.num && !v ? 'off' : String(v));
  function setCfg(r, v) {
    if (r.set) r.set(v); else { CFG[r.k] = v; GM_setValue(r.gm ?? r.k, v); }
    r.apply?.(v);
    buildMenu();
    if (shown('set')) renderSettings();
  }
  // Several values at once (a look): stored, then applied once.
  function setVals(vals) {
    for (const [k, v] of Object.entries(vals)) { CFG[k] = v; GM_setValue(k, v); }
    reTint();
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

  // Live preview: hovering an option sets it in CFG without storing it, and redraws the tints; leaving puts the
  // stored values back. With nothing tinted yet, the preview tints the 100 most common characters.
  let previewWas = null;
  function preview(vals) {
    previewWas ??= {};
    if (!CFG.tintTop && !(CFG.tintMine && CFG.myChars) && !('tintTop' in vals)) vals = { ...vals, tintTop: 100 };
    for (const [k, v] of Object.entries(vals)) { if (!(k in previewWas)) previewWas[k] = CFG[k]; CFG[k] = v; }
    refreshSoon();
  }
  function endPreview() { if (!previewWas) return; Object.assign(CFG, previewWas); previewWas = null; refreshSoon(); }
  const hoverPreview = (b, vals) => { b.onmouseenter = () => preview(vals); b.onmouseleave = endPreview; };

  function looksCtl() {
    const ctl = el('span', 'seg');
    for (const [name, vals] of LOOKS) {
      const b = el('button', Object.entries(vals).every(([k, v]) => CFG[k] === v) ? 'on' : null, name);
      hoverPreview(b, vals); b.onclick = () => { endPreview(); setVals(vals); };
      ctl.append(b);
    }
    return ctl;
  }
  function palettesCtl(r) {
    const ctl = el('span', 'pals');
    for (const [k, [name, f]] of Object.entries(PALETTES)) {
      const b = el('button', 'pal' + (k === CFG.tintPalette ? ' on' : '')), sw = el('span', 'sws');
      for (const c of SAMPLE.slice(0, 6)) { const [L, C, H] = f(fnv(c)), i = el('i'); i.style.background = `oklch(${L} ${C} ${H})`; sw.append(i); }
      b.append(sw, name); hoverPreview(b, { tintPalette: k }); b.onclick = () => { endPreview(); setCfg(r, k); };
      ctl.append(b);
    }
    return ctl;
  }
  // A line of common characters drawn with the current look, so it can be judged without Chinese on the page.
  const SAMPLE = [...'的一是不有人在我這大會以國來'];
  function sampleCtl() {
    const pv = el('div', 'pv');
    for (const c of SAMPLE) { const e = el('span', null, c); e.dataset.c = c; pv.append(e); }
    paintSample(pv);
    return pv;
  }
  const paintSample = (pv) => { for (const e of pv.querySelectorAll('[data-c]')) paint(e, e.dataset.c, 't', popDark()); };

  // ---- My characters: highlighter on the card, chips here, export to a file, import adds (never removes).
  let mineNote = '';
  function setMine(v) { CFG.myChars = v; GM_setValue('myChars', v); reTint(); if (shown('set')) renderSettings(); }
  function addMine(text) {
    const have = new Set(CFG.myChars), got = [...new Set(text.match(HAN_RUN)?.join('') ?? '')], add = got.filter(c => !have.has(c));
    mineNote = got.length ? `Added ${add.length} new character${add.length === 1 ? '' : 's'}` + (got.length > add.length ? ` (${got.length - add.length} already there)` : '') : 'No Chinese characters found';
    setMine(CFG.myChars + add.join(''));
  }
  const toggleMine = (c) => setMine(CFG.myChars.includes(c) ? CFG.myChars.replace(c, '') : CFG.myChars + c);
  function exportMine() {
    const text = '# zhuyin anywhere: My characters. Import adds them to the list in another browser.\n' + CFG.myChars + '\n';
    GM_setClipboard(text);
    const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'zhuyin-anywhere-characters.txt';
    pop.set.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    mineNote = `Exported ${[...CFG.myChars].length} characters to a file, also copied`;
    renderSettings();
  }
  function mineEditor() {
    const box = el('div', 'mine'), chips = el('div', 'chips');
    for (const c of CFG.myChars) {
      const chip = el('span', 'chip'), g = el('b', null, c), x = el('button', null, '×');
      paint(g, c, 'm', popDark()); x.title = 'Remove'; x.onclick = () => { mineNote = ''; setMine(CFG.myChars.replace(c, '')); };
      chip.append(g, x); chips.append(chip);
    }
    const inp = el('input'), add = el('button', null, 'Add'), exp = el('button', null, 'Export'), imp = el('button', null, 'Import…'), file = el('input');
    inp.placeholder = 'type or paste characters'; inp.onkeydown = (e) => { if (e.key === 'Enter') add.click(); };
    add.onclick = () => addMine(inp.value);
    exp.onclick = exportMine; exp.disabled = !CFG.myChars;
    file.type = 'file'; file.accept = '.txt,text/plain'; file.hidden = true;
    imp.title = 'Adds the characters in a text file (an export, or any text) to the list';
    imp.onclick = () => file.click();
    file.onchange = async () => { const f = file.files[0]; if (f) addMine((await f.text()).split('\n').filter(l => !l.startsWith('#')).join('')); };
    const tools = el('div', 'mtools'); tools.append(inp, add, exp, imp, file);
    if (CFG.myChars) box.append(chips);
    box.append(tools);
    if (mineNote) box.append(el('div', 'hint', mineNote));
    return box;
  }

  let setTab = 'page';
  function ctlFor(r) {
    const v = getCfg(r);
    if (r.render) return r.render(r);
    if (r.opts) {
      const ctl = el('span', 'seg');
      for (const [ov, name] of r.opts) {
        const b = el('button', ov === v ? 'on' : null, name);
        if (r.live) hoverPreview(b, { [r.k]: ov });
        b.onclick = () => { endPreview(); setCfg(r, ov); };
        ctl.append(b);
      }
      return ctl;
    }
    if (r.range) {   // dragging only moves the number; letting go stores and redraws (redrawing a page per step lags)
      const ctl = el('span', 'sld'), inp = el('input'), lab = el('b', null, r.fmt(v));
      [inp.type, inp.min, inp.max, inp.step, inp.value] = ['range', ...r.range, v];
      inp.oninput = () => { lab.textContent = r.fmt(+inp.value); };
      inp.onchange = () => setCfg(r, +inp.value);
      ctl.append(inp, lab);
      return ctl;
    }
    if (r.list) {
      const ctl = el('select');
      const list = r.list.some(o => o[0] === v) ? r.list : [[v, v], ...r.list];   // a code typed into the menu prompt
      for (const [ov, name] of list) { const o = el('option', null, name); o.value = ov; ctl.append(o); }
      ctl.value = v; ctl.onchange = () => setCfg(r, ctl.value);
      return ctl;
    }
    const ctl = el('input'); ctl.type = 'number'; ctl.min = '0'; ctl.value = v;
    ctl.onchange = () => { if (ctl.value !== '' && +ctl.value >= 0) setCfg(r, +ctl.value); };
    return ctl;
  }
  function renderSettings() {
    const ttl = el('div', 'ttl'), x = el('button', null, '✕');
    x.onclick = hideSettings;
    ttl.append(el('span', null, '注音 anywhere · settings'), x);
    const tabs = el('div', 'tabs');
    for (const [k, name] of TABS) { const b = el('button', k === setTab ? 'on' : null, name); b.onclick = () => { setTab = k; mineNote = ''; renderSettings(); }; tabs.append(b); }
    const out = [ttl, tabs];
    for (const r of SETTINGS.filter(r => r.tab === setTab)) {
      if (r.sec) out.push(el('div', 'sec', r.sec));
      const row = el('div', 'row');
      row.append(el('span', null, r.label), ctlFor(r));
      if (r.hint) row.append(el('div', 'hint', r.hint));
      if (r.extra) { const x = r.extra(r); x.classList.add('full'); row.append(x); }
      out.push(row);
    }
    const keep = pop.set.scrollTop;
    pop.set.replaceChildren(...out);
    pop.set.scrollTop = keep;
    // A tab can be taller than the one it was placed for, and a larger popup size wider: placed again.
    if (shown('set')) place(pop.set.zyRect, pop.set);
  }
  // Next to the box whose ⚙ opened it (kept clear of an open translation popup), or top right from the menu.
  function openSettings(rect) {
    popup(); renderSettings();
    place(rect ?? { left: innerWidth, top: 0, bottom: 0 }, pop.set);
  }
  function hideSettings() { endPreview(); mineNote = ''; if (pop) pop.set.style.display = 'none'; }

  // ---------------------------------------------------------------- menu
  const menuIds = [];
  function buildMenu() {
    menuIds.splice(0).forEach(id => { try { GM_unregisterMenuCommand(id); } catch {} });
    menuIds.push(GM_registerMenuCommand('Settings…', () => openSettings(null)));
    for (const r of SETTINGS.filter(r => !r.ui)) {
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
