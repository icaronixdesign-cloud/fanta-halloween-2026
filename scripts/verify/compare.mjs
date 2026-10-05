import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Compara os quadros capturados do <video> no navegador (interact.mjs) com os quadros do ffmpeg.
const M = fileURLToPath(new URL('../../public/media/fanta/', import.meta.url));
const grabs = JSON.parse(fs.readFileSync(new URL('./out/grabs.json', import.meta.url), 'utf8'));
const frame = (file, n) => execFileSync('ffmpeg', ['-v', 'error', '-i', `${M}${file}`, '-vf', `trim=start_frame=${n}:end_frame=${n + 1},scale=192:108:flags=bilinear`, '-frames:v', '1', '-fps_mode', 'vfr', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
for (const [key, g] of Object.entries(grabs)) {
  const [id, nStr] = key.split(/-(?=\d+$)/); const n = +nStr; const file = id === 'colecao' ? 'fanta-colecao-loop.mp4' : `fanta-${id}-loop.mp4`;
  const last = id === 'colecao' ? 239 : 179;
  const res = [];
  for (const c of [n - 2, n - 1, n, n + 1, n + 2].filter((x) => x >= 0 && x <= last)) {
    const ref = frame(file, c); let diff = 0;
    for (let i = 0, j = 0; i < ref.length; i += 3, j += 4) diff += Math.abs(ref[i] - g.px[j]) + Math.abs(ref[i + 1] - g.px[j + 1]) + Math.abs(ref[i + 2] - g.px[j + 2]);
    res.push([c, +(diff / (ref.length)).toFixed(2)]);
  }
  const best = res.reduce((a, b) => (b[1] < a[1] ? b : a));
  console.log(`${best[0] === n ? 'PASS' : 'FAIL'} ${key}: exibido=${g.presented} melhor quadro ffmpeg=${best[0]}  difs ${res.map(([c, d]) => `${c}:${d}`).join(' ')}`);
}
