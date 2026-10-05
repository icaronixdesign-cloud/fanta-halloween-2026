import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';
const ok = (cond, msg) => console.log(cond ? 'PASS' : 'FAIL', msg);
const base = process.argv[2] || BASE;
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const log = []; track(page, log);
await page.goto(base + '/?debug', { waitUntil: 'load' }); await sleep(1500);
const geo = () => page.evaluate(() => {
  const f = document.querySelector('.showcase__layer.is-current'); const r = f.getBoundingClientRect();
  const safe = { l: r.left + 0.325 * r.width, r: r.left + 0.665 * r.width, t: r.top + 0.115 * r.height, b: r.top + 0.925 * r.height };
  const st = document.querySelector('.showcase__stage').getBoundingClientRect();
  const intro = document.querySelector('.showcase__intro').getBoundingClientRect();
  const aspect = r.width / r.height;
  return { inside: safe.l >= 0 && safe.r <= st.width && safe.t >= 0 && safe.b <= st.height, belowIntro: safe.t >= intro.bottom - 1 || safe.l >= intro.right - 1, aspect: +aspect.toFixed(4), layout: document.querySelector('.showcase__stage').className.includes('is-wide') ? 'wide' : 'stacked', ovX: document.documentElement.scrollWidth - innerWidth };
});
await scrollToY(page, await sectionY(page, 'sabores', 2.5 / 6)); await sleep(1200);
let s = await waitSettled(page, 'sabor:maracuja');
for (const [w, h] of [[1440, 900], [390, 844], [844, 390], [768, 1024], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h }); await sleep(900);
  // a mesma posição relativa dentro da seção
  await scrollToY(page, await sectionY(page, 'sabores', 2.5 / 6)); await sleep(700);
  s = await waitSettled(page, 'sabor:maracuja'); const g = await geo();
  ok(g.inside && g.belowIntro && Math.abs(g.aspect - 16 / 9) < 0.002 && g.ovX === 0 && s.presentedFrame === s.targetFrame, `${w}x${h} ${g.layout}: área segura dentro=${g.inside}, livre do texto=${g.belowIntro}, proporção ${g.aspect}, quadro ${s.presentedFrame}/${s.targetFrame}`);
}
// Suspensão: no fecho (entre os sabores e a CTA) nenhum controlador ativo nem vídeo tocando
await page.click('.flavor-picker__item[href="#sabor-uva"]', { force: true }); await sleep(1000);
await page.click('.icon-button.is-play'); await sleep(800);
await page.evaluate(() => { const s = document.getElementById('sobre'); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + (s.offsetHeight - innerHeight) / 2, behavior: 'instant' }); }); await sleep(1200);
const snaps = await page.evaluate(() => window.__fantaDebug.snapshot().map((c) => ({ l: c.label, active: c.active, paused: c.paused, mode: c.mode })));
ok(snaps.every((c) => !c.active && c.paused), `fora das seções de vídeo: ${JSON.stringify(snaps.filter((c) => c.active || !c.paused))} ativos/tocando`);
// Fim da página: só a CTA ativa, pausada (scrub), sem reprodução
await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await sleep(1200);
const endSnaps = await page.evaluate(() => window.__fantaDebug.snapshot().map((c) => ({ l: c.label, active: c.active, paused: c.paused, mode: c.mode })));
ok(endSnaps.every((c) => c.paused && (c.l === 'cta' ? c.mode === 'scroll' : !c.active)), `fim da página: ${JSON.stringify(endSnaps.filter((c) => c.active || !c.paused))} ativos/tocando`);
const before = await page.evaluate(() => window.__fantaDebug.snapshot().reduce((a, c) => a + c.seeksIssued, 0));
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 200); await sleep(60); }
const after = await page.evaluate(() => window.__fantaDebug.snapshot().reduce((a, c) => a + c.seeksIssued, 0));
ok(before === after, `rolar no fecho não emite buscas (${before} -> ${after})`);
ok(log.length === 0, 'sem erros: ' + JSON.stringify(log));
await browser.close();
