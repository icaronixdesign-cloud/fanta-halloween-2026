import { useEffect, useState } from 'react';
import { goToSection } from '../interaction/navigation';

const LINKS = [
  { id: 'colecao', label: 'Coleção' },
  { id: 'sabores', label: 'Sabores' },
  { id: 'vitrine', label: 'Vitrine' },
];

interface Props {
  reducedMotion: boolean;
}

/**
 * Teia de canto (origem no canto de cima à esquerda): raios em leque e fios que cedem entre eles, gerada
 * uma vez. O lado direito usa a mesma teia espelhada.
 */
const WEB_W = 220;
const WEB_H = 120;
const WEB_PATH = (() => {
  const spokes = [3, 13, 25, 38, 52, 67, 82].map((deg) => (deg * Math.PI) / 180);
  const reach = (a: number) => Math.min(WEB_W / Math.cos(a), WEB_H / Math.sin(a), 240);
  const at = (a: number, r: number) => [r * Math.cos(a), r * Math.sin(a)];
  const f = (n: number) => n.toFixed(1);
  let d = '';
  for (const a of spokes) {
    const [x, y] = at(a, reach(a));
    d += `M0 0L${f(x)} ${f(y)}`;
  }
  // fios: de raio em raio, com a curva puxada para o centro (a teia cede)
  const rings = [16, 32, 50, 70, 92, 116, 142, 170];
  rings.forEach((r, k) => {
    for (let i = 0; i < spokes.length - 1; i += 1) {
      const a0 = spokes[i];
      const a1 = spokes[i + 1];
      const r0 = r * (1 + 0.05 * Math.sin(k * 3.1 + i));
      const r1 = r * (1 + 0.05 * Math.sin(k * 3.1 + i + 1));
      if (r0 > reach(a0) || r1 > reach(a1)) continue;
      const [x0, y0] = at(a0, r0);
      const [x1, y1] = at(a1, r1);
      const [cx, cy] = at((a0 + a1) / 2, ((r0 + r1) / 2) * 0.86);
      d += `M${f(x0)} ${f(y0)}Q${f(cx)} ${f(cy)} ${f(x1)} ${f(y1)}`;
    }
  });
  return d;
})();

function Cobweb({ side }: { side: 'left' | 'right' }) {
  const id = `web-fade-${side}`;
  return (
    <svg className={`site-header__web is-${side}`} viewBox={`0 0 ${WEB_W} ${WEB_H}`} aria-hidden="true">
      <defs>
        <radialGradient
          id={id}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform={`scale(${WEB_W} ${WEB_H * 1.6})`}
        >
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width={WEB_W} height={WEB_H} fill={`url(#${id})`} />
        </mask>
      </defs>
      <path d={WEB_PATH} mask={`url(#${id}-mask)`} />
    </svg>
  );
}

export function SiteHeader({ reducedMotion }: Props) {
  const [current, setCurrent] = useState('colecao');

  // Seção atual (só muda de vez em quando).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const probe = window.innerHeight * 0.45;
      let active = LINKS[0].id;
      for (const link of LINKS) {
        const element = document.getElementById(link.id);
        if (element && element.getBoundingClientRect().top <= probe) active = link.id;
      }
      setCurrent((previous) => (previous === active ? previous : active));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className="site-header">
      <Cobweb side="left" />
      <Cobweb side="right" />
      <span className="site-header__spider" aria-hidden="true">
        <span className="site-header__thread" />
        <svg viewBox="0 0 24 22">
          <path
            className="site-header__legs"
            d="M10 9 6 5 2 6M10 11 5 9 1 11M10 13 5 14 2 18M11 14 8 18 7 21M14 9l4-4 4 1M14 11l5-2 4 2M14 13l5 1 3 4M13 14l3 4 1 3"
          />
          <ellipse cx="12" cy="14" rx="3.6" ry="4.4" />
          <circle cx="12" cy="8.6" r="2.4" />
          <circle className="site-header__eye" cx="11.1" cy="8.2" r="0.55" />
          <circle className="site-header__eye" cx="12.9" cy="8.2" r="0.55" />
        </svg>
      </span>
      <a
        className="site-header__brand"
        href="#colecao"
        onClick={(event) => {
          event.preventDefault();
          goToSection('colecao', reducedMotion);
        }}
      >
        <span className="site-header__brand-name">Fanta</span>
        <span className="site-header__brand-edition">Halloween 2026</span>
      </a>
      <nav className="site-header__nav" aria-label="Seções">
        <ul>
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                href={`#${link.id}`}
                aria-current={current === link.id ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  goToSection(link.id, reducedMotion);
                }}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <a
        className="button is-small is-primary site-header__cta"
        href="#sabores"
        onClick={(event) => {
          event.preventDefault();
          goToSection('sabores', reducedMotion);
        }}
      >
        Explore os sabores
      </a>
    </header>
  );
}
