import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled, waitScrollIdle } from './lib.mjs';
const ok = (cond, msg) => console.log(cond ? 'PASS' : 'FAIL', msg);
const browser = await launch();
const ctl = (page, l) => page.evaluate((l) => window.__fantaDebug.controllers.get(l)?.getSnapshot(), l);

// ── A. Toque no celular (390×844) ──
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const log = []; track(page, log);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1, steps = 14) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] }); await sleep(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(1200);
  await scrollToY(page, await sectionY(page, 'sabores', 1.03 / 6)); await sleep(1200);
  let s = await waitSettled(page, 'sabor:guarana');
  const r = await page.evaluate(() => { const b = document.querySelector('.showcase__drag').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; });
  const y0 = await page.evaluate(() => scrollY);
  await swipe(r.x + 90, r.y, r.x - 90, r.y + 4); await sleep(900);
  let m = await ctl(page, 'sabor:guarana'); const y1 = await page.evaluate(() => scrollY);
  ok(m.mode === 'manual' && m.presentedFrame !== s.presentedFrame && y1 === y0, `swipe horizontal na lata: modo ${m.mode}, quadro ${s.presentedFrame}->${m.presentedFrame}, scrollY ${y0}->${y1}`);
  await swipe(r.x, r.y + 120, r.x + 6, r.y - 140); await sleep(1200);
  const y2 = await waitScrollIdle(page); m = await waitSettled(page, 'sabor:guarana');
  ok(y2 > y1 + 40 && m.mode === 'scroll', `swipe vertical na lata rola a página: scrollY ${y1}->${y2}, modo ${m.mode} (quadro ${m.presentedFrame})`);
  // toque nas miniaturas
  const thumb = await page.evaluate(() => { const b = document.querySelector('.flavor-picker__item[href="#sabor-laranja"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; });
  await page.touchscreen.tap(thumb.x, thumb.y); await sleep(1500);
  const fl = await page.evaluate(() => document.querySelector('.showcase__stage').dataset.flavor);
  ok(fl === 'laranja' && thumb.w >= 44 && thumb.h >= 44, `toque na miniatura Laranja -> ${fl} (alvo ${Math.round(thumb.w)}×${Math.round(thumb.h)} px)`);
  // toque no chip do hero leva ao sabor
  await scrollToY(page, 0); await sleep(800);
  const chip = await page.evaluate(() => { const b = [...document.querySelectorAll('.hero__chip')].find((a) => a.textContent.includes('Caju')).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.touchscreen.tap(chip.x, chip.y); await sleep(1600);
  const st = await page.evaluate(() => ({ flavor: document.querySelector('.showcase__stage').dataset.flavor, top: document.getElementById('sabores').getBoundingClientRect().top, focus: document.activeElement.className }));
  ok(st.flavor === 'caju' && st.top <= 0 && st.focus.includes('showcase__name'), `chip "Caju" no hero -> ${JSON.stringify(st)}`);
  ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, 'sem overflow horizontal no celular');
  ok(log.length === 0, 'celular sem erros: ' + JSON.stringify(log));
  await ctx.close();
}

// ── B. Movimento reduzido ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(); const log = []; track(page, log);
  const mp4 = []; page.on('request', (rq) => { if (rq.url().endsWith('.mp4')) mp4.push(rq.url().split('/').pop()); });
  await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(2000);
  const info = await page.evaluate(() => ({ hero: document.getElementById('colecao').offsetHeight, show: document.getElementById('sabores').offsetHeight, vh: innerHeight, sticky: getComputedStyle(document.querySelector('.hero__stage')).position, poster: document.querySelector('.hero__video img').getAttribute('src').split('/').pop() }));
  ok(info.hero <= info.vh * 1.05 && info.show <= info.vh * 1.05 && info.sticky === 'relative', `seções sem sequência presa: hero ${info.hero}px, sabores ${info.show}px, posição ${info.sticky}`);
  ok(mp4.length === 0 && info.poster === 'fanta-colecao-poster.jpg', `nenhum MP4 baixado ao abrir; capa oficial no hero (${info.poster}); requisições mp4: ${mp4}`);
  await page.evaluate(() => document.getElementById('sabores').scrollIntoView()); await sleep(600);
  await page.click('.flavor-picker__item[href="#sabor-uva"]'); await sleep(900);
  const st = await page.evaluate(() => ({ flavor: document.querySelector('.showcase__stage').dataset.flavor, top: Math.round(document.getElementById('sabores').getBoundingClientRect().top), poster: document.querySelector('.showcase__layer.is-current img').getAttribute('src').split('/').pop() }));
  ok(st.flavor === 'uva' && st.poster.includes('uva') && mp4.length === 0, `seleção sem rolar e sem vídeo: ${JSON.stringify(st)}`);
  await page.focus('.spin-controls input'); for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await sleep(2500); const s = await waitSettled(page, 'sabor:uva', 8000);
  ok(mp4.includes('fanta-uva-loop.mp4') && s.presentedFrame === 20 && s.mode === 'manual', `slider carrega o vídeo sob demanda e posiciona: quadro ${s.presentedFrame}, modo ${s.mode}, mp4 ${mp4}`);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.hero__letter')).animationDuration);
  ok(parseFloat(anim) < 0.01, `animações reduzidas (duração ${anim})`);
  await page.screenshot({ path: `${OUT}reduced-sabores.png` });
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  await page.screenshot({ path: `${OUT}reduced-hero.png` });
  ok(log.length === 0, 'movimento reduzido sem erros: ' + JSON.stringify(log));
  await ctx.close();
}

// ── C. Rede lenta ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const log = []; track(page, log);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (6 * 1024 * 1024) / 8, uploadThroughput: 500000 });
  await page.goto(BASE + '/?debug', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const early = await page.evaluate(() => { const f = document.querySelector('.hero__video'); const img = f.querySelector('img'); return { posterOk: img.complete && img.naturalWidth > 0, revealed: f.dataset.revealed, load: f.dataset.load }; });
  await page.screenshot({ path: `${OUT}slow-hero-early.png` });
  ok(early.posterOk, `rede lenta (6 Mbps): capa visível antes do vídeo (${JSON.stringify(early)})`);
  // rolar enquanto carrega e depois conferir convergência
  await scrollToY(page, await sectionY(page, 'colecao', 0.5)); await sleep(500);
  const mid = await ctl(page, 'colecao');
  const s = await waitSettled(page, 'colecao', 60000);
  ok(s.presentedFrame === s.targetFrame && s.revealed, `rede lenta: durante a carga ${mid.loadState}/revelado ${mid.revealed}; depois quadro ${s.presentedFrame} = alvo ${s.targetFrame}, timeouts ${s.seekTimeouts}`);
  await scrollToY(page, await sectionY(page, 'sabores', 0.02 / 6)); await sleep(300);
  const sw = await page.evaluate(() => { const c = document.querySelector('.showcase__layer.is-current'); const img = c.querySelector('img'); return { flavor: document.querySelector('.showcase__stage').dataset.flavor, poster: img.complete && img.naturalWidth > 0, revealed: c.dataset.revealed }; });
  await page.screenshot({ path: `${OUT}slow-sabores-early.png` });
  ok(sw.poster, `rede lenta: ao entrar em sabores a capa já está pintada (${JSON.stringify(sw)})`);
  ok(log.filter((l) => !l.includes('ERR_ABORTED')).length === 0, 'rede lenta sem erros: ' + JSON.stringify(log));
  await ctx.close();
}

// ── D. Falha de vídeo (todo MP4 recusado) ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const log = []; track(page, log);
  await page.route('**/*.mp4', (route) => route.abort('failed'));
  await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(2500);
  const h = await page.evaluate(() => { const f = document.querySelector('.hero__video'); const img = f.querySelector('img'); return { load: f.dataset.load, img: img.getAttribute('src').split('/').pop(), ok: img.complete && img.naturalWidth > 0, videoOpacity: getComputedStyle(f.querySelector('video')).opacity }; });
  ok(h.load === 'error' && h.ok && h.videoOpacity === '0' && h.img === 'fanta-colecao-poster.jpg', `falha no hero: ${JSON.stringify(h)}`);
  await scrollToY(page, await sectionY(page, 'sabores', 2.4 / 6)); await sleep(2500);
  const f = await page.evaluate(() => { const c = document.querySelector('.showcase__layer.is-current'); const img = c.querySelector('img'); return { flavor: document.querySelector('.showcase__stage').dataset.flavor, load: c.dataset.load, poster: img.complete && img.naturalWidth > 0, status: document.querySelector('.spin-controls__status').textContent }; });
  ok(f.load === 'error' && f.poster && f.status.includes('indisponível'), `falha nos sabores: ${JSON.stringify(f)}`);
  await page.click('.flavor-picker__item[href="#sabor-caju"]', { force: true }); await sleep(1200);
  const c = await page.evaluate(() => ({ flavor: document.querySelector('.showcase__stage').dataset.flavor, name: document.querySelector('.showcase__name').textContent }));
  ok(c.flavor === 'caju', `navegação continua com vídeos falhando: ${JSON.stringify(c)}`);
  await page.click('.icon-button.is-play'); await sleep(600);
  const pageErrors = log.filter((l) => l.startsWith('[pageerror]'));
  ok(pageErrors.length === 0, `sem exceções JS com mídia falhando (${pageErrors.length}); mensagens de rede esperadas: ${log.length - pageErrors.length}`);
  await page.screenshot({ path: `${OUT}fail-sabores.png` });
  await ctx.close();
}
await browser.close();
