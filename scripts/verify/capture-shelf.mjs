// Capturas da vitrine do hero (latas entrando, fileira final e troca de sabor).
// BASE=http://localhost:5191 node scripts/verify/capture-shelf.mjs [largura] [altura]
import { launch, BASE, OUT, sleep, scrollToY, sectionY } from './lib.mjs';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
const tag = `${W}x${H}`;
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: W < 768 });
const page = await ctx.newPage();
const log = [];
page.on('console', (m) => m.type() === 'error' && log.push(m.text()));
page.on('pageerror', (e) => log.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 30000 });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });

for (const q of [0.3, 0.45, 0.55, 0.65, 0.75, 0.9]) {
  await scrollToY(page, await sectionY(page, 'colecao', q));
  await sleep(1600);
  await page.screenshot({ path: `${OUT}shelf-${tag}-p${Math.round(q * 100)}.png` });
}
const name = () => page.evaluate(() => document.querySelector('.jack-hero__name')?.textContent.trim());
console.log('nome inicial', await name());
// troca pela seta: meio da troca (mão nas costas) e fim
await page.click('.jack-hero__arrow[aria-label="Próximo sabor"]');
await sleep(500);
await page.screenshot({ path: `${OUT}shelf-${tag}-swap-a.png` });
await sleep(500);
await page.screenshot({ path: `${OUT}shelf-${tag}-swap-b.png` });
await sleep(1800);
await page.screenshot({ path: `${OUT}shelf-${tag}-swap-end.png` });
console.log('depois da seta', await name());
// clique direto na lata da esquerda (vaga -1)
const box = await page.evaluate(() => { const r = document.querySelector('.jack-hero__canvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
await page.mouse.click(box.w * 0.5 - box.w * (W > H ? 0.17 : 0.38), box.h * 0.48);
await sleep(2600);
await page.screenshot({ path: `${OUT}shelf-${tag}-click.png` });
console.log('depois do clique', await name());
// segurar sobre o Jack: bebe enquanto segura, para ao soltar
const drinking = () => page.evaluate(() => document.querySelector('.jack-hero__stage').dataset.drinking);
await page.mouse.move(W * 0.5, H * (W > H ? 0.42 : 0.5));
await page.mouse.down();
await sleep(900);
await page.screenshot({ path: `${OUT}shelf-${tag}-drink-a.png` });
console.log('segurando', await drinking());
await sleep(2600);
await page.screenshot({ path: `${OUT}shelf-${tag}-drink-b.png` });
await page.mouse.up();
console.log('soltou', await drinking());
await sleep(900);
await page.screenshot({ path: `${OUT}shelf-${tag}-drink-end.png` });
console.log(log.length ? log.join('\n') : 'sem erros');
await browser.close();
