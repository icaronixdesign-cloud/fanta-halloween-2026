import { launch, track, BASE, OUT, sleep, scrollToY, sectionY, waitSettled } from './lib.mjs';
const vps = process.argv[2] ? [JSON.parse(process.argv[2])] : [
  { name: 'd1440', width: 1440, height: 900 },
  { name: 't768', width: 768, height: 1024, mobile: true },
  { name: 'm390', width: 390, height: 844, mobile: true },
];
const browser = await launch();
const geomCheck = () => {
  const SAFE = { flavor: [0.325, 0.665, 0.115, 0.925], colecao: [0.055, 0.96, 0.27, 0.85] };
  const out = [];
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const frames = [...document.querySelectorAll('.framed-video')].filter((f) => {
    const r = f.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && (f.classList.contains('hero__video') || f.classList.contains('is-current') || f.classList.contains('closing__image'));
  });
  for (const f of frames) {
    const r = f.getBoundingClientRect();
    const s = f.classList.contains('showcase__layer') ? SAFE.flavor : SAFE.colecao;
    const safe = { l: r.left + s[0] * r.width, r: r.left + s[1] * r.width, t: r.top + s[2] * r.height, b: r.top + s[3] * r.height };
    const stage = f.closest('.hero__stage, .showcase__stage, .closing__frame').getBoundingClientRect();
    const inside = safe.l >= stage.left - 0.5 && safe.r <= stage.right + 0.5 && safe.t >= stage.top - 0.5 && safe.b <= stage.bottom + 0.5;
    const blockers = [...f.closest('.hero__stage, .showcase__stage, .closing')?.querySelectorAll('.hero__caption, .hero__chips, .hero__footer .button, .hero__labels li, .showcase__intro, .showcase__panel, .site-header') || []];
    const hits = [];
    const header = document.querySelector('.site-header').getBoundingClientRect();
    for (const b of [...blockers, document.querySelector('.site-header .button')]) {
      if (!b || !vis(b)) continue;
      // children text boxes to avoid false positives from big containers
      const boxes = b.matches('.showcase__intro, .showcase__panel, .hero__caption') ? [...b.querySelectorAll('h1,h3,p,dl,li,.spin-controls,.flavor-picker__list,.showcase__chapter-bar')].filter(vis).map((x) => [x, x.getBoundingClientRect()]) : [[b, b.getBoundingClientRect()]];
      for (const [x, br] of boxes) {
        const ix = Math.min(br.right, safe.r) - Math.max(br.left, safe.l), iy = Math.min(br.bottom, safe.b) - Math.max(br.top, safe.t);
        if (ix > 2 && iy > 2) hits.push(`${x.className || x.tagName}`.slice(0, 40) + ` ${Math.round(ix)}x${Math.round(iy)}`);
      }
    }
    out.push({ frame: f.className.split(' ').slice(1).join('.'), w: Math.round(r.width), safe: Object.fromEntries(Object.entries(safe).map(([k, v]) => [k, Math.round(v)])), inside, hits, headerBottom: Math.round(header.bottom) });
  }
  return { out, overflowX: document.documentElement.scrollWidth - innerWidth };
};
for (const vp of vps) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const log = []; track(page, log);
  await page.goto(BASE + '/?debug', { waitUntil: 'load' }); await sleep(1500);
  const shots = [['colecao', 0, 'colecao'], ['colecao', 0.45, 'colecao'], ['colecao', 0.85, 'colecao'], ['sabores', 0.03 / 6, 'sabor:ghost-face-punch'], ['sabores', 3.5 / 6, 'sabor:uva'], ['sabores', 5.97 / 6, 'sabor:caju']];
  for (const [id, p, label] of shots) {
    await scrollToY(page, await sectionY(page, id, p)); await sleep(1300);
    const s = await waitSettled(page, label, 8000);
    const g = await page.evaluate(geomCheck);
    const tag = `${vp.name}-${id}-${p.toFixed(3)}`;
    await page.screenshot({ path: `${OUT}${tag}.png` });
    console.log(tag, 'frame', s?.targetFrame, '/', s?.presentedFrame, s?.loadState, 'ovX', g.overflowX, JSON.stringify(g.out.map((o) => ({ f: o.frame, inside: o.inside, hits: o.hits, safe: o.safe }))));
  }
  await scrollToY(page, await page.evaluate(() => document.getElementById('sobre').getBoundingClientRect().top + scrollY + innerHeight * 0.55)); await sleep(1200);
  await page.screenshot({ path: `${OUT}${vp.name}-closing.png` });
  console.log(vp.name, 'closing', JSON.stringify((await page.evaluate(geomCheck)).out));
  await scrollToY(page, await page.evaluate(() => document.querySelector('.interlude').getBoundingClientRect().top + scrollY - innerHeight * 0.2)); await sleep(600);
  await page.screenshot({ path: `${OUT}${vp.name}-interlude.png` });
  console.log(vp.name, 'LOG', log);
  await ctx.close();
}
await browser.close();
