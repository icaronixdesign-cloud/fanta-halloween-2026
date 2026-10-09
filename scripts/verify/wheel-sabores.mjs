// Fluidez do giro na seção de sabores com a roda do mouse, em hardware forte e fraco. Sai com código 1 se falhar uma meta.
// Uso: BASE=http://localhost:4180 node scripts/verify/wheel-sabores.mjs [forte|fraco|celular] [continua|rajadas]
// Ambiente: NET=<Mbps> limita a rede; HEADED=1 com janela (pode ser estrangulada se ficar atrás de outra); TL=1 imprime a linha do tempo; W/H mudam a janela.
// "fraco" = decodificação de vídeo pela CPU (--disable-accelerated-video-decode) + CPU 4× mais lenta: um notebook básico.
import { chromium } from 'playwright-core';
import { BASE, sleep } from './lib.mjs';

const profile = process.argv[2] || 'fraco';
const mode = process.argv[3] || 'continua';
const PROFILES = {
  forte: { cpu: 1, hw: true, viewport: { width: 1440, height: 900 } },
  fraco: { cpu: 4, hw: false, viewport: { width: 1440, height: 900 } },
  celular: { cpu: 4, hw: true, viewport: { width: 390, height: 844 }, mobile: true },
};
const conf = PROFILES[profile];
if (!conf) throw new Error(`perfil desconhecido: ${profile}`);
// diagnóstico: CPU=<n> e HW=0|1 trocam o perfil; HIDE=<css> esconde peças; NOJACK=1 não carrega o Jack dos sabores
if (process.env.CPU) conf.cpu = Number(process.env.CPU);
if (process.env.HW) conf.hw = process.env.HW === '1';
if (process.env.W) conf.viewport = { width: Number(process.env.W), height: Number(process.env.H || 900) };

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.env.HEADED,
  args: [
    // janela atrás de outras não pode ser estrangulada, senão o rAF cai para 1 fps e a medição não vale nada
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(conf.hw ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--disable-accelerated-video-decode']),
  ],
});
const context = await browser.newContext({
  viewport: conf.viewport,
  ...(conf.mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
if (conf.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: conf.cpu });
if (process.env.NET) {
  const bps = (Number(process.env.NET) * 1e6) / 8;
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: bps, uploadThroughput: bps / 4 });
}
// latência de cada busca (do currentTime até o 'seeked'), em todas as latas
await page.addInitScript(() => {
  window.__seeks = [];
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    get() {
      return d.get.call(this);
    },
    set(value) {
      const t = performance.now();
      this.addEventListener('seeked', () => window.__seeks.push(performance.now() - t), { once: true });
      d.set.call(this, value);
    },
    configurable: true,
  });
});
if (process.env.NOJACK) await page.route('**/jack-admire.glb', (route) => route.abort());
await page.goto(BASE + '/?debug' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
if (process.env.HIDE) await page.addStyleTag({ content: process.env.HIDE });
const geo = await page.evaluate(() => {
  const s = document.getElementById('sabores');
  const top = s.getBoundingClientRect().top + scrollY;
  const range = s.offsetHeight - s.querySelector('.showcase__stage').offsetHeight;
  return { y: Math.round(top + range * (0.3 / 6)), chapterPx: range / 6 };
});
console.log(`[${profile}/${mode}] ${conf.viewport.width}×${conf.viewport.height}, CPU ${conf.cpu}×, vídeo ${conf.hw ? 'GPU' : 'CPU'}${process.env.NET ? `, rede ${process.env.NET} Mbps` : ''}`);
// tempo típico no hero antes de chegar aos sabores
await sleep(4000);
await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), geo.y);
await sleep(3000);
await page.mouse.move(conf.viewport.width / 2, conf.viewport.height / 2);

const failures = [];
const gate = (ok, text) => {
  console.log(`  ${ok ? 'PASS' : 'FALHA'} ${text}`);
  if (!ok) failures.push(text);
};

