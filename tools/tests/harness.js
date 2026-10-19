// Shared by the *.test.js files: runs the real userscript on tools/assets/site.html in headless Chromium.
// Violentmonkey's GM_* API is faked in the page. Google is faked too: a translation is "<tl>:<source>", line by
// line, so language and batching are visible. The popup's closed shadow root is opened so tests can read it.
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../..'), A = ROOT + '/tools/assets';
const { chromium } = require(A + '/node_modules/playwright');
const DICT = fs.readFileSync(A + '/vendor/zhuyin-dict.js', 'utf8');
const GZ = fs.readFileSync(A + '/vendor/cedict.gz').toString('base64');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function page(browser, store = {}, colorScheme = 'light') {
  const p = await browser.newPage({ viewport: { width: 640, height: 600 }, deviceScaleFactor: 2, colorScheme });
  p.on('pageerror', (e) => { console.log('pageerror', e.message); fails++; });
  await p.goto('file://' + A + '/site.html');
  await p.evaluate(([dict, gz, st]) => {
    const att = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (o) { return (window.__sh = att.call(this, { ...o, mode: 'open' })); };
    const bin = Uint8Array.from(atob(gz), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin]));
    window.__req = []; window.__menu = [];
    Object.assign(window, {
      GM_getResourceText: () => dict, GM_getResourceURL: (n) => (n === 'cedict' ? url : null),
      GM_getValue: (k, v) => (k in st ? st[k] : v), GM_setValue: (k, v) => { st[k] = v; }, __st: st,
      GM_registerMenuCommand: (n, f) => { __menu.push([n, f]); return n; },
      GM_unregisterMenuCommand: (n) => { __menu = __menu.filter(m => m[0] !== n); }, GM_setClipboard: (t) => { window.__clip = t; },
      GM_xmlhttpRequest: (o) => {
        __req.push(o.url);
        if (o.url.includes('translate_tts')) return setTimeout(() => o.onerror(), 10);
        const tl = /tl=([^&]+)/.exec(o.url)[1], q = decodeURIComponent(o.url.split('&q=')[1]);
        const out = q.split('\n').map(l => tl + ':' + l).join('\n');
        setTimeout(() => o.onload({ status: 200, responseText: JSON.stringify([[[out, q]]]) }), 20);
      },
    });
  }, [DICT, GZ, store]);
  await p.addScriptTag({ path: ROOT + '/zhuyin-anywhere.user.js' });
  await p.waitForTimeout(1200);
  return p;
}
const sh = (p, js) => p.evaluate(`(() => { const $ = (s) => __sh.querySelector(s), $$ = (s) => [...__sh.querySelectorAll(s)]; return ${js}; })()`);
const hover = async (p, word, idx = 1) => {
  const c = await p.evaluate(([word, idx]) => {
    const w = [...document.querySelectorAll('zy-w')].find((w) => [...w.querySelectorAll('zy-c')].map((c) => c.firstChild.nodeValue).join('') === word);
    const r = w.querySelectorAll('zy-c')[idx].getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2 };
  }, [word, idx]);
  await p.mouse.move(5, 5); await p.mouse.move(c.x, c.y); await p.waitForTimeout(1600);
};
const select = async (p) => {
  await p.evaluate(() => {
    const ws = [...document.querySelectorAll('#p1 zy-w')];
    const a = ws.find((w) => w.textContent.startsWith('我')), z = ws.find((w) => w.textContent.startsWith('換'));
    const r = document.createRange(); r.setStartBefore(a); r.setEndAfter(z); getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await p.mouse.move(300, 150); await p.mouse.up(); await p.waitForTimeout(1200); await p.mouse.move(630, 590);
};

// Screenshots for a look by eye go to tools/tests/out/<test name>/ (git-ignored).
const outDir = (file) => { const d = path.join(__dirname, 'out', path.basename(file, '.test.js')); fs.mkdirSync(d, { recursive: true }); return d; };
const done = async (browser) => {
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
};

module.exports = { chromium, ok, page, sh, hover, select, outDir, done };
