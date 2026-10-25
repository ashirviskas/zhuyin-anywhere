// Where popups open (TASK-008): the direction depends only on where the word is on screen (upper half → below, lower
// half → above), the edge facing the word stays put when a card opened from it is smaller or grows, and a card opened
// from a card gives the pointer time to reach it.
const { chromium, ok, page, sh, hover, outDir, done } = require('./harness');
const OUT = outDir(__filename);

const word = (p, w) => p.evaluate((w) => {
  const e = [...document.querySelectorAll('zy-w')].find((e) => [...e.querySelectorAll('zy-c')].map((c) => c.firstChild.textContent).join('') === w);
  const rs = [...e.querySelectorAll('zy-c')].map(c => c.getBoundingClientRect());   // the card's anchor: its characters
  return { top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) };
}, w);
const card = (p) => sh(p, `(() => { const g = $('.gl'), r = g.getBoundingClientRect(); return { shown: g.style.display === 'block', top: r.top, bottom: r.bottom, h: r.height }; })()`);
// Clicks a character row of the open word card, then moves the pointer off the card (as if the smaller card left it outside).
const openRow = async (p, ch) => {
  const xy = await sh(p, `(() => { const r = $$('.gl .parts .part.go').find(r => r.textContent.includes('${ch}')).getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
  await p.mouse.move(xy.x, xy.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
};

(async () => {
  const browser = await chromium.launch();

  // Upper half: below the word, top edge pinned
  let p = await page(browser);
  let w = await word(p, '珍珠奶茶');
  await hover(p, '珍珠奶茶');
  const big = await card(p);
  ok(big.shown && Math.abs(big.top - (w.bottom + 2)) < 1, `upper half: card below the word (${big.top.toFixed(0)} vs ${w.bottom.toFixed(0)})`);
  await openRow(p, '珍');
  const small = await card(p);
  ok(small.shown && Math.abs(small.top - big.top) < 1, `card from a card: same top edge (${big.top.toFixed(0)} → ${small.top.toFixed(0)}, height ${big.h.toFixed(0)} → ${small.h.toFixed(0)})`);
  await p.screenshot({ path: OUT + '/1-down.png' });
  // Pointer off the card, onto the page: still there after the usual hide delay, gone after the longer one
  await p.mouse.move(600, 580); await p.waitForTimeout(800);
  ok((await card(p)).shown, 'card from a card: still open 0.8 s after the pointer left');
  await p.waitForTimeout(1500);
  ok(!(await card(p)).shown, 'card from a card: hidden after 2.3 s');
  // A fresh hover card still hides at the usual delay
  await hover(p, '珍珠奶茶');
  await p.mouse.move(600, 580); await p.waitForTimeout(800);
  ok(!(await card(p)).shown, 'hover card: hidden 0.8 s after the pointer left');
  await p.close();

  // Lower half: above the word, bottom edge pinned, also while the card grows (loading → parts)
  p = await page(browser);
  await p.evaluate(() => { const s = document.createElement('div'); s.style.height = '260px'; document.body.prepend(s); });
  await p.waitForTimeout(300);
  w = await word(p, '珍珠奶茶');
  ok(w.top > 300 && w.bottom < 590, 'word moved to the lower half');
  await hover(p, '珍珠奶茶');
  const up = await card(p);
  ok(up.shown && Math.abs(up.bottom - (w.top - 2)) < 1, `lower half: card above the word (${up.bottom.toFixed(0)} vs ${w.top.toFixed(0)})`);
  await openRow(p, '奶');
  const up2 = await card(p);
  ok(up2.shown && Math.abs(up2.bottom - up.bottom) < 1, `card from a card: same bottom edge (${up.bottom.toFixed(0)} → ${up2.bottom.toFixed(0)})`);
  ok(up2.top >= 8, 'card stays on screen');
  await p.screenshot({ path: OUT + '/2-up.png' });
  await p.close();

  await done(browser);
})();