async function pass(name) {
  await page.evaluate(() => {
    const w = window;
    w.__seeks = [];
    w.__prof = [];
    const loop = (t) => {
      const p = w.__fantaDebug.probe('showcase');
      const id = document.querySelector('.showcase__stage').dataset.flavor;
      const c = w.__fantaDebug.controllers.get('sabor:' + id)?.getSnapshot();
      const store = w.__fantaDebug.probe('videos');
      // sem o armazém de vídeos (versão antiga), qualquer capa conta
      const ready = store ? store[id] === 'ready' : true;
      w.__prof.push([t, c?.presentedFrame ?? -1, c?.targetFrame ?? -1, p.cf, p.target, c?.revealed ? 1 : 0, ready ? 1 : 0, id]);
      w.__profRaf = requestAnimationFrame(loop);
    };
    w.__profRaf = requestAnimationFrame(loop);
  });
  if (mode === 'rajadas') {
    for (let burst = 0; burst < 4; burst++) {
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, 100);
        await sleep(60);
      }
      await sleep(400);
    }
  } else {
    // rolagem contínua de mouse: ~5,5 sabores sem nenhuma pausa
    for (let i = 0; i < 70; i++) {
      await page.mouse.wheel(0, 100);
      await sleep(80);
    }
  }
  await sleep(1200);
  const prof = await page.evaluate(() => {
    cancelAnimationFrame(window.__profRaf);
    return window.__prof;
  });
  const seeks = await page.evaluate(() => window.__seeks);

  const dts = prof.slice(1).map((r, i) => r[0] - prof[i][0]);
  const sorted = [...dts].sort((a, b) => a - b);
  const pct = (q) => sorted[Math.floor(q * (sorted.length - 1))];
  const long = dts.filter((d) => d > 25).length;
  let springMax = 0;
  let springSum = 0;
  let springN = 0;
  let lagSum = 0;
  let lagN = 0;
  let posterReady = 0;
  for (const r of prof) {
    const gap = Math.abs(r[4] - r[3]);
    springMax = Math.max(springMax, gap);
    if (gap > 0) {
      springSum += gap;
      springN++;
    }
    if (!r[5]) {
      if (r[6]) posterReady++;
      continue;
    }
    const d = Math.abs(r[2] - r[1]);
    lagSum += Math.min(d, 180 - d);
    lagN++;
  }
  // congelamento: a lata exibida não muda enquanto o alvo já é outro
  let run = null;
  const freezes = [];
  for (let i = 1; i < prof.length; i++) {
    const [t, shown, target, , , revealed, , id] = prof[i];
    const frozen = id === prof[i - 1][7] && revealed && shown === prof[i - 1][1] && shown !== target;
    if (frozen) {
      if (!run) run = { t0: prof[i - 1][0], id, from: shown };
      run.t1 = t;
      run.to = target;
    } else if (run) {
      freezes.push(run);
      run = null;
    }
  }
  if (run) freezes.push(run);
  const bigFreezes = freezes.filter((f) => f.t1 - f.t0 > 50);
  const lat = [...seeks].sort((a, b) => a - b);
  const lq = (q) => (lat.length ? lat[Math.floor(q * (lat.length - 1))].toFixed(0) : '-');

  console.log(`== ${name}`);
  console.log(`  quadros ${prof.length}, intervalo p50 ${pct(0.5).toFixed(1)} p95 ${pct(0.95).toFixed(1)} max ${sorted.at(-1).toFixed(0)} ms, >25 ms: ${long}`);
  const videos = await page.evaluate(() => window.__fantaDebug.probe('videos'));
  console.log(`  nível ${videos?.quality ?? '?'}`);
  console.log(`  buscas ${lat.length}: p50 ${lq(0.5)} p90 ${lq(0.9)} max ${lq(1)} ms`);
  gate(pct(0.95) <= 17.5 && long <= prof.length * 0.02, `ritmo: p95 ${pct(0.95).toFixed(1)} ms (≤ 17,5) e ${long} quadros > 25 ms (≤ 2% = ${Math.floor(prof.length * 0.02)})`);
  gate(bigFreezes.length === 0, `congelamentos > 50 ms: ${bigFreezes.length} ${bigFreezes.map((f) => `${(f.t1 - f.t0).toFixed(0)}ms ${f.id} ${f.from}->${f.to}`).join(' | ')}`);
  gate(lagSum / Math.max(1, lagN) <= 1, `atraso médio do vídeo ${(lagSum / Math.max(1, lagN)).toFixed(2)} quadros (≤ 1)`);
  gate(posterReady === 0, `quadros só com a capa com o vídeo já baixado: ${posterReady}`);
  // a roda sem rolagem suave do navegador salta 100 px por clique: o pico sempre passa disso; vale a média em movimento
  const springMean = (springSum / Math.max(1, springN)) * geo.chapterPx;
  gate(springMean <= 100, `mola: em média ${springMean.toFixed(0)} px atrás da rolagem enquanto gira (≤ 100; pico ${(springMax * geo.chapterPx).toFixed(0)} px)`);
  if (process.env.TL) {
    for (let i = 0; i < prof.length; i += Math.ceil(prof.length / 50)) {
      const r = prof[i];
      console.log(`    t${(r[0] - prof[0][0]).toFixed(0).padStart(5)} cfAlvo ${r[4].toFixed(3)} cf ${r[3].toFixed(3)} alvo ${r[2]} na tela ${r[1]} rev ${r[5]} ${r[7]}`);
    }
  }
}

await pass('1ª passagem');
await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), geo.y);
await sleep(3000);
await pass('2ª passagem');
await browser.close();
console.log(failures.length ? `\n${failures.length} FALHA(S)` : '\nTODAS AS METAS OK');
process.exit(failures.length ? 1 : 0);
