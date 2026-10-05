// Grava a rolagem real (roda do mouse) atravessando a CTA final, para comparar com reference-cta.mp4.
// Uso: node scripts/verify/record-cta.mjs [largura] [altura] [notches] [ms entre notches]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, BASE, OUT, sleep, scrollToY, sectionY, waitScrollIdle } from './lib.mjs';

const width = Number(process.argv[2] || 1440);
const height = Number(process.argv[3] || 900);
const notches = Number(process.argv[4] || 34);
const gap = Number(process.argv[5] || 180);
const browser = await launch();
const dir = OUT + 'video/';
fs.mkdirSync(dir, { recursive: true });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
// Vídeo por screencast do CDP (sem o ffmpeg do Playwright) + ffmpeg do sistema.
const frames = [];
let recording = false;
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  if (recording) frames.push({ data, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await page.goto(BASE + '/?debug', { waitUntil: 'load' });
await sleep(800);
await scrollToY(page, (await sectionY(page, 'cta', 0)) - height * 0.6);
await waitScrollIdle(page);
await sleep(2500); // vídeo da CTA carrega
await page.mouse.move(width * 0.5, height * 0.5);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
recording = true;
await sleep(300);
for (let i = 0; i < notches; i++) {
  await page.mouse.wheel(0, 100);
  await sleep(gap);
}
await sleep(1500);
recording = false;
await cdp.send('Page.stopScreencast');
await browser.close();
const frameDir = dir + 'frames/';
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });
let list = '';
frames.forEach((frame, index) => {
  const name = `f${String(index).padStart(5, '0')}.jpg`;
  fs.writeFileSync(frameDir + name, Buffer.from(frame.data, 'base64'));
  const next = frames[index + 1];
  const duration = next ? Math.max(0.001, next.t - frame.t) : 0.04;
  list += `file '${name}'
duration ${duration.toFixed(4)}
`;
});
fs.writeFileSync(frameDir + 'list.txt', list);
const target = `${dir}cta-${width}x${height}.mp4`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', frameDir + 'list.txt', '-vf', 'fps=30,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '20', target]);
const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
console.log(target, `${frames.length} quadros em ${span.toFixed(1)} s (${(frames.length / Math.max(span, 0.001)).toFixed(1)} fps)`);
