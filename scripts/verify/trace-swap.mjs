// Trace do Chrome atravessando a 1ª troca de sabor (rolagem suave): soma o tempo da thread principal por tipo de
// evento e lista os quadros mais caros. Uso: BASE=http://localhost:5192 node scripts/verify/trace-swap.mjs [variante]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, OUT, sleep, scrollToY, sectionY } from './lib.mjs';

const variant = process.argv[2] || 'normal';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + '/?debug', { waitUntil: 'load' });
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await scrollToY(page, await sectionY(page, 'sabores', 0.8 / 6));
await sleep(5000);
await page.mouse.move(720, 450);
const cdp = await ctx.newCDPSession(page);
const events = [];
cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
await cdp.send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8.execute,media,gpu,viz,cc',
  transferMode: 'ReportEvents',
});
for (let i = 0; i < 70; i++) {
  await page.mouse.wheel(0, 9);
  await sleep(16);
}
await sleep(500);
await cdp.send('Tracing.end');
await done;
fs.writeFileSync(`${OUT}trace-swap-${variant}.json`, JSON.stringify(events));
// thread principal do renderer: a que tem eventos 'UpdateLayoutTree'/'FunctionCall'
const byTid = new Map();
for (const e of events) if (e.ph === 'X' && e.dur) byTid.set(`${e.pid}:${e.tid}`, (byTid.get(`${e.pid}:${e.tid}`) || 0) + e.dur);
const names = new Map();
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
const top = [...byTid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('threads (ms):', top.map(([k, v]) => `${names.get(k) || k}=${(v / 1000).toFixed(0)}`).join('  '));
const main = [...names.entries()].find(([, n]) => n === 'CrRendererMain')?.[0];
const agg = new Map();
for (const e of events) {
  if (e.ph !== 'X' || !e.dur || `${e.pid}:${e.tid}` !== main) continue;
  agg.set(e.name, (agg.get(e.name) || 0) + e.dur);
}
console.log('principal (ms):', [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, d]) => `${n}=${(d / 1000).toFixed(1)}`).join('  '));
const tasks = events.filter((e) => e.ph === 'X' && `${e.pid}:${e.tid}` === main && e.name === 'RunTask' && e.dur > 12000);
console.log('tarefas >12 ms na principal:', tasks.length, tasks.map((t) => (t.dur / 1000).toFixed(0)).join(' '));
await browser.close();
