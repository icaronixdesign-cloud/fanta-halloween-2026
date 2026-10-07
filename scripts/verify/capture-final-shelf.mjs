// Capturas da vitrine final (#vitrine): chegada do Jack, caminhada pelas setas (teclado e tela) e clique no palco.
// BASE=http://localhost:5192 node scripts/verify/capture-final-shelf.mjs [largura] [altura]
import { launch, BASE, OUT, sleep, scrollToY } from './lib.mjs';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
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
const y = await page.evaluate(() => document.getElementById('vitrine').getBoundingClientRect().top + scrollY);
await scrollToY(page, y);
await page.waitForFunction(() => document.querySelector('.final-shelf')?.dataset.state === 'ready', null, { timeout: 30000 });
const shot = (name) => page.screenshot({ path: `${OUT}final-${tag}-${name}.png` });
await sleep(700);
await shot('arrive-a');
await sleep(2600);
await shot('rest');
if (!touch) {
  // segurar → (teclado) até o meio, passando por trás do título e do botão
  await page.keyboard.down('ArrowRight');
  await sleep(900);
  await shot('walk-right');
  await sleep(900);
  await page.keyboard.up('ArrowRight');
  await sleep(800);
  await shot('center');
  // um toque na seta da tela: um passo
  await page.click('.final-shelf__arrow[aria-label="Andar para a esquerda"]');
  await sleep(250);
  await shot('step-left');
  await sleep(1200);
}
// clique/toque no palco, perto da borda direita
const r = await page.evaluate(() => { const b = document.querySelector('.final-shelf__canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
if (touch) await page.touchscreen.tap(r.x + r.w * 0.85, r.y + r.h * 0.85);
else await page.mouse.click(r.x + r.w * 0.85, r.y + r.h * 0.85);
await sleep(700);
await shot('walk-to');
await sleep(3200);
await shot('walk-to-end');
console.log(log.length ? log.join('\n') : 'sem erros no console');
await browser.close();
