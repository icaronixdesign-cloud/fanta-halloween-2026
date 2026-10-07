// Grava a seção de sabores rolando com a roda do mouse (cliques de 100 px, ritmo de quem rola de verdade): entrada,
// Jack chegando andando e três trocas de sabor. Uso: BASE=http://localhost:5192 node scripts/verify/record-sabores.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { BASE, OUT, sleep, scrollToY, sectionY } from './lib.mjs';

const width = 1440;
const height = 900;
const dir = OUT + 'video/';
const target = `${dir}sabores-${width}x${height}.mp4`;
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await context.newPage();
const frames = [];
let recording = false;
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  if (recording) frames.push({ data, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await scrollToY(page, await sectionY(page, 'sabores', 0) - height * 0.9);
await sleep(2500);
await page.mouse.move(width * 0.5, height * 0.45);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
recording = true;
await sleep(300);
// entra na seção e para no 1º sabor
for (let i = 0; i < 9; i++) {
  await page.mouse.wheel(0, 100);
  await sleep(110);
}
await sleep(2600); // o Jack chega andando
// rolagem contínua por três trocas, com pausas curtas como quem olha a lata
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 13; i++) {
    await page.mouse.wheel(0, 100);
    await sleep(120);
  }
  await sleep(1300);
}
recording = false;
await cdp.send('Page.stopScreencast');
await browser.close();

const frameDir = dir + 'frames-sabores/';
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });
let list = '';
frames.forEach((frame, index) => {
  const name = `f${String(index).padStart(5, '0')}.jpg`;
  fs.writeFileSync(frameDir + name, Buffer.from(frame.data, 'base64'));
  const following = frames[index + 1];
  list += `file '${name}'\nduration ${(following ? Math.max(0.001, following.t - frame.t) : 0.04).toFixed(4)}\n`;
});
fs.writeFileSync(frameDir + 'list.txt', list);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', frameDir + 'list.txt', '-fps_mode', 'cfr', '-r', '60',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', target]);
console.log('frames', frames.length, '->', target);
