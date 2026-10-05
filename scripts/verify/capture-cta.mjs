import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';

/**
 * Capturas da CTA final em batidas-chave da referência (0–163), em desktop e celular.
 * Uso: node scripts/verify/capture-cta.mjs [batidas separadas por vírgula]
 */

const PLAY_END = 0.86;
// 'in' = palco entrando (meia tela antes de prender); 'out' = depois de soltar (rodapé).
const beats = (process.argv[2] || 'in,0,23,45,70,100,114,122,128,138,145,163,out').split(',');
const viewports = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

const browser = await launch();
const log = [];
for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor || 1,
  });
  const page = await context.newPage();
  track(page, log);
  await page.goto(`${BASE}/?debug`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  for (const beat of beats) {
    const top = await sectionY(page, 'cta', 0);
    const vh = vp.height;
    const y =
      beat === 'in' ? top - vh * 0.45 : beat === 'out' ? (await sectionY(page, 'cta', 1)) + vh * 0.4 : await sectionY(page, 'cta', (Number(beat) / 163) * PLAY_END);
    await scrollToY(page, y);
    await sleep(500);
    const snap = await waitSettled(page, 'cta');
    const geo = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { title: r('.cta__title'), action: r('.cta__action'), docW: document.documentElement.scrollWidth };
    });
    console.log(vp.name, 'beat', beat, 'frame', snap?.presentedFrame, '/', snap?.targetFrame, JSON.stringify(geo));
    await page.screenshot({ path: `${OUT}cta-${vp.name}-${String(beat).padStart(3, '0')}.png` });
  }
  await context.close();
}
await browser.close();
if (log.length) console.log(log.join('\n'));
