import fs from 'node:fs';
import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const log = []; track(page, log);
await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(1500);
const ok = (cond, msg) => console.log(cond ? 'PASS' : 'FAIL', msg);
const ctl = (l) => page.evaluate((l) => window.__fantaDebug.controllers.get(l)?.getSnapshot(), l);
const playingVideos = () => page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).map((v) => v.dataset.src || (v.getAttribute('src') || '').split('/').pop()));
const blackCheck = (sel) => page.evaluate((sel) => {
  const v = document.querySelector(sel); const c = document.createElement('canvas'); c.width = 96; c.height = 54;
  const g = c.getContext('2d'); g.drawImage(v, 0, 0, 96, 54); const d = g.getImageData(0, 0, 96, 54).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return +(sum / (d.length / 4)).toFixed(2);
}, sel);
const grab = (sel) => page.evaluate((sel) => { const v = document.querySelector(sel); const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 192, 108); return Array.from(g.getImageData(0, 0, 192, 108).data); }, sel);

// 1. Hero 3D (Jack): carrega, um único canvas WebGL, chamada sai com o scroll e volta ao topo
const heroState = () => page.evaluate(() => {
  const st = document.querySelector('.jack-hero__stage');
  const cs = getComputedStyle(st);
  const cv = st.querySelectorAll('canvas');
  return { state: st.dataset.state, canvases: cv.length, w: cv[0]?.clientWidth, h: cv[0]?.clientHeight,
    textO: +cs.getPropertyValue('--text-o'), endO: +cs.getPropertyValue('--end-o'), sticky: cs.position };
});
await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 30000 });
let h = await heroState();
ok(h.state === 'ready' && h.canvases === 1 && h.w > 0 && h.h > 0 && h.sticky === 'sticky', `hero 3D pronto: ${JSON.stringify(h)}`);
await page.mouse.move(720, 450);
const playingDuring = new Set();
for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 60); await sleep(40); (await playingVideos()).forEach((x) => playingDuring.add(x)); }
await sleep(400); h = await heroState();
ok(h.textO < 0.5, `chamada saindo com o scroll (opacidade ${h.textO})`);
ok(playingDuring.size === 0, `nenhum vídeo tocando durante o hero (${[...playingDuring]})`);
await scrollToY(page, await sectionY(page, 'colecao', 1)); await sleep(800); h = await heroState();
ok(h.endO > 0.9 && h.canvases === 1, `fim do hero: legenda final visível (${h.endO}), canvases ${h.canvases}`);
// vitrine: seta, teclado e estado do seletor
const pickName = () => page.evaluate(() => document.querySelector('.jack-hero__name')?.textContent.trim());
const pickState = () => page.evaluate(() => { const st = document.querySelector('.jack-hero__stage'); const pk = document.querySelector('.jack-hero__picker'); return { phase: st.dataset.phase, inert: pk.inert }; });
await scrollToY(page, await sectionY(page, 'colecao', 0.9)); await sleep(1200);
let pk = await pickState();
ok(pk.phase === 'pick' && !pk.inert && (await pickName()) === 'Fanta Laranja', `vitrine ativa com Laranja na mão (${JSON.stringify(pk)})`);
await page.click('.jack-hero__arrow[aria-label="Próximo sabor"]'); await sleep(300);
ok((await pickName()) === 'Fanta Caju', `seta → próximo sabor (${await pickName()})`);
await sleep(2400); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(300);
ok((await pickName()) === 'Fanta Uva', `teclado ← ← volta dois sabores (${await pickName()})`);
await sleep(3000);
// segurar sobre o Jack: bebe enquanto segura; soltar para; botão "Segure para um gole" pelo teclado
const drinkState = () => page.evaluate(() => document.querySelector('.jack-hero__stage').dataset.drinking);
await page.mouse.move(720, 380); await page.mouse.down(); await sleep(700);
const held = await drinkState();
await page.mouse.up(); await sleep(150);
ok(held === 'true' && (await drinkState()) === 'false', `segurar no Jack bebe e soltar para (${held} → ${await drinkState()})`);
await page.focus('.jack-hero__more.is-hold'); await page.keyboard.down('Space'); await sleep(400);
const keyHeld = await drinkState();
await page.keyboard.up('Space'); await sleep(150);
ok(keyHeld === 'true' && (await drinkState()) === 'false', `gole pelo teclado (Espaço segurado) (${keyHeld} → ${await drinkState()})`);
await scrollToY(page, await sectionY(page, 'colecao', 0.4)); await sleep(600); pk = await pickState();
ok(pk.phase !== 'pick' && pk.inert, `fora da vitrine o seletor fica inerte (${JSON.stringify(pk)})`);
await scrollToY(page, 0); await sleep(800); h = await heroState();
ok(h.textO > 0.99, `hero de volta ao topo: chamada visível (${h.textO})`);
// botões da chamada lado a lado; o secundário rola o hero até a vitrine e põe o foco na seta
const ctas = await page.evaluate(() => [...document.querySelectorAll('.jack-hero__cta')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), y: Math.round(r.top) }; }));
ok(ctas.length === 2 && ctas[0].y === ctas[1].y && ctas.every((c) => c.w < 300), `dois botões lado a lado, na largura do texto (${JSON.stringify(ctas)})`);
await page.click('.jack-hero__cta.is-secondary'); await sleep(3800);
pk = await pickState();
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
ok(pk.phase === 'pick' && !pk.inert && focused === 'Próximo sabor', `"Ver a coleção" desliza até a vitrine e foca a seta (${JSON.stringify(pk)}, foco ${focused})`);
await scrollToY(page, 0); await sleep(800);
const grabs = {};

