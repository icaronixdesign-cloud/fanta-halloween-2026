// Gole do Jack quadro a quadro com o relógio da página controlado (60 quadros/s exatos, sem depender do
// desempenho da máquina): segura 3,4 s, solta, segura 1 s e solta de novo. Grava os quadros recortados no
// Jack, monta um mp4 e salva o "movimento" entre quadros vizinhos (média da diferença em cinza), a mesma
// medida usada para achar os trancos na gravação de tela.
// node scripts/verify/drink-frames.mjs [largura] [altura] [nome]   (KEEP_FRAMES=1 guarda os PNG em out/<nome>/)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, BASE, OUT, sleep, scrollToY, sectionY, waitScrollIdle } from './lib.mjs';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
const name = process.argv[4] || `drink-${W}x${H}`;
const dir = `${OUT}${name}/`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

// o relógio falso dispara requestAnimationFrame a cada 16 ms (e arredonda runFor para ms inteiros): passo de
// 16 ms dá exatamente um quadro da cena por captura (o vídeo sai a 62,5 quadros/s)
const STEP = 16;
const FPS = 1000 / STEP;
const EVENTS = [
  [1.0, 'down'],
  [4.4, 'up'],
  [6.0, 'down'],
  [7.0, 'up'],
];
const TOTAL = 8.8;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.clock.install();
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 60000 });
await scrollToY(page, await sectionY(page, 'colecao', 0.92));
await waitScrollIdle(page);
await sleep(2500);
const wide = W > H;
const jack = [W * 0.5, H * (wide ? 0.42 : 0.5)];
await page.mouse.move(...jack);
await sleep(300);
const now = await page.evaluate(() => Date.now());
await page.clock.pauseAt(now + 200);

const clip = wide
  ? { x: Math.round(W * 0.5 - H * 0.36), y: Math.round(H * 0.1), width: Math.round(H * 0.72), height: Math.round(H * 0.78) }
  : { x: 0, y: Math.round(H * 0.25), width: W, height: Math.round(H * 0.6) };
const n = Math.round(TOTAL * FPS);
let ev = 0;
for (let f = 0; f < n; f++) {
  const t = f / FPS;
  while (ev < EVENTS.length && EVENTS[ev][0] <= t + 1e-6) {
    await (EVENTS[ev][1] === 'down' ? page.mouse.down() : page.mouse.up());
    ev++;
  }
  await page.clock.runFor(STEP);
  await page.screenshot({ path: `${dir}f${String(f).padStart(4, '0')}.png`, clip });
}
const drinking = await page.evaluate(() => document.querySelector('.jack-hero__stage')?.dataset.drinking);
await browser.close();

execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', `${dir}f%04d.png`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', `${OUT}${name}.mp4`]);
if (!process.env.KEEP_FRAMES) fs.rmSync(dir, { recursive: true, force: true });
console.log(`${OUT}${name}.mp4`, `${n} quadros a ${FPS} fps, recorte ${clip.width}x${clip.height}, fim drinking=${drinking}`);
