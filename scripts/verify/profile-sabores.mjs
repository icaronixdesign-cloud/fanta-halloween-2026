// Mede a fluidez do giro na seção de sabores: rola como um trackpad (passos pequenos a cada quadro) e registra, a
// cada requestAnimationFrame, o intervalo entre quadros e o quadro de vídeo apresentado x o pedido.
// Uso: BASE=http://localhost:5192 node scripts/verify/profile-sabores.mjs [variante] (variantes: normal, sem-jack)
import { chromium } from 'playwright-core';
import { BASE, sleep, scrollToY, sectionY } from './lib.mjs';

const variant = process.argv[2] || 'normal';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-zero-copy'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (variant === 'so-video-sem-carga') await page.route(/(maracuja|uva|laranja|caju)-loop.mp4/, (r) => r.abort());
if (variant === 'sem-jack' || variant.startsWith('so-video')) await page.route('**/jack-admire.glb', (r) => r.abort());
await page.goto(BASE + '/?debug' + (process.env.Q || ''), { waitUntil: 'load' });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
const CSS = {
  'sem-blur': '.world__sprite *{filter:none!important}',
  'sem-mundo': '.world{display:none!important}',
  'sem-push': '.showcase__media{transform:none!important}',
  'sem-mascara': '.world{-webkit-mask:none!important;mask:none!important}',
  'so-video': '.world,.showcase__jack,.showcase__hint{display:none!important}.showcase__media{transform:none!important}',
  'sem-letras': '.showcase__name-char,.showcase__name-inner,.showcase__numeral{animation:none!important;transition:none!important}.showcase__name--exit{display:none!important}',
  'so-video-sem-letras': '.world,.showcase__jack,.showcase__hint{display:none!important}.showcase__media{transform:none!important}.showcase__name-char,.showcase__name-inner,.showcase__numeral{animation:none!important;transition:none!important}.showcase__name--exit{display:none!important}',
  'so-video-sem-capa': '.world,.showcase__jack,.showcase__hint{display:none!important}.showcase__media{transform:none!important}.framed-video__poster{display:none!important}',
  'so-video-sem-carga': '.world,.showcase__jack,.showcase__hint{display:none!important}.showcase__media{transform:none!important}',
};
if (CSS[variant]) await page.addStyleTag({ content: CSS[variant] });
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'sem webgl';
});
console.log('GPU:', gpu);
await scrollToY(page, await sectionY(page, 'sabores', 0.45 / 6));
await sleep(5000); // vídeos e Jack carregados
await page.mouse.move(720, 450);
await page.evaluate(() => {
  const w = window;
  w.__loaf = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      w.__loaf.push({
        dur: Math.round(e.duration), block: Math.round(e.blockingDuration),
        render: Math.round(e.startTime + e.duration - e.renderStart),
        style: Math.round(e.startTime + e.duration - e.styleAndLayoutStart),
        scripts: e.scripts.map((sc) => `${sc.invoker}:${Math.round(sc.duration)}ms(${(sc.sourceURL || '').split('/').pop()}:${sc.sourceFunctionName})`).slice(0, 4),
      });
    }
  }).observe({ type: 'long-animation-frame', buffered: false });
  w.__prof = [];
  const loop = (t) => {
    const p = w.__fantaDebug.probe('showcase');
    const label = 'sabor:' + document.querySelector('.showcase__stage').dataset.flavor;
    const c = w.__fantaDebug.controllers.get(label)?.getSnapshot();
    w.__prof.push([t, c?.presentedFrame ?? -1, c?.targetFrame ?? -1, p.cf]);
    if (w.__prof.length < 100000) w.__profRaf = requestAnimationFrame(loop);
  };
  w.__profRaf = requestAnimationFrame(loop);
});
// ~3 s de rolagem contínua e suave (atravessa a troca para o 2º sabor) e depois parada
for (let i = 0; i < 180; i++) {
  await page.mouse.wheel(0, 9);
  await sleep(16);
}
await sleep(800);
const prof = await page.evaluate(() => {
  cancelAnimationFrame(window.__profRaf);
  return window.__prof;
});
const dts = prof.slice(1).map((r, i) => r[0] - prof[i][0]);
const sorted = [...dts].sort((a, b) => a - b);
const pct = (q) => sorted[Math.floor(q * (sorted.length - 1))].toFixed(1);
let stalls = 0;
let jumps = 0;
let lagSum = 0;
let moving = 0;
for (let i = 1; i < prof.length; i++) {
  const [, pres, target] = prof[i];
  const prevPres = prof[i - 1][1];
  if (target !== prof[i - 1][2]) {
    moving++;
    if (pres === prevPres) stalls++;
    lagSum += Math.min(Math.abs(target - pres), 180 - Math.abs(target - pres));
  }
  const d = Math.abs(pres - prevPres);
  if (Math.min(d, 180 - d) > 3) jumps++;
}
console.log(`[${variant}] quadros ${prof.length}, intervalo p50 ${pct(0.5)} ms p95 ${pct(0.95)} ms p99 ${pct(0.99)} ms, >25 ms: ${dts.filter((d) => d > 25).length}`);
const longs = prof.slice(1).map((r, i) => [r[0] - prof[i][0], r[3]]).filter(([d]) => d > 25).map(([d, cf]) => `${d.toFixed(0)}ms@cf${cf.toFixed(2)}`);
console.log(`[${variant}] quadros longos: ${longs.join(' ')}`);
console.log(`[${variant}] em movimento ${moving}: vídeo parado ${stalls} (${((stalls / Math.max(1, moving)) * 100).toFixed(0)}%), saltos >3 quadros ${jumps}, atraso médio ${(lagSum / Math.max(1, moving)).toFixed(2)} quadros`);
const loaf = await page.evaluate(() => window.__loaf);
console.log(`[${variant}] LoAF (>50 ms): ${loaf.length}`);
for (const l of loaf.slice(0, 25)) console.log('  ', JSON.stringify(l));
await browser.close();
