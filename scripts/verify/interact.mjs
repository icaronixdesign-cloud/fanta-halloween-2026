import fs from 'node:fs';
import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const log = []; track(page, log);
await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(1500);
const ok = (cond, msg) => console.log(cond ? 'PASS' : 'FAIL', msg);
const ctl = (l) => page.evaluate((l) => window.__fantaDebug.controllers.get(l)?.getSnapshot(), l);
const playingVideos = () => page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).map((v) => (v.getAttribute('src') || '').split('/').pop()));
const blackCheck = (sel) => page.evaluate((sel) => {
  const v = document.querySelector(sel); const c = document.createElement('canvas'); c.width = 96; c.height = 54;
  const g = c.getContext('2d'); g.drawImage(v, 0, 0, 96, 54); const d = g.getImageData(0, 0, 96, 54).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return +(sum / (d.length / 4)).toFixed(2);
}, sel);
const grab = (sel) => page.evaluate((sel) => { const v = document.querySelector(sel); const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 192, 108); return Array.from(g.getImageData(0, 0, 192, 108).data); }, sel);

// 1. Hero: rolagem lenta, rápida e reversa com wheel real
const heroTop = await sectionY(page, 'colecao', 0), heroEnd = await sectionY(page, 'colecao', 1);
const expectFrame = (p) => Math.round(Math.min(1, Math.max(0, (p - 0.05) / 0.88)) * 239);
await page.mouse.move(720, 450);
const playingDuring = new Set();
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 48); await sleep(45); (await playingVideos()).forEach((x) => playingDuring.add(x)); }
let s = await waitSettled(page, 'colecao');
let y = await page.evaluate(() => scrollY); let p = (y - heroTop) / (heroEnd - heroTop);
ok(s.presentedFrame === expectFrame(p) && s.revealed, `hero lento: y=${y} esperado ${expectFrame(p)} apresentado ${s.presentedFrame} (rVFC ${s.lastFrameCallbackMediaTime}) buscas ${s.seeksIssued}/${s.seeksCompleted} timeouts ${s.seekTimeouts}`);
ok(playingDuring.size === 0, `nenhum vídeo tocando durante scrub (${[...playingDuring]})`);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 700); await sleep(30); }
s = await waitSettled(page, 'colecao'); y = await page.evaluate(() => scrollY); p = (y - heroTop) / (heroEnd - heroTop);
ok(s.presentedFrame === expectFrame(p), `hero rápido: p=${p.toFixed(3)} esperado ${expectFrame(p)} apresentado ${s.presentedFrame} timeouts ${s.seekTimeouts}`);
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await sleep(25); }
s = await waitSettled(page, 'colecao'); y = await page.evaluate(() => scrollY); p = (y - heroTop) / (heroEnd - heroTop);
ok(s.presentedFrame === expectFrame(p), `hero reverso (wheel): p=${p.toFixed(3)} esperado ${expectFrame(p)} apresentado ${s.presentedFrame}`);
await scrollToY(page, 0); s = await waitSettled(page, 'colecao');
ok(s.presentedFrame === 0, `hero de volta ao topo: quadro ${s.presentedFrame} (rVFC ${s.lastFrameCallbackMediaTime}), modo ${s.mode}`);

// 2. Prova de quadro por pixels (canvas do <video> x quadro extraído pelo ffmpeg)
const grabs = {};
for (const fr of [0, 120, 239]) {
  const pp = 0.05 + (fr / 239) * 0.88; await scrollToY(page, await sectionY(page, 'colecao', pp)); s = await waitSettled(page, 'colecao');
  grabs['colecao-' + s.presentedFrame] = { presented: s.presentedFrame, px: await grab('.hero__video video') };
}

