// Auditoria de peso e fluidez: abre o site, rola a página inteira num ritmo constante (como um trackpad) e mede, por
// seção, os bytes baixados, os intervalos de quadro (rAF), as tarefas longas e a memória de texturas WebGL. Roda no
// build de produção (npm run build + vite preview) em dois perfis:
//   desktop  1440×900, DPR 1
//   celular  390×844, DPR 3, CPU 4× mais lenta e rede "Fast 4G" (9 Mb/s, 60 ms)
// node scripts/verify/perf-audit.mjs [desktop|celular] [nome]   (BASE=http://localhost:4180)
// Saída: tabela no console e out/perf-<nome>-<perfil>.json
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { OUT, sleep } from './lib.mjs';

const BASE = process.env.BASE || 'http://localhost:4180';
const profile = process.argv[2] || 'desktop';
const name = process.argv[3] || 'baseline';
const mobile = profile === 'celular';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-zero-copy', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext(
  mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
);

// medidores dentro da página: quadros por seção, tarefas longas, FCP/LCP e bytes de textura por contexto WebGL
await context.addInitScript(() => {
  const w = window;
  w.__perf = { section: 'topo', frames: [], long: [], paint: {}, ctx: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__perf.long.push([e.startTime, e.duration, w.__perf.section]);
  }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__perf.paint[e.name] = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    const l = list.getEntries().pop();
    if (l) w.__perf.paint.lcp = l.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  // memória de texturas: soma o nível 0 de cada upload (×4/3 se gerar mipmaps), por contexto
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = orig.call(this, type, ...rest);
    if (!gl || !/webgl/.test(type) || gl.__tracked) return gl;
    gl.__tracked = true;
    const info = { bytes: 0, textures: 0, lost: false };
    w.__perf.ctx.push(info);
    const sizes = new Map();
    const bound = {};
    const set = (tex, bytes) => {
      info.bytes += bytes - (sizes.get(tex) || 0);
      if (!sizes.has(tex)) info.textures++;
      sizes.set(tex, bytes);
    };
    const bindTexture = gl.bindTexture.bind(gl);
    gl.bindTexture = (target, tex) => ((bound[target] = tex), bindTexture(target, tex));
    const dims = (args) => {
      // texImage2D(target, level, internalformat, width, height, border, format, type, src) ou (…, format, type, source)
      if (args.length >= 8 && typeof args[3] === 'number') return [args[3], args[4]];
      const src = args[args.length - 1];
      return src ? [src.videoWidth || src.naturalWidth || src.width || 0, src.videoHeight || src.naturalHeight || src.height || 0] : [0, 0];
    };
    const texImage2D = gl.texImage2D.bind(gl);
    gl.texImage2D = (...args) => {
      const tex = bound[args[0]];
      if (tex && args[1] === 0) {
        const [x, y] = dims(args);
        set(tex, x * y * 4);
      }
      return texImage2D(...args);
    };
    if (gl.texStorage2D) {
      const texStorage2D = gl.texStorage2D.bind(gl);
      gl.texStorage2D = (target, levels, fmt, x, y) => {
        const tex = bound[target];
        if (tex) set(tex, x * y * 4 * (levels > 1 ? 4 / 3 : 1));
        return texStorage2D(target, levels, fmt, x, y);
      };
    }
    const compressed = gl.compressedTexImage2D.bind(gl);
    gl.compressedTexImage2D = (...args) => {
      const tex = bound[args[0]];
      const data = args[args.length - 1];
      if (tex && data && data.byteLength) set(tex, (sizes.get(tex) || 0) * (args[1] === 0 ? 0 : 1) + data.byteLength);
      return compressed(...args);
    };
    const generateMipmap = gl.generateMipmap.bind(gl);
    gl.generateMipmap = (target) => {
      const tex = bound[target];
      if (tex && sizes.has(tex)) set(tex, (sizes.get(tex) * 4) / 3);
      return generateMipmap(target);
    };
    const deleteTexture = gl.deleteTexture.bind(gl);
    gl.deleteTexture = (tex) => {
      if (sizes.has(tex)) {
        info.bytes -= sizes.get(tex);
        info.textures--;
        sizes.delete(tex);
      }
      return deleteTexture(tex);
    };
    this.addEventListener('webglcontextlost', () => (info.lost = true));
    return gl;
  };
  let last = 0;
  const tick = (now) => {
    if (last) w.__perf.frames.push([now - last, w.__perf.section]);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
if (mobile) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8) });
}
// bytes por URL e por seção (a seção em que estava quando os bytes chegaram)
let section = 'topo';
const bytes = new Map();
const bySection = {};
const urlOf = new Map();
cdp.on('Network.requestWillBeSent', (e) => urlOf.set(e.requestId, e.request.url));
cdp.on('Network.dataReceived', (e) => {
  const n = e.encodedDataLength || 0;
  const url = urlOf.get(e.requestId) || '?';
  bytes.set(url, (bytes.get(url) || 0) + n);
  bySection[section] = (bySection[section] || 0) + n;
});

