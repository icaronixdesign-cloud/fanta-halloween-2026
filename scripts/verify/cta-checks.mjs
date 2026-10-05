import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';

/**
 * CTA final: (1) movimento reduzido mostra a composição final parada, sem vídeo;
 * (2) o botão leva ao capítulo da Uva; (3) rolagem real com roda acompanha o vídeo sem travar.
 */

const browser = await launch();
const log = [];
const results = [];

// 1) movimento reduzido
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  track(page, log);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await scrollToY(page, await sectionY(page, 'cta', 0));
  await sleep(1200);
  const state = await page.evaluate(() => {
    const s = document.querySelector('.cta');
    const chars = [...document.querySelectorAll('.cta__char')].map((c) => getComputedStyle(c).opacity);
    const action = document.querySelector('.cta__action').getBoundingClientRect();
    return {
      height: s.offsetHeight,
      videos: s.querySelectorAll('video').length,
      cards: s.querySelectorAll('.cta__card').length,
      charsVisible: chars.every((o) => o === '1'),
      actionInView: action.bottom <= innerHeight && action.top >= 0,
      poster: s.querySelector('.cta__still img')?.currentSrc.split('/').pop(),
    };
  });
  results.push(['reduced', state]);
  await page.screenshot({ path: `${OUT}cta-reduced.png` });
  await context.close();
}

// 2) clique no botão e 3) rolagem com roda
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  track(page, log);
  await page.goto(`${BASE}/?debug`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });

  await scrollToY(page, (await sectionY(page, 'cta', 0)) - 900);
  await sleep(600);
  await page.mouse.move(720, 450);
  const samples = [];
  for (let i = 0; i < 90; i += 1) {
    await page.mouse.wheel(0, 40);
    await sleep(16);
    if (i % 6 === 5) {
      samples.push(
        await page.evaluate(() => {
          const c = window.__fantaDebug?.controllers.get('cta')?.getSnapshot();
          return c ? Math.abs(c.targetFrame - c.presentedFrame) : null;
        }),
      );
    }
  }
  const settled = await waitSettled(page, 'cta');
  results.push(['wheel lag (frames) while scrolling', samples.join(' '), 'settled', settled?.presentedFrame, settled?.targetFrame, 'timeouts', settled?.seekTimeouts]);

  await scrollToY(page, await sectionY(page, 'cta', 0.95));
  await sleep(900);
  await page.click('.cta__action');
  await sleep(2200);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    focus: document.activeElement?.className || document.activeElement?.tagName,
    flavor: document.querySelector('.showcase__stage')?.dataset.flavor ?? null,
    title: document.querySelector('[data-flavor-name], .showcase__name')?.textContent?.trim() ?? null,
  }));
  results.push(['after click', after]);
  await page.screenshot({ path: `${OUT}cta-after-click.png` });
  await context.close();
}

await browser.close();
for (const r of results) console.log(...r.map((v) => (typeof v === 'object' ? JSON.stringify(v) : v)));
if (log.length) console.log(log.join('\n'));