// 3. Início, meio e fim de cada sabor
const flavors = ['ghost-face-punch', 'guarana', 'maracuja', 'uva', 'laranja', 'caju'];
const names = ['Ghost Face Punch', 'Guaraná', 'Maracujá', 'Uva', 'Laranja', 'Caju'];
const stageState = () => page.evaluate(() => {
  const st = document.querySelector('.showcase__stage'); const cur = document.querySelector('.showcase__layer.is-current');
  return { flavor: st.dataset.flavor, name: document.querySelector('.showcase__name').textContent.trim(), accent: getComputedStyle(st).getPropertyValue('--accent').trim(),
    picker: document.querySelector('.flavor-picker__item[aria-current="true"] .flavor-picker__name')?.textContent, layer: cur?.getAttribute('aria-label'),
    poster: (cur?.querySelector('img')?.getAttribute('src') || '').split('/').pop(), video: (cur?.querySelector('video')?.getAttribute('src') || '').split('/').pop(),
    loaded: [...document.querySelectorAll('.showcase__layer video')].filter((v) => v.getAttribute('src')).length };
});
for (let k = 0; k < 6; k++) {
  const row = [];
  for (const q of [0.03, 0.5, 0.97]) {
    await scrollToY(page, await sectionY(page, 'sabores', (k + q) / 6)); await sleep(400);
    const c = await waitSettled(page, 'sabor:' + flavors[k], 8000); const st = await stageState();
    const lum = await blackCheck('.showcase__layer.is-current video');
    const realQ = await page.evaluate(() => { const s = document.getElementById('sabores'); const st = s.querySelector('.showcase__stage'); const range = s.offsetHeight - st.offsetHeight; const top = s.getBoundingClientRect().top + scrollY; return ((scrollY - top) / range) * 6; }) - k;
    // Quadro esperado pela coreografia (volta completa por capítulo, troca de costas no quadro 90).
    const expected = await page.evaluate(({ k, cf }) => window.__fantaDebug.probe('showcase').expectedFrame(k, cf), { k, cf: k + realQ });
    const vfcFrame = Math.round(c.lastFrameCallbackMediaTime * 30);
    const sync = st.flavor === flavors[k] && st.picker === names[k] && st.poster.includes(flavors[k]) && st.video.includes(flavors[k]) && st.name.replace(/\s+/g, '').toLowerCase() === names[k].replace(/\s+/g, '').toLowerCase();
    row.push(`q${q}:${c.presentedFrame}/${expected}${c.presentedFrame === expected ? '' : '!'} rvfc${vfcFrame} lum${lum}${sync ? '' : ' DESSINC'}`);
    if (q === 0.5) await page.screenshot({ path: `${OUT}flavor-${k}-mid.png` });
    if (!sync || c.presentedFrame !== expected || lum < 8) console.log('FAIL detail', JSON.stringify(st), JSON.stringify(c));
    if (k === 1) grabs['guarana-' + c.presentedFrame] = { presented: c.presentedFrame, px: await grab('.showcase__layer.is-current video') };
  }
  const st = await stageState();
  ok(!row.join(' ').includes('!') && !row.join(' ').includes('DESSINC'), `${names[k]}: ${row.join('  ')} | carregados ${st.loaded} | acento ${st.accent}`);
}
fs.writeFileSync(OUT + 'grabs.json', JSON.stringify(grabs));

// 4. Troca rápida pelo seletor
await scrollToY(page, await sectionY(page, 'sabores', 2.5 / 6)); await sleep(800);
for (const id of ['uva', 'caju', 'guarana', 'laranja', 'maracuja']) { await page.click(`.flavor-picker__item[href="#sabor-${id}"]`, { force: true }); await sleep(70); }
await sleep(1600);
let st = await stageState(); const cm = await waitSettled(page, 'sabor:maracuja');
ok(st.flavor === 'maracuja' && st.picker === 'Maracujá' && st.poster.includes('maracuja') && st.video.includes('maracuja') && st.loaded <= 3, `troca rápida -> ${JSON.stringify(st)} quadro ${cm.presentedFrame}`);
ok((await playingVideos()).length === 0, 'nenhum vídeo tocando após troca rápida');

