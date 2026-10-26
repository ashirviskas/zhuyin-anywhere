// Renders the README images with the real userscript running in headless Chromium.
//
//   node build.js            → shots/*.png (demo-site screenshots) + ../../docs/img/*.png (README images)
//   node build.js --poster   → also out/poster.png (the whole poster.html as one tall image)
//
// Three stages:
//   1. site.html (a fictional blog) is opened with and without the userscript, and the feature states
//      (hover card, selection popup, pop-up modal) are triggered with the mouse → shots/*.png.
//   2. hero.html, the README's top image and the repo's social preview: the name, and a browser window with the
//      card for 夜市 open → ../../docs/img/hero.png (2×) and social-preview.png (1280×640).
//   3. poster.html embeds those shots, and also contains "live" blocks (class="live") that the userscript
//      annotates itself (注音, 銀, the five tones, 行人/銀行). Red-pen callouts are positioned from the
//      measured glyph boxes of that live output, then each section is clipped out → docs/img/*.png.
//
// Requires: npm install, then sh fetch-deps.sh (dictionaries + fonts). Nothing else hits the network:
// the translation in the selection popup is canned (see TRANSLATIONS), since a headless run can't rely
// on Google's endpoint.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '../..');
const SCRIPT = path.join(ROOT, 'zhuyin-anywhere.user.js');
const IMG_OUT = path.join(ROOT, 'docs/img');
const SHOTS = path.join(HERE, 'shots');
const SCALE = 2;   // device pixel ratio of every render: 2 keeps text sharp on hi-dpi screens and GitHub

// Canned Google answers per target language. Keys must match the text sent exactly (zhuyin stripped);
// word cards and word lists send one word per line, and every line is looked up on its own.
// The Lithuanian is Google's real output for these requests (2026-10-17).
const TRANSLATIONS = {
  en: { '我們先去銀行換錢': 'We went to the bank first to change money.' },
  lt: { '我們先去銀行換錢': 'Pirmiausia eikime į banką išsikeisti pinigų', '我們': 'mus', '先': 'pirma', '去': 'eik', '銀行': 'bankas',
    '換錢': 'išsikeisti pinigus', '夜市': 'naktinis turgus', '夜': 'nakties', '市': 'miestas' },
};

for (const f of ['vendor/zhuyin-dict.js', 'vendor/cedict.gz', 'fonts.css']) {
  if (!fs.existsSync(path.join(HERE, f))) { console.error(`missing ${f}: run  sh fetch-deps.sh  first`); process.exit(1); }
}
const DICT = fs.readFileSync(path.join(HERE, 'vendor/zhuyin-dict.js'), 'utf8');
const CEDICT_B64 = fs.readFileSync(path.join(HERE, 'vendor/cedict.gz')).toString('base64');
const COMPS_B64 = fs.readFileSync(path.join(ROOT, 'data/components.tsv.gz')).toString('base64');
const fileUrl = (f) => 'file://' + path.join(HERE, f);

// Violentmonkey's GM_* API, faked in the page so the userscript runs unmodified.
// `store` pre-seeds GM_getValue (per-site mode, compact toggle, …).
const VERSION = /@version\s+(\S+)/.exec(fs.readFileSync(SCRIPT, 'utf8'))[1];
async function injectUserscript(page, store = {}) {
  store = { seenVersion: VERSION, updateCheck: Date.now(), lazy: false, ...store };   // no "what's new" or update note in the images; the tall poster annotated whole
  await page.evaluate(([dict, gz, comps, st, tr, version]) => {
    // the popup's closed shadow root, opened so a shot can click a row of the card
    const att = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { return (window.__sh = att.call(this, { ...o, mode: 'open' })); };
    const blob = (b64) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    const cedictUrl = blob(gz), compsUrl = blob(comps);
    Object.assign(window, {
      GM_info: { script: { version } },
      GM_getResourceText: () => dict,
      GM_getResourceURL: (name) => (name === 'cedict' ? cedictUrl : name === 'comps' ? compsUrl : null),
      GM_getValue: (k, v) => (k in st ? st[k] : v),
      GM_setValue: (k, v) => { st[k] = v; },
      // menu commands are kept by name, so a shot can open "Settings…" the way a user would
      GM_registerMenuCommand: (n, f) => { (window.__menu ??= {})[n] = f; return n; }, GM_unregisterMenuCommand() {}, GM_setClipboard() {},
      GM_xmlhttpRequest: (o) => {   // Google gtx response shape: [[[translation, source]]]
        const q = decodeURIComponent((o.url.split('&q=')[1] || '')), tl = /[?&]tl=([^&]+)/.exec(o.url)?.[1];
        const out = q.split('\n').map((l) => tr[tl]?.[l] || '(no canned translation)').join('\n');
        setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify([[[out, q]]]) }), 30);
      },
    });
  }, [DICT, CEDICT_B64, COMPS_B64, store, TRANSLATIONS, VERSION]);
  await page.addScriptTag({ path: SCRIPT });
  await page.waitForTimeout(1200);   // idle-callback annotation slices
}

