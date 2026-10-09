// Trace do Chrome durante a rolagem na seção de sabores: onde vai o tempo do thread principal, quantos elementos cada
// recálculo de estilo toca, quem invalida estilo a cada quadro e quem força layout pelo JS.
// Uso: BASE=http://localhost:4180 node scripts/verify/trace-sabores.mjs [forte|fraco]
// Com o servidor de dev (BASE=http://localhost:5190) os nomes das funções aparecem sem minificação.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, OUT, sleep } from './lib.mjs';

const profile = process.argv[2] || 'fraco';
const weak = profile === 'fraco';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.env.HEADED,
  args: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(weak ? ['--disable-accelerated-video-decode'] : []),
  ],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const cdp = await page.context().newCDPSession(page);
if (weak) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
// diagnóstico: HIDE=<css> esconde peças; NOJACK=1 não carrega o Jack dos sabores
if (process.env.NOJACK) await page.route('**/jack-admire.glb', (route) => route.abort());
await page.goto(BASE + '/?debug' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
if (process.env.HIDE) await page.addStyleTag({ content: process.env.HIDE });
const y = await page.evaluate(() => {
  const s = document.getElementById('sabores');
  const top = s.getBoundingClientRect().top + scrollY;
  return Math.round(top + (s.offsetHeight - s.querySelector('.showcase__stage').offsetHeight) * (0.3 / 6));
});
await sleep(4000);
await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
await sleep(5000);
await page.mouse.move(720, 450);
const file = `${OUT}trace-sabores-${profile}.json`;
await browser.startTracing(page, {
  path: file,
  categories: [
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.invalidationTracking',
    'disabled-by-default-devtools.timeline.stack',
    'blink',
    'cc',
    'gpu',
    'media',
  ],
});
// rola e mexe o mouse junto, como uma pessoa
for (let i = 0; i < 30; i++) {
  await page.mouse.wheel(0, 100);
  await sleep(60);
  await page.mouse.move(700 + (i % 5) * 8, 440 + (i % 3) * 6);
}
await sleep(800);
await browser.stopTracing();
await browser.close();

const events = JSON.parse(readFileSync(file, 'utf8')).traceEvents;
const threads = {};
for (const e of events) if (e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name;
const main = events.filter((e) => /CrRendererMain/.test(threads[`${e.pid}:${e.tid}`] || ''));
const timed = main.filter((e) => e.ph === 'X' && e.ts > 0);
const span = (Math.max(...timed.map((e) => e.ts + (e.dur || 0))) - Math.min(...timed.map((e) => e.ts))) / 1000;
const total = (name) => main.filter((e) => e.name === name && e.dur).reduce((sum, e) => sum + e.dur / 1000, 0);
console.log(`[${profile}] janela ${span.toFixed(0)} ms do thread principal`);
for (const name of ['ProxyMain::BeginMainFrame', 'UpdateLayoutTree', 'Layout', 'FunctionCall', 'Paint', 'RunAccessibilitySteps', 'LocalFrameView::RunAccessibilitySteps']) {
  const ms = total(name);
  if (ms) console.log(`  ${name.padEnd(40)} ${ms.toFixed(0).padStart(6)} ms (${((ms / span) * 100).toFixed(0)}%)`);
}
// tempo próprio (sem os filhos) por evento: mostra onde o thread principal realmente gasta
const self = {};
const stack = [];
for (const e of [...timed].filter((x) => x.dur).sort((a, b) => a.ts - b.ts || b.dur - a.dur)) {
  while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
  self[e.name] = (self[e.name] || 0) + e.dur / 1000;
  if (stack.length) self[stack.at(-1).name] -= e.dur / 1000;
  stack.push(e);
}
console.log('\n  tempo próprio por evento:');
for (const [k, v] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${v.toFixed(0).padStart(6)} ms ${k}`);
const counts = main
  .filter((e) => e.name === 'UpdateLayoutTree' && e.dur)
  .map((e) => e.args?.elementCount ?? e.args?.endData?.elementCount ?? 0)
  .sort((a, b) => a - b);
console.log(`  recálculos de estilo: ${counts.length}, elementos por vez p50 ${counts[counts.length >> 1] ?? 0} max ${counts.at(-1) ?? 0}`);

const inval = {};
for (const e of main) {
  if (e.name !== 'StyleRecalcInvalidationTracking') continue;
  const d = e.args?.data || {};
  const key = `${d.reason || ''} | ${(d.nodeName || '').slice(0, 60)}`;
  inval[key] = (inval[key] || 0) + 1;
}
console.log('\n  invalidações de estilo mais frequentes:');
for (const [k, v] of Object.entries(inval).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(v).padStart(6)} ${k}`);

const fn = {};
for (const e of main) {
  if (e.name !== 'FunctionCall' || !e.dur) continue;
  const d = e.args?.data || {};
  const key = `${d.functionName || '(anônima)'} @ ${(d.url || '').split('/').pop()}:${d.lineNumber}`;
  fn[key] = (fn[key] || 0) + e.dur / 1000;
}
console.log('\n  JS por função:');
for (const [k, v] of Object.entries(fn).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${v.toFixed(0).padStart(6)} ms ${k}`);

const forced = {};
for (const e of main) {
  if (e.name !== 'Layout' && e.name !== 'UpdateLayoutTree') continue;
  const stack = e.args?.beginData?.stackTrace || e.args?.stackTrace;
  if (!stack?.length) continue;
  const key = `${e.name} <- ${stack.slice(0, 3).map((f) => `${f.functionName}@${(f.url || '').split('/').pop()}:${f.lineNumber}`).join(' <- ')}`;
  forced[key] = (forced[key] || 0) + (e.dur || 0) / 1000;
}
console.log('\n  estilo/layout forçado pelo JS:');
for (const [k, v] of Object.entries(forced).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${v.toFixed(0).padStart(6)} ms ${k}`);
const stageHits = Object.entries(inval).filter(([k]) => k.includes('showcase__stage')).reduce((s, [, v]) => s + v, 0);
console.log(`\n  invalidações no .showcase__stage: ${stageHits}`);
