// Zhuyin on page (on / hover / off, Alt+Z), hover zhuyin and zhuyin in popups (TASK-003).
const { chromium, ok, page, sh, hover, select, outDir, done } = require('./harness');
const OUT = outDir(__filename);

const zyBox = (p, word) => p.evaluate((word) => {
  const w = [...document.querySelectorAll('zy-w')].find((w) => [...w.querySelectorAll('zy-c')].map((c) => c.firstChild.nodeValue).join('') === word);
  const z = w.querySelector('zy-z'), c = w.getBoundingClientRect(), b = getComputedStyle(w, '::before');
  return { shown: getComputedStyle(z).display !== 'none', label: b.content !== 'none' && b.content !== 'normal' ? b.content : '',
    above: b.bottom === c.height + 'px', wWidth: c.width, wLeft: c.left };
}, word);
const lineW = (p) => p.evaluate(() => document.querySelector('#p1').getBoundingClientRect().height);
(async () => {
  const browser = await chromium.launch();
  let p = await page(browser);
  const onH = await lineW(p), on = await zyBox(p, '珍珠奶茶');
  ok(on.shown, 'on: zhuyin drawn');
  await p.screenshot({ path: OUT + '/1-on.png' });
  // Alt+Z → hover
  await p.mouse.move(5, 5); await p.keyboard.press('Alt+z'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.zhuyin === 'hover' && document.documentElement.classList.contains('zyh-hover')), 'Alt+Z: on → hover, saved');
  const h0 = await zyBox(p, '珍珠奶茶');
  ok(!h0.shown, 'hover: hidden while not hovered');
  ok(await lineW(p) < onH, 'hover: paragraph shorter than with zhuyin');
  await hover(p, '珍珠奶茶');
  const h1 = await zyBox(p, '珍珠奶茶');
  ok(!h1.shown && h1.label === '"ㄓㄣ ㄓㄨ ㄋㄞˇ ㄔㄚˊ"' && h1.above, 'hover: one label with the word\'s zhuyin above it ' + h1.label);
  ok(Math.abs(h1.wWidth - h0.wWidth) < 0.5 && Math.abs(h1.wLeft - h0.wLeft) < 0.5, 'hover: word did not move or widen');
  ok(!(await zyBox(p, '銀行')).label, 'hover: other words stay hidden');
  ok(await sh(p, `$('.gl').style.display === 'block' && !!$('.gl .zy, .gl .zc')`), 'hover: card still opens with zhuyin');
  await p.screenshot({ path: OUT + '/2-hover.png' });
  // Alt+Z → off
  await p.keyboard.press('Alt+z'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.zhuyin === 'off'), 'Alt+Z: hover → off');
  const o = await zyBox(p, '珍珠奶茶'); ok(!o.shown && !o.label, 'off: hidden even when hovered');
  ok(await p.evaluate(() => __menu.some(m => m[0] === 'Zhuyin on page: off → on')), 'menu shows the mode');
  await p.screenshot({ path: OUT + '/3-off.png' });
  // Alt+Z → on: restarted, drawn again
  await p.keyboard.press('Alt+z'); await p.waitForTimeout(1500);
  ok((await zyBox(p, '珍珠奶茶')).shown && Math.abs(await lineW(p) - onH) < 1, 'Alt+Z: off → on, drawn as before');
  await p.close();
  // persisted: boots in hover; panel row
  p = await page(browser, { zhuyin: 'hover' });
  ok(await p.evaluate(() => document.documentElement.classList.contains('zyh-hover')), 'saved mode applies on load');
  await hover(p, '珍珠奶茶'); await sh(p, `$('.gl .cfg').click()`); await p.waitForTimeout(200);
  ok(await sh(p, `$$('.set .row').find(r => r.textContent.startsWith('Zhuyin on page')).querySelector('.on').textContent === 'hover'`), 'panel row shows hover');
  await sh(p, `$$('.set .row').find(r => r.textContent.startsWith('Zhuyin on page')).querySelectorAll('button')[2].click()`);
  ok(await p.evaluate(() => __st.zhuyin === 'off' && document.documentElement.classList.contains('zyh-off')), 'panel button sets off');
  await p.screenshot({ path: OUT + '/4-panel.png' });
  // inline hover
  await sh(p, `$$('.set .row').find(r => r.textContent.startsWith('Zhuyin on page')).querySelectorAll('button')[1].click()`);
  await sh(p, `$$('.set .row').find(r => r.textContent.startsWith('Hover zhuyin')).querySelectorAll('button')[1].click()`);
  ok(await p.evaluate(() => __st.hoverZhuyin === 'inline' && document.documentElement.classList.contains('zyh-inline')), 'panel sets hover in the line');
  await p.keyboard.press('Escape');
  await hover(p, '珍珠奶茶', 0);
  const il = await zyBox(p, '珍珠奶茶');
  ok(il.shown && !il.label, 'inline: zhuyin drawn in the line, no label');
  ok(!(await zyBox(p, '銀行')).shown, 'inline: other words stay hidden');
  await p.screenshot({ path: OUT + '/5-inline.png' });
  await p.close();
  // popups: zhuyin by each character
  p = await page(browser, { popupZhuyin: 'beside' });
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$$('.gl .han .zc').length === 4 && !$('.gl .hw .zy')`), 'beside: card word has zhuyin by each character');
  await p.screenshot({ path: OUT + '/6-card-beside.png' });
  await select(p);
  ok(await sh(p, `$('.src').classList.contains('zb') && $$('.src .zc').length > 5 && $$('.wl .h .zc').length > 3 && $$('.wl .p').every(x => !x.textContent)`), 'beside: selected text and word list by each character');
  ok(await sh(p, `$$('.src .zc').length > 0`) && await p.evaluate(() => !/[ㄅ-ㄩ]/.test(__req.join(''))), 'beside: Google gets no zhuyin');
  await p.screenshot({ path: OUT + '/7-select-beside.png' });
  await p.close();
  await done(browser);
})();
