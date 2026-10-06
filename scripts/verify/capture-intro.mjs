// Quadro inicial do hero (latas flutuando em volta da chamada) em várias proporções e, com --scroll,
// a saída das latas na transição para o giro do Jack.
// BASE=http://localhost:5191 node scripts/verify/capture-intro.mjs [tag] [--scroll]
import { launch, BASE, OUT, sleep, scrollToY, sectionY } from './lib.mjs';

const tag = process.argv[2] || 'now';
const scroll = process.argv.includes('--scroll');
const sizes = scroll
  ? [[1440, 960], [390, 844]]
  : [[1440, 960], [1440, 900], [1920, 1080], [1280, 800], [2560, 1080], [390, 844], [820, 1180]];
const browser = await launch();
const log = [];
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 768, isMobile: w < 768 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && log.push(`${w}x${h} ${m.text()}`));
  page.on('pageerror', (e) => log.push(`${w}x${h} ${e.message}`));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 30000 });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  await sleep(2400);
  await page.screenshot({ path: `${OUT}intro-${tag}-${w}x${h}.png` });
  if (scroll) {
    for (const q of [0.1, 0.18, 0.26, 0.34, 0.42, 0.5]) {
      await scrollToY(page, await sectionY(page, 'colecao', q));
      await sleep(1500);
      await page.screenshot({ path: `${OUT}intro-${tag}-${w}x${h}-p${Math.round(q * 100)}.png` });
    }
  }
  await ctx.close();
}
console.log(log.length ? log.join('\n') : 'sem erros');
await browser.close();
