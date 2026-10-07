// Junção sabores → vitrine: Jack andando no fim da seção e o degradê que leva ao preto da vitrine.
// uso: node scripts/verify/capture-seam.mjs [tag]
import { BASE, OUT, launch, sleep, scrollToY } from './lib.mjs';

const tag = process.argv[2] || 'seam';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/?nosnap', { waitUntil: 'load' });
await sleep(1500);
const { top, end } = await page.evaluate(() => {
  const s = document.querySelector('.showcase');
  const t = scrollY + s.getBoundingClientRect().top;
  return { top: t, end: t + s.offsetHeight - innerHeight };
});
for (let y = top; y < end - 900; y += 120) { await scrollToY(page, y); await sleep(40); }
await scrollToY(page, end - 900); await sleep(4000);
for (const [i, d] of [[0, -200], [1, 200], [2, 450], [3, 700]].entries()) {
  await scrollToY(page, end + d[1]); await sleep(1200);
  await page.screenshot({ path: `${OUT}${tag}-${i}.png` });
}
console.log('canvas:', await page.evaluate(() => !!document.querySelector('.showcase__jack canvas')));
await browser.close();