// 5. Arrasto (manual) -> rolagem retoma
const box = await page.evaluate(() => { const r = document.querySelector('.showcase__drag').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const before = await ctl('sabor:maracuja');
await page.mouse.move(box.x, box.y); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x - i * 15, box.y + 1); await sleep(16); }
await sleep(250); await page.mouse.up(); await sleep(900);
let m = await ctl('sabor:maracuja');
ok(m.mode === 'manual' && m.presentedFrame !== before.presentedFrame && m.paused, `arrasto: modo ${m.mode}, quadro ${before.presentedFrame}->${m.presentedFrame}, pausado ${m.paused}`);
const sliderVal = await page.$eval('.spin-controls input', (i) => [i.value, i.getAttribute('aria-valuetext')]);
ok(+sliderVal[0] === m.presentedFrame, `slider acompanha o arrasto: ${sliderVal}`);
await page.mouse.wheel(0, 120); await sleep(200);
const ret = await ctl('sabor:maracuja'); await sleep(900);
m = await waitSettled(page, 'sabor:maracuja');
ok(['returning', 'scroll'].includes(ret.mode) && m.mode === 'scroll' && m.presentedFrame === m.targetFrame, `após rolar: ${ret.mode} -> ${m.mode}, quadro ${m.presentedFrame} = alvo ${m.targetFrame}`);

// 6. Teclado no slider
await page.focus('.spin-controls input'); const f0 = +(await page.$eval('.spin-controls input', (i) => i.value));
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
await sleep(600); m = await waitSettled(page, 'sabor:maracuja');
ok(m.mode === 'manual' && m.presentedFrame === Math.min(179, f0 + 6), `teclado no slider: ${f0} -> ${m.presentedFrame} (${m.mode})`);
const outline = await page.$eval('.spin-controls input', (i) => getComputedStyle(i).outlineStyle + ' ' + getComputedStyle(i).outlineColor);
ok(!outline.startsWith('none'), `foco visível no slider: ${outline}`);

// 7. Reprodução contínua
await page.click('.icon-button.is-play'); await sleep(1200);
const a = await ctl('sabor:maracuja'); await sleep(500); let b = await ctl('sabor:maracuja');
ok(a.mode === 'play' && !b.paused && b.currentTime !== a.currentTime, `reprodução: modo ${a.mode}, tempo ${a.currentTime.toFixed(2)}->${b.currentTime.toFixed(2)}, tocando ${await playingVideos()}`);
await page.mouse.wheel(0, 150); await sleep(400); b = await ctl('sabor:maracuja');
ok(b.mode === 'play' && b.seeksIssued === a.seeksIssued, `rolar dentro do capítulo não disputa o tempo: modo ${b.mode}, buscas ${a.seeksIssued}->${b.seeksIssued}`);
await page.click('.icon-button.is-play'); await sleep(300); b = await ctl('sabor:maracuja');
ok(b.mode === 'manual' && b.paused, `pausa: modo ${b.mode}, pausado ${b.paused}`);
await page.click('.icon-button.is-play'); await sleep(800);
await page.click('.flavor-picker__item[href="#sabor-uva"]', { force: true }); await sleep(1200);
b = await ctl('sabor:maracuja');
ok(b.paused && (await playingVideos()).length === 0, `trocar de sabor pausa a reprodução anterior (modo ${b.mode})`);

// 8. Teclado: cabeçalho -> sabores -> seletor (página recarregada, foco limpo)
await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(1200);
await page.keyboard.press('Tab'); const skip = await page.evaluate(() => document.activeElement.textContent.trim());
ok(skip === 'Pular para os sabores', `primeiro Tab: "${skip}"`);
await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
const navFocus = await page.evaluate(() => document.activeElement.textContent.trim());
await page.keyboard.press('Enter'); await sleep(900);
const after = await page.evaluate(() => ({ y: scrollY, focus: document.activeElement.className, top: document.getElementById('sabores').getBoundingClientRect().top }));
ok(navFocus === 'Sabores' && Math.abs(after.top) < 4 && String(after.focus).includes('showcase__name'), `Enter em "${navFocus}" -> seção sabores topo ${after.top.toFixed(0)}, foco ${after.focus}`);
for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
const pf = await page.evaluate(() => document.activeElement.getAttribute('href'));
await page.keyboard.press('Enter'); await sleep(1300); st = await stageState();
ok(pf && st.flavor === pf.replace('#sabor-', ''), `seleção por teclado ${pf} -> exibido ${st.flavor}`);

ok(log.length === 0, 'console/rede sem erros: ' + JSON.stringify(log));
await browser.close();
