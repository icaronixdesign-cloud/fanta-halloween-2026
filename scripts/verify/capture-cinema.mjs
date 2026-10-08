// Capturas da promoção Cinemark (#cinema): o palco em vários pontos do scroll (cena 3D + painel).
// BASE=http://localhost:5190 node scripts/verify/capture-cinema.mjs [largura] [altura] [p1,p2,...]
import { launch, BASE, OUT, sleep, scrollToY } from './lib.mjs';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
const points = (process.argv[4] || '0,0.12,0.25,0.36,0.46,0.53,0.58,0.63,0.68,0.75,0.86,1').split(',').map(Number);
const tag = `${W}x${H}`;
const touch = W < 768;
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
const page = await ctx.newPage();
const log = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
const box = await page.evaluate(() => {
  const s = document.getElementById('cinema');
  return { top: s.getBoundingClientRect().top + scrollY, h: s.offsetHeight };
});
await scrollToY(page, box.top);
await page.waitForFunction(() => document.querySelector('.cinema-promo__stage')?.dataset.state === 'ready', null, { timeout: 60000 });
for (const p of points) {
  await scrollToY(page, box.top + (box.h - H) * p);
  // a cena persegue o instante com amortecimento: espera assentar
  await sleep(1400);
  await page.screenshot({ path: `${OUT}cinema-${tag}-p${String(p).padEnd(4, '0')}.png` });
}
console.log(log.length ? log.join('\n') : 'sem erros no console');
await browser.close();
