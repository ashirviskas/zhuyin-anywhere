// Settings panel and menu, target languages, hide meaning, read-aloud key (TASK-002).
const { chromium, ok, page, sh, tab, hover, select, outDir, done } = require('./harness');
const OUT = outDir(__filename);

(async () => {
  const browser = await chromium.launch();
  let p;

  // 1. English default: CC-CEDICT card, gear present, no Google request for the card
  p = await page(browser);
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$('.gl').style.display === 'block' && !!$('.gl .cfg')`), 'en: card open with ⚙');
  ok(await sh(p, `$$('.gl .ent').length > 0 && !$('.gl .tl')`), 'en: CC-CEDICT senses, no Google line');
  ok(!(await p.evaluate(() => __req.length)), 'en: card made no request');
  await p.screenshot({ path: OUT + '/1-card-en.png' });
  // gear on the card → settings panel, card hidden
  await sh(p, `$('.gl .cfg').click()`); await p.waitForTimeout(200);
  ok(await sh(p, `$('.set').style.display === 'block' && $('.gl').style.display === 'none'`), 'card ⚙ opens panel, hides card');
  ok(await sh(p, `$$('.set .tabs button').map(b => b.textContent).join() === 'Page,Popups,Translate,Learn' && $('.set .tabs .on').textContent === 'Page'`), 'panel has 4 tabs, Page first');
  ok(await sh(p, `$$('.set .row').length === 7`), 'Page tab: 7 rows');
  await p.screenshot({ path: OUT + '/2-settings.png' });
  // choose Lithuanian via the select, dark theme via button
  await tab(p, 'Translate');
  ok(await sh(p, `$$('.set .row').map(r => r.firstChild.textContent).join() === 'Translate to,Second language,Translator,Cache, MB per site'`), 'Translate tab rows');
  await sh(p, `(() => { const s = $$('.set select')[0]; s.value = 'lt'; s.dispatchEvent(new Event('change')); })()`);
  ok(await p.evaluate(() => __st.targetLang === 'lt'), 'select stores targetLang=lt');
  ok(await sh(p, `$('.set .tabs .on').textContent === 'Translate'`), 'panel stays on its tab after a change');
  await tab(p, 'Popups');
  await sh(p, `$$('.set .row').find(r => r.textContent.startsWith('Popup theme')).querySelectorAll('button')[1].click()`);
  ok(await p.evaluate(() => __st.theme === 'dark'), 'theme button stores dark');
  ok(await sh(p, `__sh.host.dataset.theme === 'dark' && $$('.set .row').find(r => r.textContent.startsWith('Popup theme')).querySelector('.on').textContent === 'dark'`), 'theme applied, panel re-rendered');
  ok(await p.evaluate(() => __menu.some(m => m[0] === 'Translate to: Lithuanian (change…)') && __menu[0][0] === 'Settings…'), 'menu rebuilt with new values, Settings… first');
  ok(await p.evaluate(() => !__menu.some(m => /^(Look|Most common|Style|Palette|Parts on word cards)/.test(m[0]))), 'menu has no Learn-only options');
  await p.screenshot({ path: OUT + '/3-settings-dark.png' });
  await p.keyboard.press('Escape');
  ok(await sh(p, `$('.set').style.display === 'none'`), 'Esc closes panel');
  await p.close();

  // 2. Lithuanian card: Google, batched word + chars in one request
  p = await page(browser, { targetLang: 'lt' });
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$('.gl .tl .t').textContent === 'lt:珍珠奶茶'`), 'lt: card word line');
  ok(await sh(p, `$$('.gl .part .m').map(m => m.textContent).join() === 'lt:珍,lt:珠,lt:奶,lt:茶'`), 'lt: character lines');
  ok(await sh(p, `!$('.gl .ent')`), 'lt: no CC-CEDICT senses');
  ok(await p.evaluate(() => __req.length === 1), 'lt: one request for word + chars');
  await p.screenshot({ path: OUT + '/4-card-lt.png' });
  await p.mouse.move(630, 590); await p.waitForTimeout(800);
  await hover(p, '珍珠奶茶');
  ok(await p.evaluate(() => __req.length === 1), 'lt: second hover served from cache');
  await p.close();

  // 3. Two languages, selection popup + word list
  p = await page(browser, { targetLang: 'lt', targetLang2: 'en' });
  await select(p);
  ok(await sh(p, `$$('.tx .en').map(e => e.textContent).join('|') === 'LTlt:我們先去銀行換錢|ENen:我們先去銀行換錢'`), 'lt+en: two tagged lines');
  ok(await sh(p, `$$('.wl .d').length > 2 && $$('.wl .d').every(d => d.children.length === 2 && d.children[0].textContent.startsWith('lt:') && !d.children[1].textContent.startsWith('en:'))`), 'word list: Google lt + CC-CEDICT en');
  ok(await sh(p, `$('.via').textContent === 'Google · Lithuanian + English'`), 'via line');
  await sh(p, `$('.cp').click()`);
  ok(await p.evaluate(() => __clip === 'lt:我們先去銀行換錢\nen:我們先去銀行換錢'), 'copy copies both lines');
  await p.screenshot({ path: OUT + '/5-select-lt-en.png' });
  // the popup's own ⚙: panel beside the popup, popup stays
  await sh(p, `$('.tr .cfg').click()`); await p.waitForTimeout(200);
  ok(await sh(p, `$('.set').style.display === 'block' && $('.tr').style.display === 'block'`), 'popup ⚙ opens panel, popup stays');
  await tab(p, 'Translate');
  await sh(p, `(() => { const s = $$('.set select')[1]; s.value = ''; s.dispatchEvent(new Event('change')); })()`);
  await p.waitForTimeout(300);
  ok(await sh(p, `$$('.tx .en').length === 1 && $('.tx .en').textContent === 'lt:我們先去銀行換錢'`), 'second language → none re-translates open popup');
  await p.screenshot({ path: OUT + '/6-panel-beside-popup.png' });
  await p.close();

  // 4. Hide meaning: blurred until Shift held; R reads aloud the open popup, also with Shift held
  p = await page(browser, { hideMeaning: true, targetLang: 'lt' });
  await select(p);
  ok(await sh(p, `__sh.host.hasAttribute('data-hide') && getComputedStyle($('.tx .en')).filter.includes('blur')`), 'hide: blurred');
  ok(await sh(p, `getComputedStyle($('.src')).filter === 'none' && getComputedStyle($('.wl .p')).filter === 'none'`), 'hide: Chinese and readings stay sharp');
  ok(await sh(p, `$('.via').textContent.endsWith('hold Shift')`), 'hide: hint');
  await p.screenshot({ path: OUT + '/7-hidden.png' });
  await p.keyboard.down('Shift'); await p.waitForTimeout(200);
  ok(await sh(p, `!__sh.host.hasAttribute('data-hide')`), 'Shift held → revealed');
  await p.screenshot({ path: OUT + '/8-revealed.png' });
  await p.keyboard.up('Shift'); await p.waitForTimeout(50);
  ok(await sh(p, `__sh.host.hasAttribute('data-hide')`), 'Shift released → hidden again');
  await p.keyboard.press('Shift+KeyR'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __req.some(u => u.includes('translate_tts') && decodeURIComponent(u).includes('我們先去銀行換錢'))), 'R (Shift held) reads the popup text');
  await p.close();

  // 5. bare R: nothing without a popup, page keeps the key; not while typing
  p = await page(browser);
  await p.evaluate(() => { window.__pageKeys = 0; addEventListener('keydown', () => __pageKeys++); });
  await p.keyboard.press('KeyR'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => __pageKeys === 1 && !__req.length), 'R with no popup goes to the page');
  await hover(p, '珍珠奶茶');
  await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tin'; document.body.prepend(i); });
  await p.focus('#tin'); await p.keyboard.press('KeyR'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !__req.some(u => u.includes('translate_tts'))), 'R while typing is not read aloud');
  await p.evaluate(() => document.activeElement.blur());
  await p.keyboard.press('KeyR'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __req.some(u => u.includes('translate_tts')) && __pageKeys === 2), 'R on an open card reads it, page does not get it');
  await p.close();

  // 6. Alt+K configured: bare K and Alt+R do nothing, Alt+K reads the card word
  p = await page(browser, { speakKey: 'Alt+K' });
  await hover(p, '珍珠奶茶');
  await p.keyboard.press('Alt+KeyR'); await p.waitForTimeout(200);
  await p.keyboard.press('KeyK'); await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => __req.some(u => u.includes('translate_tts')))), 'Alt+R and bare K ignored when key is Alt+K');
  await p.keyboard.press('Alt+KeyK'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __req.some(u => u.includes('translate_tts') && decodeURIComponent(u).includes('q=珍珠奶茶'))), 'Alt+K reads the card word');
  await p.close();

  // 7. dark, two languages, card (screenshot only)
  p = await page(browser, { targetLang: 'lt', targetLang2: 'en' }, 'dark');
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$('.gl .tl .lg').textContent === 'LT' && $('.gl .ent .lg').textContent === 'EN'`), 'card tags LT and EN');
  await p.screenshot({ path: OUT + '/9-card-lt-en-dark.png' });
  await p.close();

  // 8. Popup size: text, icons and boxes scale; the card stays on screen; the slider changes the open panel at once
  const sizes = (p) => sh(p, `(() => { const g = $('.gl'), r = g.getBoundingClientRect(); return { font: parseFloat(getComputedStyle(g).fontSize),
    icon: $('.gl svg')?.getBoundingClientRect().width, in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; })()`);
  p = await page(browser);
  await hover(p, '珍珠奶茶');
  const normal = await sizes(p);
  await p.close();
  p = await page(browser, { popupScale: 150 });
  await hover(p, '珍珠奶茶');
  const big = await sizes(p);
  ok(Math.abs(big.font - normal.font * 1.5) < 0.1 && Math.abs(big.icon - normal.icon * 1.5) < 0.5, `popup size 150 %: text ${normal.font} → ${big.font} px, icons ${normal.icon} → ${big.icon} px`);
  ok(big.in, 'popup size 150 %: card still on screen');
  await p.screenshot({ path: OUT + '/10-card-150.png' });
  await p.evaluate(() => __menu.find(m => m[0] === 'Settings…')[1]()); await p.waitForTimeout(200);
  await tab(p, 'Popups');
  await sh(p, `(() => { const s = $$('.set .row').find(r => r.firstChild.textContent === 'Popup size').querySelector('input'); s.value = 80; s.dispatchEvent(new Event('change')); })()`);
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => __st.popupScale === 80) && await sh(p, `parseFloat(getComputedStyle($('.set')).fontSize) === 13 * 0.8`), 'slider: 80 % stored, panel text smaller at once');
  ok(await sh(p, `(() => { const r = $('.set').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; })()`), 'panel on screen');
  await p.screenshot({ path: OUT + '/11-settings-80.png' });
  await p.close();

  // 9. Panel from a card's ⚙: as tall as its tab wherever the card was, not capped to the room beside the card
  for (const pad of [0, 120, 260]) {
    p = await page(browser);
    await p.evaluate((h) => { const s = document.createElement('div'); s.style.height = h + 'px'; document.body.prepend(s); }, pad);
    await p.waitForTimeout(300);
    await hover(p, '珍珠奶茶');
    await sh(p, `$('.gl .cfg').click()`); await p.waitForTimeout(200);
    const s = await sh(p, `(() => { const e = $('.set'), r = e.getBoundingClientRect(); return { h: r.height, sh: e.scrollHeight, in: r.top >= 0 && r.bottom <= innerHeight }; })()`);
    ok(s.sh <= s.h + 1 && s.in, `card ${pad}px down: panel full height on screen (${s.h.toFixed(0)} of ${s.sh} px)`);
    if (pad === 120) await p.screenshot({ path: OUT + '/12-panel-from-card.png' });
    await p.close();
  }

  // 10. Double-tap the reveal key on an open popup switches Hide meaning; not without a popup, not Shift, letter, Shift
  p = await page(browser, { targetLang: 'lt' });
  await p.keyboard.press('Shift'); await p.keyboard.press('Shift'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !__st.hideMeaning), 'double Shift with nothing open: no change');
  await select(p);
  await p.keyboard.press('Shift'); await p.keyboard.press('Shift'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.hideMeaning === true) && await sh(p, `__sh.host.hasAttribute('data-hide') && $('.via').textContent.endsWith('hold Shift')`), 'double Shift: Hide meaning on, blurred');
  await p.keyboard.press('Shift'); await p.keyboard.press('Shift+KeyA'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => __st.hideMeaning === true), 'Shift, Shift+A: no change');
  await p.keyboard.down('Shift'); await p.waitForTimeout(600); await p.keyboard.up('Shift'); await p.keyboard.press('Shift'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => __st.hideMeaning === true), 'Shift held to read, then a tap: no change');
  await p.waitForTimeout(500);
  await p.keyboard.press('Shift'); await p.keyboard.press('Shift'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.hideMeaning === false) && await sh(p, `!__sh.host.hasAttribute('data-hide') && !$('.via').textContent.includes('hold')`), 'double Shift again: off, shown');
  await p.close();
  p = await page(browser, { hideMeaning: true });
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$('.gl .foot').textContent.endsWith('hold Shift')`), 'card: hold hint');
  await p.keyboard.press('Shift'); await p.keyboard.press('Shift'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.hideMeaning === false) && await sh(p, `$('.gl').style.display === 'block' && !$('.gl .foot').textContent.includes('hold')`), 'double Shift on a card: off, card stays, hint gone');
  await p.close();

  await done(browser);
})();
