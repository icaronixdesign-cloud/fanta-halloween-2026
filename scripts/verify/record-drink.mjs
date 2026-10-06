// Grava o gole: na vitrine, segurar sobre o Jack (3 s), soltar, um gole curto e outro com outro sabor.
// Uso: node scripts/verify/record-drink.mjs [largura] [altura] [saida.mp4]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, BASE, OUT, sleep, scrollToY, sectionY, waitScrollIdle } from './lib.mjs';

const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const dir = OUT + 'video/';
const target = process.argv[4] || `${dir}drink-${width}x${height}.mp4`;
fs.mkdirSync(dir, { recursive: true });
const browser = await launch();
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
await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 30000 });
await scrollToY(page, await sectionY(page, 'colecao', 0.92));
await waitScrollIdle(page);
await sleep(2000);
const jack = [width * 0.5, height * (width > height ? 0.42 : 0.5)];
await page.mouse.move(...jack);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
recording = true;
await sleep(600);
await page.mouse.down();
await sleep(3400);
await page.mouse.up();
await sleep(1400);
await page.mouse.down();
await sleep(1000);
await page.mouse.up();
await sleep(1200);
await page.click('.jack-hero__arrow[aria-label="Próximo sabor"]');
await sleep(2700);
await page.mouse.move(...jack);
await page.mouse.down();
await sleep(2200);
await page.mouse.up();
await sleep(1300);
recording = false;
await cdp.send('Page.stopScreencast');
await browser.close();

const frameDir = dir + 'frames-drink/';
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
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', frameDir + 'list.txt', '-vf', 'fps=30,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', target]);
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(target, `${frames.length} quadros em ${span.toFixed(1)} s (${(frames.length / Math.max(span, 0.001)).toFixed(1)} fps)`);
