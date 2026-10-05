import { useEffect, useRef, useState } from 'react';
import { goToSection } from '../interaction/navigation';

const LINKS = [
  { id: 'colecao', label: 'Coleção' },
  { id: 'sabores', label: 'Sabores' },
  { id: 'sobre', label: 'Sobre' },
];

interface Props {
  reducedMotion: boolean;
}

export function SiteHeader({ reducedMotion }: Props) {
  const progressRef = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState('colecao');

  // Linha de progresso da página (escrita direto no DOM) e seção atual (só muda de vez em quando).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      progressRef.current?.style.setProperty('transform', `scaleX(${progress.toFixed(4)})`);
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
      <span className="site-header__progress" aria-hidden="true">
        <span ref={progressRef} />
      </span>
    </header>
  );
}
