// Long pages (TASK-008): only text near the screen is annotated, far-off text goes back to plain text, nothing jumps;
// "Zhuyin is added: to the whole page" annotates everything. Tint previews still reach the cells near the screen.
const { chromium, ok, page, sh, outDir, done } = require('./harness');
const OUT = outDir(__filename);

// 150 more paragraphs after the demo's: about 20 screens.
const SENTENCE = '我們先去銀行換錢，然後搭捷運到夜市吃小吃。路邊的行人很多，大家都在排隊買珍珠奶茶。';
const grow = (p) => p.evaluate((s) => {
  for (let i = 0; i < 150; i++) { const e = document.createElement('p'); e.id = 'lp' + i; e.textContent = i + ' ' + s.repeat(3); document.body.append(e); }
}, SENTENCE);
const runs = (p, ids) => p.evaluate((ids) => ids.map(id => !!document.getElementById(id).querySelector('zy-run')), ids);
const settings = async (p) => { await p.evaluate(() => __menu.find(m => m[0] === 'Settings…')[1]()); await p.waitForTimeout(200); };

(async () => {
  const browser = await chromium.launch();
  let p = await page(browser);
  await grow(p); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => innerHeight * 15 < document.documentElement.scrollHeight), 'page is long: ' + await p.evaluate(() => Math.round(document.documentElement.scrollHeight / innerHeight)) + ' screens');
  let [top, mid, end] = await runs(p, ['lp0', 'lp70', 'lp149']);
  ok(top && !mid && !end, 'near the screen: only the top annotated');
  ok(await p.evaluate(() => document.getElementById('lp70').textContent.startsWith('70 我們')), 'far-off text untouched');

  // Screen by screen down and back up: text ahead gets annotated, text far behind goes back to plain text, and
  // neither moves what's on screen (the browser's scroll anchoring makes up for the height above changing).
  const step = async (dy) => {
    const [id, y] = await p.evaluate(() => { const e = [...document.querySelectorAll('p')].find(e => e.getBoundingClientRect().top > 200); return [e.id, e.getBoundingClientRect().top]; });
    await p.evaluate((dy) => scrollBy(0, dy * innerHeight), dy); await p.waitForTimeout(400);
    return Math.abs(await p.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, id) - (y - dy * 600));
  };
  let moved = 0;
  for (let i = 0; i < 12; i++) moved = Math.max(moved, await step(1));
  const here = await p.evaluate(() => [...document.querySelectorAll('p')].find(e => e.getBoundingClientRect().top > 200).id);
  [top, mid, end] = await runs(p, ['lp0', here, 'lp149']);
  ok(!top && mid && !end, `scrolled down 12 screens: ${here} annotated, the top back to plain text, the end not yet`);
  ok(await p.evaluate((s) => document.getElementById('lp0').textContent === '0 ' + s.repeat(3) && !document.querySelector('#p1 zy-run'), SENTENCE), 'restored text is the original');
  await p.screenshot({ path: OUT + '/1-middle.png' });
  for (let i = 0; i < 12; i++) moved = Math.max(moved, await step(-1));
  ok(moved < 2, `nothing on screen moved while scrolling (at most ${moved.toFixed(1)} px)`);
  [top, end] = await runs(p, ['p1', 'lp149']);
  ok(top && !end, 'back at the top: annotated again');

  // A tint preview reaches the cells near the screen
  await settings(p);
  await sh(p, `$$('.set .tabs button').find(b => b.textContent === 'Learn').click()`);
  const xy = await sh(p, `(() => { const b = $$('.set .seg button').find(b => b.textContent === 'Highlighter'); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 }; })()`);
  await p.mouse.move(xy.x, xy.y); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !!document.querySelector('#lp0 zy-c[data-t]')), 'hover a look: previewed on the annotated text');
  await p.mouse.move(5, 590); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.querySelector('zy-c[data-t]')), 'leave: preview gone');

  // Page tab: Performance section; switching to the whole page annotates everything
  await sh(p, `$$('.set .tabs button').find(b => b.textContent === 'Page').click()`);
  ok(await sh(p, `$$('.set .sec').map(s => s.textContent).join() === 'Performance'`), 'Page tab: Performance section');
  await sh(p, `$$('.set .seg button').find(b => b.textContent === 'to the whole page').click()`);
  await p.waitForTimeout(2000);
  ok(await p.evaluate(() => __st.lazy === false), 'whole page: saved');
  [top, mid, end] = await runs(p, ['lp0', 'lp70', 'lp149']);
  ok(top && mid && end, 'whole page: everything annotated');
  ok(await p.evaluate(() => __menu.some(m => m[0] === 'Zhuyin is added: to the whole page → near the screen')), 'menu shows it');
  await p.close();

  await done(browser);
})();
