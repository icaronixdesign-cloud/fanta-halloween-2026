// Grava a vitrine final: chegada do Jack, caminhada segurando a seta (passa por trás do título e do botão),
// toques na seta da tela e clique no palco.
// Uso: BASE=http://localhost:5192 node scripts/verify/record-final-shelf.mjs [largura] [altura] [saida.mp4]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, BASE, OUT, sleep, scrollToY, waitScrollIdle } from './lib.mjs';

const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const dir = OUT + 'video/';
const target = process.argv[4] || `${dir}final-shelf-${width}x${height}.mp4`;
fs.mkdirSync(dir, { recursive: true });
const touch = width < 768;
const browser = await launch();
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
const top = await page.evaluate(() => document.getElementById('vitrine').getBoundingClientRect().top + scrollY);
// para logo acima: a seção ainda não chegou
await scrollToY(page, top - height * 0.75);
await page.waitForFunction(() => document.querySelector('.final-shelf')?.dataset.state === 'ready', null, { timeout: 30000 });
await sleep(800);
await page.mouse.move(width * 0.5, height * 0.3);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
recording = true;
await sleep(300);
while ((await page.evaluate(() => scrollY)) < top - 4) {
  await page.mouse.wheel(0, 50);
  await sleep(40);
}
await scrollToY(page, top);
await waitScrollIdle(page);
await sleep(3400);
const right = '.final-shelf__arrow[aria-label="Andar para a direita"]';
const left = '.final-shelf__arrow[aria-label="Andar para a esquerda"]';
// segura a seta da direita (tela): atravessa por trás do título e do botão
const box = await page.locator(right).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await sleep(3600);
await page.mouse.up();
await sleep(1400);
// dois toques na esquerda: dois passos
await page.click(left);
await sleep(700);
await page.click(left);
await sleep(1500);
// teclado: segura ← por um tempo
await page.keyboard.down('ArrowLeft');
await sleep(1800);
await page.keyboard.up('ArrowLeft');
await sleep(1500);
recording = false;
await cdp.send('Page.stopScreencast');
await browser.close();

const frameDir = dir + 'frames-final/';
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
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', target]);
console.log('frames', frames.length, '->', target);
