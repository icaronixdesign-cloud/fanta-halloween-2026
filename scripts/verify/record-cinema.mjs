// Grava a promoção Cinemark (#cinema) rolando a seção inteira com a roda do mouse (GPU real, como no profile).
// Uso: BASE=http://localhost:5190 node scripts/verify/record-cinema.mjs [largura] [altura] [px por passo] [saida.mp4]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { BASE, OUT, sleep, scrollToY, waitScrollIdle } from './lib.mjs';

const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const step = Number(process.argv[4] || 14);
const dir = OUT + 'video/';
const target = process.argv[5] || `${dir}cinema-${width}x${height}.mp4`;
fs.mkdirSync(dir, { recursive: true });
const touch = width < 768;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-zero-copy'],
});
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch });
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
const box = await page.evaluate(() => {
  const s = document.getElementById('cinema');
  return { top: s.getBoundingClientRect().top + scrollY, h: s.offsetHeight };
});
await scrollToY(page, box.top);
await page.waitForFunction(() => document.querySelector('.cinema-promo__stage')?.dataset.state === 'ready', null, { timeout: 60000 });
await sleep(1500);
await page.mouse.move(width * 0.5, height * 0.5);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
recording = true;
await sleep(600);
const end = box.top + box.h - height;
while ((await page.evaluate(() => scrollY)) < end - 4) {
  await page.mouse.wheel(0, step);
  await sleep(33);
}
await waitScrollIdle(page);
await sleep(2200);
recording = false;
await cdp.send('Page.stopScreencast');
await browser.close();

const frameDir = dir + 'frames-cinema/';
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
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', frameDir + 'list.txt', '-fps_mode', 'cfr', '-r', '30',
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', target]);
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log('frames', frames.length, 'em', span.toFixed(1), 's ->', target);