// 3. Início, meio e fim de cada sabor
const flavors = ['ghost-face-punch', 'guarana', 'maracuja', 'uva', 'laranja', 'caju'];
const names = ['Ghost Face Punch', 'Guaraná', 'Maracujá', 'Uva', 'Laranja', 'Caju'];
const stageState = () => page.evaluate(() => {
  const st = document.querySelector('.showcase__stage'); const cur = document.querySelector('.showcase__layer.is-current');
  return { flavor: st.dataset.flavor, name: document.querySelector('.showcase__name').textContent.trim(), accent: getComputedStyle(st).getPropertyValue('--accent').trim(),
    picker: document.querySelector('.flavor-picker__item[aria-current="true"] .flavor-picker__name')?.textContent, layer: cur?.getAttribute('aria-label'),
    poster: (cur?.querySelector('img')?.getAttribute('src') || '').split('/').pop(), video: cur?.querySelector('video')?.dataset.src || (cur?.querySelector('video')?.getAttribute('src') || '').split('/').pop(),
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
ok(st.flavor === 'maracuja' && st.picker === 'Maracujá' && st.poster.includes('maracuja') && st.video.includes('maracuja') && st.loaded <= 6, `troca rápida -> ${JSON.stringify(st)} quadro ${cm.presentedFrame}`);
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

// 9. Jack da seção de sabores: entra andando e fica admirando a lata
await scrollToY(page, await sectionY(page, 'sabores', 2.5 / 6)); await sleep(1500);
const jack = await page.evaluate(() => document.querySelector('.showcase__jack')?.dataset.ready);
ok(jack === 'true', `Jack admirando no canto dos sabores (${jack})`);
// ...parado no vão entre o numeral e a lata (borda da lata no ponto mais à esquerda do giro: 0,366 do quadro)
await page.waitForFunction(() => window.__fantaDebug?.probe('jack-sabores')?.phase === 'standing', null, { timeout: 8000 }).catch(() => {});
const spot = await page.evaluate(() => {
  const j = window.__fantaDebug?.probe('jack-sabores');
  const numeral = document.querySelector('.showcase__numeral').getBoundingClientRect();
  const layer = document.querySelector('.showcase__layer.is-current');
  const half = j ? j.height * 0.2 : 0;
  return { phase: j?.phase, x: Math.round(j?.px ?? -1), left: Math.round((j?.px ?? 0) - half), right: Math.round((j?.px ?? 0) + half), numeral: Math.round(numeral.right), can: Math.round(layer.offsetLeft + 0.366 * layer.offsetWidth), fit: j?.fit };
});
ok(spot.phase === 'standing' && spot.left >= spot.numeral && spot.right <= spot.can, `Jack no vão numeral→lata: ${JSON.stringify(spot)}`);
// fruta em destaque de volta no canto de baixo à direita (abaixo do play) e controle só com play/pausa + linha
const corner = await page.evaluate(() => {
  const flavor = document.querySelector('.showcase__stage').dataset.flavor;
  const hero = document.querySelector(`.world__group[data-flavor="${flavor}"] .world__sprite.is-hero`);
  const controls = document.querySelector('.spin-controls');
  const h = hero?.getBoundingClientRect(); const c = controls.getBoundingClientRect();
  return { opacity: hero ? +getComputedStyle(hero).opacity : 0, heroTop: Math.round(h?.top ?? 0), heroX: Math.round(h ? h.left + h.width / 2 : 0), controlsBottom: Math.round(c.bottom), controlsLeft: Math.round(c.left), buttons: controls.querySelectorAll('button').length, inputs: controls.querySelectorAll('input[type=range]').length, text: controls.textContent.trim() };
});
ok(corner.opacity > 0.5 && corner.heroTop > corner.controlsBottom && corner.heroX > corner.controlsLeft - 160 && corner.buttons === 1 && corner.inputs === 1 && corner.text === '', `fruta embaixo à direita e play enxuto: ${JSON.stringify(corner)}`);

ok(log.length === 0, 'console/rede sem erros: ' + JSON.stringify(log));
await browser.close();