const t0 = Date.now();
await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
const loadMs = Date.now() - t0;
await page.waitForFunction(() => document.querySelector('.jack-hero__stage')?.dataset.state === 'ready', null, { timeout: 120000 });
const heroReadyMs = Date.now() - t0;
await sleep(1500);

// rola a página inteira: 1,1 tela por segundo, passos a cada quadro
const poll = setInterval(async () => {
  try {
    section = await page.evaluate(() => window.__perf.section);
  } catch {}
}, 100);
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const speed = innerHeight * 1.1;
      let y = 0;
      let last = performance.now();
      const step = (now) => {
        const total = document.documentElement.scrollHeight - innerHeight;
        y = Math.min(total, y + ((now - last) / 1000) * speed);
        last = now;
        window.scrollTo(0, y);
        // seção no meio da tela, medida ao vivo (a altura dos sabores muda depois que o JS monta os capítulos)
        const el = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).map((n) => n.closest('section[id]')).find(Boolean);
        window.__perf.section = el ? el.id : 'outro';
        if (y < total) requestAnimationFrame(step);
        else setTimeout(resolve, 2500);
      };
      requestAnimationFrame(step);
    }),
);
clearInterval(poll);
const perf = await page.evaluate(() => window.__perf);
await browser.close();

const stats = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { quadros: s.length, mediana: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(s[s.length - 1] ?? 0).toFixed(1), acima33ms: s.filter((x) => x > 33.4).length };
};
const ids = [...new Set(perf.frames.map((f) => f[1]))];
const result = {
  perfil: profile,
  base: BASE,
  carregamento_ms: loadMs,
  hero_pronto_ms: heroReadyMs,
  fcp_ms: Math.round(perf.paint['first-contentful-paint'] ?? 0),
  lcp_ms: Math.round(perf.paint.lcp ?? 0),
  rede_MB_total: +([...bytes.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1),
  rede_MB_por_secao: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, +(v / 1048576).toFixed(1)])),
  maiores_arquivos: [...bytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([u, v]) => `${u.split('/').pop().split('?')[0]} ${(v / 1048576).toFixed(2)} MB`),
  quadros_por_secao: Object.fromEntries(ids.map((id) => [id, stats(perf.frames.filter((f) => f[1] === id).map((f) => f[0]))])),
  tarefas_longas: Object.fromEntries(ids.map((id) => {
    const l = perf.long.filter((x) => x[2] === id);
    return [id, { n: l.length, max_ms: Math.round(Math.max(0, ...l.map((x) => x[1]))) }];
  })),
  webgl: { contextos: perf.ctx.length, perdidos: perf.ctx.filter((c) => c.lost).length, texturas_MB: perf.ctx.map((c) => +(c.bytes / 1048576).toFixed(0)) },
};
fs.writeFileSync(`${OUT}perf-${name}-${profile}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
