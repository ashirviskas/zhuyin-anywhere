// Learn tab (TASK-004): settings tabs and live previews, tinted characters, My characters with export/import,
// character parts on the word card and clicking into them, no word cards behind the translation popup.
const { VERSION, chromium, ok, page, sh, tab, hover, select, outDir, done } = require('./harness');
const OUT = outDir(__filename);

// Centre of an element in the popup's shadow root, for real pointer moves.
const at = (p, js) => sh(p, `(() => { const e = ${js}; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const cells = (p, ch) => p.evaluate((ch) => [...document.querySelectorAll('zy-c')].filter(c => c.firstChild.textContent === ch)
  .map(c => ({ t: c.getAttribute('data-t'), col: c.style.getPropertyValue('--zyt') })), ch);
const learn = async (p) => { await p.evaluate(() => __menu.find(m => m[0] === 'Settings…')[1]()); await p.waitForTimeout(200); await tab(p, 'Learn'); };

(async () => {
  const browser = await chromium.launch();
  let p;

  // 1. Top 100 tinted, character only, box; the same character gets the same colour everywhere
  p = await page(browser, { tintTop: 100 });
  const de = await cells(p, '的');
  ok(de.length > 0 && de.every(c => c.t === 't' && c.col.startsWith('oklch(') && c.col === de[0].col), 'top 100: every 的 tinted, same colour');
  ok((await cells(p, '珍')).every(c => !c.t), 'top 100: 珍 (rare) not tinted');
  ok(await p.evaluate(() => { const h = document.documentElement.classList; return h.contains('zyh-t-box') && h.contains('zyh-tc'); }), 'box style, covers character');
  ok(await p.evaluate(() => {
    const c = [...document.querySelectorAll('zy-c[data-t]')][0], b = getComputedStyle(c.querySelector('zy-h'), '::before');
    return b.backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(c).backgroundImage === 'none';
  }), 'the glyph is tinted, not its zhuyin');
  ok(await p.evaluate(() => {   // a box no taller than the line: boxes on neighbouring lines don't touch
    const h = document.querySelector('#p1 zy-c[data-t] zy-h');
    return parseFloat(getComputedStyle(h, '::before').height) < parseFloat(getComputedStyle(document.querySelector('#p1')).lineHeight) * 0.8;
  }), 'box is glyph-tall, not line-tall');
  const layout = (p) => p.evaluate(() => JSON.stringify([...document.querySelectorAll('main zy-c')].map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })));
  const plain = await page(browser);
  ok(await layout(p) === await layout(plain), 'tints move nothing: every character where it is without them');
  await plain.close();
  await p.screenshot({ path: OUT + '/1-top100.png' });
  await p.close();

  // dark page: darker tints
  p = await page(browser, { tintTop: 100 }, 'dark');
  ok(+/oklch\(([\d.]+)/.exec((await cells(p, '的'))[0].col)[1] < 0.6, 'dark page: darker tint');
  await p.screenshot({ path: OUT + '/2-top100-dark.png' });
  await p.close();

  // 2. Learn tab: hovering a look previews it (top 100, as nothing is tinted yet), leaving restores, clicking stores
  p = await page(browser);
  await learn(p);
  ok(await sh(p, `$$('.set .sec').map(s => s.textContent).join() === 'Character parts,Tint characters,Practice'`), 'Learn tab sections');
  let xy = await at(p, `$$('.set .seg button').find(b => b.textContent === 'Highlighter')`);
  await p.mouse.move(xy.x, xy.y); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.documentElement.classList.contains('zyh-t-marker') && !!document.querySelector('zy-c[data-t]')), 'hover a look: previewed on the page');
  ok(await p.evaluate(() => !('tintStyle' in __st)), 'preview stores nothing');
  await p.screenshot({ path: OUT + '/3-preview-highlighter.png' });
  await p.mouse.move(5, 590); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.documentElement.classList.contains('zyh-t-box') && !document.querySelector('zy-c[data-t]')), 'leave: back to the stored look, nothing tinted');
  xy = await at(p, `$$('.set .pal').find(b => b.textContent === 'Ocean')`);
  await p.mouse.move(xy.x, xy.y); await p.waitForTimeout(150);
  const ocean = (await cells(p, '的'))[0].col;
  ok(/oklch\([\d.]+ [\d.]+ (1[7-9]\d|2[0-6]\d)/.test(ocean), 'hover a palette: Ocean hues previewed');
  await p.mouse.move(5, 590);
  xy = await at(p, `$$('.set .seg button').find(b => b.textContent === 'Coloured text')`);
  await p.mouse.move(xy.x, xy.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(150);
  ok(await p.evaluate(() => __st.tintStyle === 'ink' && __st.tintPalette === 'vivid' && __st.tintStrength === 100), 'click a look: stored');
  ok(await sh(p, `$$('.set .seg button').find(b => b.textContent === 'Coloured text').classList.contains('on')`), 'clicked look shown as on');
  await sh(p, `(() => { const i = $$('.set .row').find(r => r.firstChild.textContent === 'Most common').querySelector('input'); i.value = 250; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); })()`);
  ok(await p.evaluate(() => __st.tintTop === 250 && !!document.querySelector('zy-c[data-t]')), 'Most common slider: stored, applied');
  ok(await sh(p, `(() => { const r = $('.set').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && $('.set').scrollHeight > $('.set').clientHeight; })()`), 'Learn tab: panel on screen, scrolls inside');
  await p.screenshot({ path: OUT + '/4-learn-tab.png' });
  await p.close();

  // 3. My characters: highlighter on the card, chips, additive add, remove, export, import
  p = await page(browser);
  await hover(p, '吃', 0);
  ok(await sh(p, `!!$('.gl .mk') && !$('.gl .mk').classList.contains('on')`), 'one-character card has the highlighter');
  await sh(p, `$('.gl .mk').click()`); await p.waitForTimeout(150);
  ok(await p.evaluate(() => __st.myChars === '吃'), 'highlighter adds 吃 to My characters');
  ok((await cells(p, '吃')).every(c => c.t === 'm'), 'every 吃 on the page marked as mine');
  ok(await sh(p, `$('.gl .mk').classList.contains('on') && $('.gl .han [data-t="m"]') !== null`), 'card redrawn: highlighter on, headword tinted');
  await p.screenshot({ path: OUT + '/5-marked.png' });
  await learn(p);
  ok(await sh(p, `$$('.set .chip b').map(b => b.textContent).join('') === '吃'`), 'chip for 吃');
  await sh(p, `(() => { const i = $('.set .mtools input'); i.value = '我們吃'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  ok(await p.evaluate(() => __st.myChars === '吃我們'), 'add: only new characters appended');
  ok(await sh(p, `$('.set .mine .hint').textContent === 'Added 2 new characters (1 already there)'`), 'add: note says what happened');
  await sh(p, `$$('.set .chip').find(c => c.textContent.startsWith('我')).querySelector('button').click()`);
  ok(await p.evaluate(() => __st.myChars === '吃們'), 'chip × removes');
  await sh(p, `$$('.set .mtools button').find(b => b.textContent === 'Export').click()`);
  ok(await p.evaluate(() => __clip.split('\n')[1] === '吃們'), 'export: copied, characters on line 2');
  await p.locator('#zyh-host input[type=file]').setInputFiles({ name: 'mine.txt', mimeType: 'text/plain', buffer: Buffer.from('# zhuyin anywhere: My characters\n們天\n') });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => __st.myChars === '吃們天'), 'import adds (天), keeps the rest, skips the # line');
  await p.screenshot({ path: OUT + '/6-my-characters.png' });
  await p.close();

  // 4. Parts: one-character card, click a part, crumb back; a word's character row opens its card
  p = await page(browser);
  await hover(p, '吃', 0);
  ok(await sh(p, `$('.gl .comp .how .k').textContent === '形聲'`), 'parts: 吃 is meaning + sound');
  ok(await sh(p, `$$('.gl .comp .cr').map(r => r.querySelector('.g').textContent.slice(0, 1) + ':' + r.querySelector('.r').textContent).join() === '口:meaning,乞:sound ㄑㄧˇ → ㄔ'`), 'parts: 口 meaning, 乞 sound with zhuyin');
  ok(await sh(p, `$('.gl .comp .org a').href === 'https://en.wiktionary.org/wiki/%E5%90%83'`), 'origin links to Wiktionary');
  ok(await sh(p, `$('.gl .foot').textContent.includes('Wiktionary')`), 'sources in the footer');
  await p.screenshot({ path: OUT + '/7-parts.png' });
  xy = await at(p, `$$('.gl .comp .cr')[1]`);
  await p.mouse.move(xy.x, xy.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await sh(p, `$('.gl').style.display === 'block' && $('.gl .hw .han').textContent.startsWith('乞') && $('.gl .crumb').textContent === '‹吃 › 乞'`), 'click 乞: its card, crumb 吃 › 乞');
  await p.screenshot({ path: OUT + '/8-part-card.png' });
  xy = await at(p, `$('.gl .crumb button')`);
  await p.mouse.move(xy.x, xy.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await sh(p, `$('.gl .hw .han').textContent.startsWith('吃') && !$('.gl .crumb')`), '‹ goes back to 吃');
  await p.mouse.move(630, 590); await p.waitForTimeout(900);
  await hover(p, '銀行', 0);
  ok(await sh(p, `$$('.gl .parts .part.go').length === 2`), 'word card: character rows open their cards');
  xy = await at(p, `$$('.gl .parts .part')[0]`);
  await p.mouse.move(xy.x, xy.y); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
  ok(await sh(p, `$('.gl .crumb').textContent === '‹銀行 › 銀' && $$('.gl .comp .cr').length === 2`), 'click 銀: its card with parts, crumb 銀行 › 銀');
  await p.screenshot({ path: OUT + '/9-word-to-char.png' });
  await p.close();

  // parts off: no parts section, rows not clickable
  p = await page(browser, { parts: false });
  await hover(p, '吃', 0);
  ok(await sh(p, `!$('.gl .comp')`), 'parts off: no parts section');
  await p.close();

  // translate parts: English kept, Lithuanian after it
  p = await page(browser, { targetLang: 'lt', targetLang2: 'en', partsLang: true });
  await hover(p, '吃', 0); await p.waitForTimeout(300);
  ok(await sh(p, `$$('.gl .comp .cr .m').map(m => m.textContent).join('|') === 'mouth · lt:mouth|to beg · lt:to beg'`), 'translate parts: English, then Lithuanian');
  ok(await p.evaluate(() => __req.some(u => u.includes('sl=en&tl=lt'))), 'part meanings translated from English');
  await p.close();

  // 5. With the translation open, hovering the page opens no word card
  p = await page(browser);
  await select(p);
  await hover(p, '珍珠奶茶');
  ok(await sh(p, `$('.tr').style.display === 'block' && $('.gl').style.display !== 'block'`), 'translation open: no word card on hover');
  await p.close();

  // 6. What's new: once after an update, on the first page the script runs on
  p = await page(browser, { seenVersion: '0.8.0' });
  ok(await sh(p, `$('.news').style.display === 'block' && $('.news a').href.endsWith('CHANGELOG.md#' + '${VERSION}'.replaceAll('.', ''))`), "what's new: shown after an update, links to the changelog");
  await p.screenshot({ path: OUT + '/10-whats-new.png' });
  await sh(p, `$$('.news button').find(b => b.textContent === 'Open Learn settings').click()`); await p.waitForTimeout(200);
  ok(await p.evaluate((v) => __st.seenVersion === v, VERSION) && await sh(p, `$('.news').style.display === 'none' && $('.set .tabs .on').textContent === 'Learn'`), "what's new: button opens the Learn tab, note put away for good");
  await p.close();
  p = await page(browser);
  ok(await p.evaluate(() => typeof __sh === 'undefined' || __sh.querySelector('.news').style.display !== 'block'), "what's new: not shown once seen");
  await p.close();

  // 7. Update available: a newer @version on main, checked at most once a day
  const noNote = (p) => p.evaluate(() => typeof __sh === 'undefined' || __sh.querySelector('.news').style.display !== 'block');
  p = await page(browser, { updateCheck: 0, __remote: '99.0.0' });
  ok(await p.evaluate(() => __req.some(u => u.endsWith('/main/zhuyin-anywhere.user.js')) && Date.now() - __st.updateCheck < 60000), 'update: main checked, time stored');
  ok(await sh(p, `$('.news').style.display === 'block' && $('.news .ttl').textContent.includes('99.0.0') && $('.news a').href.endsWith('/main/zhuyin-anywhere.user.js')`), 'update: newer version → note with Install');
  await p.screenshot({ path: OUT + '/11-update.png' });
  await sh(p, `$$('.news button').find(b => b.textContent === 'Skip this version').click()`);
  ok(await p.evaluate(() => __st.skipVersion === '99.0.0') && await sh(p, `$('.news').style.display === 'none'`), 'update: Skip this version stored');
  await p.close();
  p = await page(browser, { updateCheck: 0, __remote: '99.0.0', skipVersion: '99.0.0' });
  ok(await noNote(p), 'update: a skipped version stays quiet');
  await p.close();
  p = await page(browser, { updateCheck: 0 });
  ok(await noNote(p), 'update: same version, no note');
  await p.close();
  p = await page(browser, { __remote: '99.0.0' });
  ok(await p.evaluate(() => !__req.some(u => u.endsWith('.user.js'))) && await noNote(p), 'update: checked today already, no request');
  await p.close();

  await done(browser);
})();