// ------------------------------------------------------------------ stage 1: demo-site screenshots
async function demoPage(browser, { script = true, store = {}, modal = false, h = 330, colorScheme = 'light' } = {}) {
  const p = await browser.newPage({ viewport: { width: 640, height: h }, deviceScaleFactor: SCALE, colorScheme });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(fileUrl('site.html'));
  await p.evaluate(() => document.fonts.ready);
  if (modal) await p.evaluate(() => { document.getElementById('modalwrap').hidden = false; });
  if (script) await injectUserscript(p, store);
  return p;
}
const charCenter = (p, word, idx) => p.evaluate(([word, idx]) => {
  const w = [...document.querySelectorAll('zy-w')].find((w) => [...w.querySelectorAll('zy-c')].map((c) => c.firstChild.textContent).join('') === word);
  const r = w.querySelectorAll('zy-c')[idx].getBoundingClientRect();
  return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 };
}, [word, idx]);

// Selects 我們先去銀行換錢 and releases the mouse, so the translation popup opens.
async function selectSentence(p) {
  await p.evaluate(() => {
    const ws = [...document.querySelectorAll('#p1 zy-w')];
    const a = ws.find((w) => w.textContent.startsWith('我')), z = ws.find((w) => w.textContent.startsWith('換'));
    const r = document.createRange(); r.setStartBefore(a); r.setEndAfter(z);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await p.mouse.move(300, 150); await p.mouse.up(); await p.waitForTimeout(1600);
}

async function shootDemo(browser) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = (n) => path.join(SHOTS, n);
  let p;

  p = await demoPage(browser, { script: false }); await p.screenshot({ path: out('before.png') }); await p.close();
  // with the script: the 100 most common characters tinted, and two of My characters (珠, 夜) underlined too
  const learnStore = { tintTop: 100, myChars: '珠夜' };
  p = await demoPage(browser, { store: learnStore }); await p.screenshot({ path: out('after.png') }); await p.close();

  // hover card and selection popup, with the system (site.html and the popups' 'auto' theme) light, then dark
  for (const [sfx, colorScheme] of [['', 'light'], ['-dark', 'dark']]) {
    // hover card: point at 珠 in 珍珠奶茶 (tall viewport so the card opens below the word)
    p = await demoPage(browser, { h: 600, store: learnStore, colorScheme });
    const c = await charCenter(p, '珍珠奶茶', 1);
    await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
    await p.screenshot({ path: out(`hover${sfx}.png`) }); await p.close();

    // selection → translation popup with word list
    p = await demoPage(browser, { h: 520, colorScheme });
    await selectSentence(p);
    await p.mouse.move(630, 510);   // park the mouse off the text
    await p.screenshot({ path: out(`select${sfx}.png`) }); await p.close();
  }

  // new features since 0.7.0, all in dark mode: two target languages (Lithuanian, then English)
  const twoLangs = { targetLang: 'lt', targetLang2: 'en' };
  p = await demoPage(browser, { h: 600, store: twoLangs, colorScheme: 'dark' });
  const n = await charCenter(p, '夜市', 0);
  await p.mouse.move(5, 5); await p.mouse.move(n.x, n.y); await p.waitForTimeout(1600);
  await p.screenshot({ path: out('hover-lang.png') }); await p.close();
  p = await demoPage(browser, { h: 520, store: twoLangs, colorScheme: 'dark' });
  await selectSentence(p);
  await p.mouse.move(630, 510);
  await p.screenshot({ path: out('select-lang.png') }); await p.close();

  // hide meaning: the same popup blurred, then with the reveal key (Shift) held
  for (const [name, held] of [['hidden', false], ['revealed', true]]) {
    p = await demoPage(browser, { h: 520, store: { ...twoLangs, hideMeaning: true }, colorScheme: 'dark' });
    await selectSentence(p);
    await p.mouse.move(630, 510);
    if (held) { await p.keyboard.down('Shift'); await p.waitForTimeout(300); }
    await p.screenshot({ path: out(name + '.png') }); await p.close();
  }

  // settings panel, Learn tab, opened from the menu (the ⚙ on a popup opens the same panel)
  p = await demoPage(browser, { h: 1400, store: learnStore, colorScheme: 'dark' });
  await p.evaluate(() => window.__menu['Settings…']());
  await p.waitForTimeout(300);
  await p.evaluate(() => [...__sh.querySelectorAll('.set .tabs button')].find(b => b.textContent === 'Learn').click());
  await p.waitForTimeout(300);
  await p.screenshot({ path: out('settings.png') }); await p.close();

  // character parts, dark: the card for 吃, then 銀行 with its 銀 row clicked
  p = await demoPage(browser, { h: 600, colorScheme: 'dark' });
  let c = await charCenter(p, '吃', 0);
  await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
  await p.screenshot({ path: out('parts.png') }); await p.close();
  p = await demoPage(browser, { h: 600, colorScheme: 'dark' });
  c = await charCenter(p, '銀行', 0);
  await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
  const row = await p.evaluate(() => { const r = __sh.querySelector('.gl .parts .part').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await p.mouse.move(row.x, row.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(600);
  await p.mouse.move(row.x + 200, row.y - 40);   // off the row, still on the card
  await p.screenshot({ path: out('parts-open.png') }); await p.close();

  // tinted characters: top 100 and My characters (吃, 夜, 市), two looks
  for (const [name, look] of [['tint', {}], ['tint-ink', { tintStyle: 'ink', tintPalette: 'vivid', tintStrength: 100 }]]) {
    p = await demoPage(browser, { store: { ...learnStore, ...look } });
    await p.screenshot({ path: out(name + '.png') }); await p.close();
  }

  // newsletter pop-up: full zhuyin vs compact mode
  p = await demoPage(browser, { modal: true, store: { compactChrome: false } }); await p.screenshot({ path: out('modal-full.png') }); await p.close();
  p = await demoPage(browser, { modal: true }); await p.screenshot({ path: out('modal-compact.png') }); await p.close();
  console.log('shots/ done');
}

// ------------------------------------------------------------------ stage 2: hero / social preview
// 1280×640, GitHub's social preview size: hero.png at 2× for the README, social-preview.png at exactly 1280×640
// to upload in the repository's Settings → General → Social preview (limit 1 MB).
async function heroImage(browser) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: SCALE });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(fileUrl('hero.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => document.querySelectorAll('body *:not(.live)').forEach((e) => {   // only the browser window is annotated
    if (!e.querySelector('.live') && !e.closest('.live')) e.setAttribute('translate', 'no');
  }));
  // a big card, readable as a thumbnail; 茶 as one of My characters, tinted strong enough to see
  await injectUserscript(p, { 'site:local files': 'on', popupScale: 175, myChars: '茶', tintStrength: 70 });
  const c = await charCenter(p, '夜市', 0);
  await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
  // Staged: place() keeps room for the card's widest possible size, which at 175 % pushes it left over the name.
  // Line its left edge up with 夜 instead; the check below keeps it inside GitHub's safe area (x 80–1200, y 80–560).
  const box = await p.evaluate(() => {
    const w = [...document.querySelectorAll('zy-w')].find((w) => w.textContent.startsWith('夜'));
    const card = [...__sh.querySelectorAll('.gl')].find((e) => e.getBoundingClientRect().width);
    card.style.left = Math.round(w.getBoundingClientRect().left) + 'px';
    const r = card.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round);
  });
  if (box[0] < 80 || box[1] < 80 || box[2] > 1200 || box[3] > 560) console.log('hero: card outside the safe area', box);
  fs.mkdirSync(IMG_OUT, { recursive: true });
  await p.screenshot({ path: path.join(IMG_OUT, 'hero.png') });
  await p.screenshot({ path: path.join(IMG_OUT, 'social-preview.png'), scale: 'css' });
  await p.close();
  console.log('docs/img/hero.png, social-preview.png done');
}

