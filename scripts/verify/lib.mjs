import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/**
 * Utilitários dos testes de navegador. Usa o Google Chrome instalado (canal "chrome"), que
 * decodifica H.264; defina CHROME_PATH para outro executável e BASE para outra URL.
 */
export const BASE = process.env.BASE || 'http://localhost:5190';
export const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
export async function launch() {
  const executablePath = process.env.CHROME_PATH;
  return chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
}
export function track(page, log) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText || ''; if (!/ERR_ABORTED/.test(f)) log.push(`[reqfail] ${r.url()} ${f}`); });
  page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.url()}`); });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function scrollToY(page, y) { await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y); }
export async function sectionY(page, id, progress = 0) {
  return page.evaluate(({ id, progress }) => {
    const s = document.getElementById(id); const top = s.getBoundingClientRect().top + scrollY;
    const stage = s.querySelector('[class*="__stage"]'); const range = s.offsetHeight - (stage ? stage.offsetHeight : innerHeight);
    return Math.round(top + range * progress);
  }, { id, progress });
}
export async function snap(page) { return page.evaluate(() => window.__fantaDebug ? window.__fantaDebug.snapshot() : null); }
export async function waitScrollIdle(page, timeout = 4000) {
  let last = -1, same = 0; const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const y = await page.evaluate(() => scrollY); if (y === last) { if (++same >= 3) return y; } else { same = 0; last = y; } await sleep(90); }
  return last;
}
export async function waitSettled(page, label, timeout = 6000) {
  await waitScrollIdle(page);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await page.evaluate((l) => { const c = window.__fantaDebug?.controllers.get(l); return c ? c.getSnapshot() : null; }, label);
    // Sabores: o capítulo contínuo (suavizado) também precisa ter alcançado a rolagem.
    const chapterSettled = !label.startsWith('sabor:') || (await page.evaluate(() => window.__fantaDebug?.probe('showcase')?.settled !== false));
    const converged = s && chapterSettled && (s.mode !== 'scroll' || s.targetFrame === s.scrollTargetFrame);
    if (s && converged && !s.seekPending && s.requestedFrame === s.targetFrame && s.presentedFrame === s.targetFrame && s.revealed) return s;
    await sleep(80);
  }
  return page.evaluate((l) => window.__fantaDebug?.controllers.get(l)?.getSnapshot(), label);
}
