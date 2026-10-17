// Renders the README images with the real userscript running in headless Chromium.
//
//   node build.js            → shots/*.png (demo-site screenshots) + ../../docs/img/*.png (README images)
//   node build.js --poster   → also out/poster.png (the whole poster.html as one tall image)
//
// Two stages:
//   1. site.html (a fictional blog) is opened with and without the userscript, and the feature states
//      (hover card, selection popup, pop-up modal) are triggered with the mouse → shots/*.png.
//   2. poster.html embeds those shots, and also contains "live" blocks (class="live") that the userscript
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

// Selection popup text. Keys must match the selected text exactly (zhuyin stripped).
const TRANSLATIONS = { '我們先去銀行換錢': 'We went to the bank first to change money.' };

for (const f of ['vendor/zhuyin-dict.js', 'vendor/cedict.gz', 'fonts.css']) {
  if (!fs.existsSync(path.join(HERE, f))) { console.error(`missing ${f}: run  sh fetch-deps.sh  first`); process.exit(1); }
}
const DICT = fs.readFileSync(path.join(HERE, 'vendor/zhuyin-dict.js'), 'utf8');
const CEDICT_B64 = fs.readFileSync(path.join(HERE, 'vendor/cedict.gz')).toString('base64');
const fileUrl = (f) => 'file://' + path.join(HERE, f);

// Violentmonkey's GM_* API, faked in the page so the userscript runs unmodified.
// `store` pre-seeds GM_getValue (per-site mode, compact toggle, …).
async function injectUserscript(page, store = {}) {
  await page.evaluate(([dict, gz, st, tr]) => {
    const bin = Uint8Array.from(atob(gz), (c) => c.charCodeAt(0));
    const cedictUrl = URL.createObjectURL(new Blob([bin]));
    Object.assign(window, {
      GM_getResourceText: () => dict,
      GM_getResourceURL: (name) => (name === 'cedict' ? cedictUrl : null),
      GM_getValue: (k, v) => (k in st ? st[k] : v),
      GM_setValue: (k, v) => { st[k] = v; },
      GM_registerMenuCommand: (n) => n, GM_unregisterMenuCommand() {}, GM_setClipboard() {},
      GM_xmlhttpRequest: (o) => {   // Google gtx response shape: [[[translation, source]]]
        const q = decodeURIComponent((o.url.split('&q=')[1] || ''));
        setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify([[[tr[q] || '(no canned translation)', q]]]) }), 30);
      },
    });
  }, [DICT, CEDICT_B64, store, TRANSLATIONS]);
  await page.addScriptTag({ path: SCRIPT });
  await page.waitForTimeout(1200);   // idle-callback annotation slices
}

// ------------------------------------------------------------------ stage 1: demo-site screenshots
async function demoPage(browser, { script = true, store = {}, modal = false, h = 330 } = {}) {
  const p = await browser.newPage({ viewport: { width: 640, height: h }, deviceScaleFactor: SCALE });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(fileUrl('site.html'));
  await p.evaluate(() => document.fonts.ready);
  if (modal) await p.evaluate(() => { document.getElementById('modalwrap').hidden = false; });
  if (script) await injectUserscript(p, store);
  return p;
}
const charCenter = (p, word, idx) => p.evaluate(([word, idx]) => {
  const w = [...document.querySelectorAll('zy-w')].find((w) => [...w.querySelectorAll('zy-c')].map((c) => c.firstChild.nodeValue).join('') === word);
  const r = w.querySelectorAll('zy-c')[idx].getBoundingClientRect();
  return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 };
}, [word, idx]);

async function shootDemo(browser) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = (n) => path.join(SHOTS, n);
  let p;

  p = await demoPage(browser, { script: false }); await p.screenshot({ path: out('before.png') }); await p.close();
  p = await demoPage(browser); await p.screenshot({ path: out('after.png') }); await p.close();

  // hover card: point at 珠 in 珍珠奶茶 (tall viewport so the card opens below the word)
  p = await demoPage(browser, { h: 600 });
  const c = await charCenter(p, '珍珠奶茶', 1);
  await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
  await p.screenshot({ path: out('hover.png') }); await p.close();

  // selection → translation popup with word list
  p = await demoPage(browser, { h: 520 });
  await p.evaluate(() => {
    const ws = [...document.querySelectorAll('#p1 zy-w')];
    const a = ws.find((w) => w.textContent.startsWith('我')), z = ws.find((w) => w.textContent.startsWith('換'));
    const r = document.createRange(); r.setStartBefore(a); r.setEndAfter(z);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await p.mouse.move(300, 150); await p.mouse.up(); await p.waitForTimeout(1600);
  await p.mouse.move(630, 510);   // park the mouse off the text
  await p.screenshot({ path: out('select.png') }); await p.close();

  // newsletter pop-up: full zhuyin vs compact mode
  p = await demoPage(browser, { modal: true, store: { compactChrome: false } }); await p.screenshot({ path: out('modal-full.png') }); await p.close();
  p = await demoPage(browser, { modal: true }); await p.screenshot({ path: out('modal-compact.png') }); await p.close();
  console.log('shots/ done');
}

// ------------------------------------------------------------------ stage 2: poster + README images
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
  const sym = (z) => `<span style="font-style:normal;font-family:'Noto Sans CJK TC';font-size:34px;color:#1F2D3A;display:inline-block;width:46px;vertical-align:-4px">${z}</span>`;
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
  'hero':         () => document.querySelector('.title-zh'),
  'how-to-read':  () => document.getElementById('anat'),
  'tones':        () => document.querySelector('.trow'),
  'before-after': () => document.querySelectorAll('section')[1].querySelector('.pair'),
  'hover':        () => document.querySelectorAll('section')[2].querySelectorAll('.feature')[0].querySelector('.frame'),
  'select':       () => document.querySelectorAll('section')[2].querySelectorAll('.feature')[1].querySelector('.frame'),
  'context':      () => document.querySelector('.context'),
  'compact':      () => document.querySelectorAll('section')[4].querySelector('.pair'),
};

async function readmeImages(p) {
  fs.mkdirSync(IMG_OUT, { recursive: true });
  await p.evaluate(() => document.querySelectorAll('h2,h3,.lede,.cap,.foot,.mast > div:last-child,.tones .sub,.legend,.bar .url')
    .forEach((x) => { x.style.visibility = 'hidden'; }));
  for (const [name, pick] of Object.entries(README_IMAGES)) {
    const clip = await p.evaluate(([src, name]) => {
      const el = (0, eval)(`(${src})`)(), r = el.getBoundingClientRect(), pad = 36;
      const extra = name === 'hero' ? 10 : 0;   // the hero box has an 8px offset shadow
      return { x: Math.max(0, r.left - pad), y: r.top + scrollY - pad, width: Math.min(1500, r.width + 2 * pad + extra), height: r.height + 2 * pad + extra };
    }, [pick.toString(), name]);
    await p.screenshot({ path: path.join(IMG_OUT, name + '.png'), clip, fullPage: true });
  }
  console.log('docs/img/ done');
}

(async () => {
  const browser = await chromium.launch();
  await shootDemo(browser);
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