// ------------------------------------------------------------------ stage 3: poster + README images
async function renderPoster(browser) {
  const p = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: SCALE });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(fileUrl('poster.html'));
  await p.evaluate(() => document.fonts.ready);
  // Only .live blocks get annotated: everything else is marked translate="no", which the script skips.
  await p.evaluate(() => document.querySelectorAll('body *:not(.live):not(svg *)').forEach((e) => {
    if (!e.querySelector('.live') && !e.closest('.live')) e.setAttribute('translate', 'no');
  }));
  // poster.html is a local file with little Chinese, so force the script on and keep hover cards out
  await injectUserscript(p, { 'site:local files': 'on', gloss: 'off' });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(drawCallouts);
  await p.waitForTimeout(300);
  return p;
}

// Runs in the page. Red-pen arrows and circles, placed from the userscript's real glyph boxes.
function drawCallouts() {
  const NS = 'http://www.w3.org/2000/svg';
  const rel = (r, host) => { const h = host.getBoundingClientRect(); return { l: r.left - h.left, t: r.top - h.top, r: r.right - h.left, b: r.bottom - h.top, cx: (r.left + r.right) / 2 - h.left, cy: (r.top + r.bottom) / 2 - h.top, w: r.width, h: r.height }; };
  const pathEl = (svg, d) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); svg.appendChild(e); };
  const ellipse = (svg, cx, cy, rx, ry, rot = -8) => { const e = document.createElementNS(NS, 'ellipse'); Object.entries({ cx, cy, rx, ry, transform: `rotate(${rot} ${cx} ${cy})` }).forEach(([k, v]) => e.setAttribute(k, v)); svg.appendChild(e); };
  const label = (host, x, y, html, w = 380) => { const d = document.createElement('div'); d.className = 'pen'; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px' }); d.innerHTML = html; d.setAttribute('translate', 'no'); host.appendChild(d); return d; };
  const arrow = (svg, x1, y1, x2, y2, bend = 30) => {   // quadratic curve + open arrowhead at (x2, y2)
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - bend;
    pathEl(svg, `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`);
    const a = Math.atan2(y2 - my, x2 - mx), L = 13;
    pathEl(svg, `M${x2 - L * Math.cos(a - .45)} ${y2 - L * Math.sin(a - .45)} L${x2} ${y2} L${x2 - L * Math.cos(a + .45)} ${y2 - L * Math.sin(a + .45)}`);
  };

  // anatomy of 銀: ranges over single characters give the actual glyph boxes inside the zhuyin column
  const host = document.getElementById('anat'), svg = document.getElementById('ink-anat');
  const zs = host.querySelector('zy-zs'), tn = host.querySelector('zy-tn'), ch = host.querySelector('zy-c').firstChild;
  const rng = (node, i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return rel(r.getBoundingClientRect(), host); };
  const col = rel(host.querySelector('zy-col').getBoundingClientRect(), host);
  const s1 = rng(zs.firstChild, 0), s2 = rng(zs.firstChild, 1), t = rng(tn.firstChild, 0), c = rng(ch, 0);
  const LX = 760;   // x of the label column
  const sym = (z) => `<span style="font-style:normal;font-family:'Noto Sans TC';font-size:34px;color:#1F2D3A;display:inline-block;width:46px;vertical-align:-4px">${z}</span>`;
  label(host, LX, s1.cy - 24, sym('ㄧ') + 'sounds like “ee” in <i>see</i>', 500);
  arrow(svg, LX - 16, s1.cy, col.r + 18, s1.cy, 10);
  const ny = s2.cy + 26;   // a little below ㄣ's centre, to pass under the tone glyph
  label(host, LX, ny - 24, sym('ㄣ') + 'sounds like “n”', 500);
  arrow(svg, LX - 16, ny, col.r + 18, ny, 8);
  const tx = t.l + t.w * 0.86, ty = s2.t + 24;   // the visible ˊ stroke, not its tall line box
  label(host, LX, ny + 66, sym('ˊ') + 'tone mark: the voice rises,<br>as when asking a question', 500);
  arrow(svg, LX - 16, ny + 92, tx + 10, ty + 10, 40);
  label(host, c.cx - 90, c.t - 74, 'the character', 180).style.textAlign = 'center';
  arrow(svg, c.cx, c.t - 38, c.cx, c.t - 6, 0);
  label(host, col.cx - 80, c.t - 74, 'its zhuyin', 160).style.textAlign = 'center';
  arrow(svg, col.cx, c.t - 38, col.cx, s1.t - 6, 0);

  // 行 circled in each context tile (character + its zhuyin)
  for (const [id, idx] of [['ctx1', 0], ['ctx2', 1]]) {
    const h = document.getElementById(id), sv = h.querySelector('svg');
    const cc = h.querySelectorAll('zy-c')[idx];
    const r = rel(cc.getBoundingClientRect(), h), z = rel(cc.querySelector('zy-z').getBoundingClientRect(), h);
    ellipse(sv, (r.l + z.r) / 2 + 2, r.cy, (z.r - r.l) / 2 + 14, r.h / 2 + 8);
  }
}

