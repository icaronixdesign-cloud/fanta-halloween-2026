// Capturas do palco de sabores em pontos da coreografia (meio do capítulo, entrada e saída da troca).
// Uso: node scripts/verify/capture-swap.mjs [largura] [altura]
import { launch, BASE, OUT, sleep, scrollToY, sectionY, waitScrollIdle } from './lib.mjs';

const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const browser = await launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '/?debug', { waitUntil: 'load' });
await sleep(1200);

async function settle() {
  await waitScrollIdle(page);
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const ok = await page.evaluate(() => {
      const probe = window.__fantaDebug?.probe('showcase');
      if (!probe || !probe.settled) return false;
      const snaps = window.__fantaDebug.snapshot().filter((s) => s.label.startsWith('sabor:') && s.active && s.src);
      return snaps.every((s) => !s.seekPending && s.requestedFrame === s.targetFrame);
    });
    if (ok) break;
    await sleep(80);
  }
  await sleep(250);
}

const points = (process.env.POINTS || '0.5,0.8,0.95,1.0,1.05,1.2,1.5').split(',').map(Number);
for (const cf of points) {
  await scrollToY(page, await sectionY(page, 'sabores', cf / 6));
  await settle();
  const state = await page.evaluate(() => window.__fantaDebug.probe('showcase'));
  const name = `swap-${width}x${height}-cf${cf.toFixed(2)}.png`;
  await page.screenshot({ path: OUT + name });
  console.log(name, JSON.stringify({ cf: +state.cf.toFixed(3), displayed: state.displayed }));
}
console.log(errors.length ? 'ERROS: ' + errors.join(' | ') : 'sem erros de console');
await browser.close();
