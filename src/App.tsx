import { JackHero } from './components/JackHero';
import { FinalCta } from './components/FinalCta';
import { FinalShelf } from './components/FinalShelf';
import { FlavorShowcase } from './components/FlavorShowcase';
import { Interlude } from './components/Interlude';
import { SiteHeader } from './components/SiteHeader';
import { useFinePointer, usePrefersReducedMotion } from './interaction/hooks';

export function App() {
  const reducedMotion = usePrefersReducedMotion();
  const finePointer = useFinePointer();

  return (
    <div className="site" data-motion={reducedMotion ? 'reduced' : 'full'}>
      <a className="skip-link" href="#sabores">
        Pular para os sabores
      </a>
      <SiteHeader reducedMotion={reducedMotion} />
      <main>
        <JackHero reducedMotion={reducedMotion} finePointer={finePointer} />
        <Interlude reducedMotion={reducedMotion} />
        <FlavorShowcase reducedMotion={reducedMotion} finePointer={finePointer} />
        <FinalCta reducedMotion={reducedMotion} />
        <FinalShelf reducedMotion={reducedMotion} finePointer={finePointer} />
      </main>
      <footer className="site-footer">
        <p>Fanta Halloween 2026 · apresentação conceitual, não oficial.</p>
        <a href="#colecao">Voltar ao topo</a>
      </footer>
      <div className="cut-overlay" aria-hidden="true" />
    </div>
  );
}