// README images: one clip per example. All prose (headings, captions, URLs) is hidden first,
// because the README carries the text; the images only show examples.
const README_IMAGES = {
  'how-to-read':  () => document.getElementById('anat'),
  'tones':        () => document.querySelector('.trow'),
  'before-after': () => document.querySelectorAll('section')[1].querySelector('.pair'),
  'hover':        () => document.querySelectorAll('section')[2].querySelectorAll('.feature')[0].querySelector('.frame'),
  'select':       () => document.querySelectorAll('section')[2].querySelectorAll('.feature')[1].querySelector('.frame'),
  'dark':         () => document.getElementById('dark'),
  'languages':    () => document.getElementById('lang'),
  'hide-meaning': () => document.getElementById('hide'),
  'settings':     () => document.getElementById('settings'),
  'parts':        () => document.getElementById('parts'),
  'tint':         () => document.getElementById('tint'),
  'context':      () => document.querySelector('.context'),
  'compact':      () => document.getElementById('compact').querySelector('.pair'),
};

async function readmeImages(p) {
  fs.mkdirSync(IMG_OUT, { recursive: true });
  await p.evaluate(() => document.querySelectorAll('h2,h3,.lede,.cap,.foot,.mast > div:last-child,.tones .sub,.legend,.bar .url')
    .forEach((x) => { x.style.visibility = 'hidden'; }));
  for (const [name, pick] of Object.entries(README_IMAGES)) {
    const clip = await p.evaluate(([src, name]) => {
      const el = (0, eval)(`(${src})`)(), r = el.getBoundingClientRect();
      let pad = 36;
      if (el.classList.contains('night')) pad = 0;   // night blocks draw their own dark margin
      return { x: Math.max(0, r.left - pad), y: r.top + scrollY - pad, width: Math.min(1500, r.width + 2 * pad), height: r.height + 2 * pad };
    }, [pick.toString(), name]);
    await p.screenshot({ path: path.join(IMG_OUT, name + '.png'), clip, fullPage: true });
  }
  console.log('docs/img/ done');
}

(async () => {
  const browser = await chromium.launch();
  await shootDemo(browser);
  await heroImage(browser);
  if (process.argv.includes('--poster')) {
    const p = await renderPoster(browser);
    fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
    await p.screenshot({ path: path.join(HERE, 'out/poster.png'), fullPage: true });
    await p.close();
    console.log('out/poster.png done');
  }
  const p = await renderPoster(browser);
  await readmeImages(p);
  await browser.close();
})();
