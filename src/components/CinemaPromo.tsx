import { useEffect, useRef, useState } from 'react';
import { CINEMA_PROMO } from '../data/cinemaPromo';
import { useInView, useScrollProgress } from '../interaction/hooks';
import type { CinemaPromo as Scene } from '../three/cinemaPromo';

/**
 * Promoção Fanta × Cinemark. O palco fica preso enquanto o scroll percorre a cena 3D em tela cheia (o Pânico sai do
 * fundo com o balde de pipoca, o vampiro o puxa com poderes e pega a Fanta Uva); no fim entra o painel da promoção
 * com o botão de cadastro e o detalhe da oferta. Com movimento reduzido a seção mostra só o quadro final.
 */

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

/** Trecho do scroll que percorre a animação (o resto é a chegada e o painel parado para ler). */
const PLAY_FROM = 0.04;
const PLAY_TO = 0.8;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function CinemaPromo({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const progressRef = useRef(0);
  const visible = useInView(sectionRef, '0px');
  const [load, setLoad] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const copy = CINEMA_PROMO;

  // carrega com uma tela de folga
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || load) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setLoad(true), {
      rootMargin: '100% 0px 100% 0px',
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [load]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !load) return;
    // um canvas (e um contexto WebGL) por instância, como nas outras cenas
    const canvas = document.createElement('canvas');
    canvas.className = 'cinema-promo__canvas-el';
    mount.append(canvas);
    let disposed = false;
    const force = new URLSearchParams(window.location.search).get('jack');
    const mobile = force ? force === 'mobile' : window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    import('../three/cinemaPromo')
      .then(({ createCinemaPromo }) =>
        createCinemaPromo(canvas, { mobile, reduced: reducedMotion, onReady: () => !disposed && setState('ready') }),
      )
      .then((scene) => {
        if (disposed) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        scene.setProgress(progressRef.current);
      })
      .catch((error) => {
        console.error('[cinema-promo]', error);
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [load, reducedMotion]);

  useEffect(() => {
    sceneRef.current?.setActive(visible);
  }, [visible, state]);

  useScrollProgress(
    sectionRef,
    stageRef,
    ({ progress }) => {
      const t = smooth(0, 1, (progress - PLAY_FROM) / (PLAY_TO - PLAY_FROM)) * 0.12 +
        Math.min(Math.max((progress - PLAY_FROM) / (PLAY_TO - PLAY_FROM), 0), 1) * 0.88;
      progressRef.current = t;
      sceneRef.current?.setProgress(t);
      const stage = stageRef.current;
      if (!stage) return;
      const panel = smooth(0.78, 0.88, progress);
      stage.style.setProperty('--panel', panel.toFixed(4));
      stage.style.setProperty('--hint', (1 - smooth(0.0, 0.05, progress)).toFixed(4));
      stage.dataset.panel = panel > 0.5 ? 'on' : 'off';
    },
    !reducedMotion,
  );

  useEffect(() => {
    if (!finePointer || reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      sceneRef.current?.setPointer((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [finePointer, reducedMotion]);

  return (
    <section
      id="cinema"
      ref={sectionRef}
      className="cinema-promo"
      aria-labelledby="cinema-title"
      data-reduced={reducedMotion}
    >
      <div ref={stageRef} className="cinema-promo__stage" data-state={state} data-panel={reducedMotion ? 'on' : 'off'}>
        <div
          ref={mountRef}
          className="cinema-promo__canvas"
          role="img"
          aria-label="Numa sala de cinema escura, o Pânico sai da luz da tela segurando um balde de pipoca; um vampiro de terno entra pela esquerda, estende a mão e puxa o balde no ar com um rastro roxo até a palma dele, depois pega uma Fanta Uva que flutuava à sua frente e a mostra"
        />

        <p className="cinema-promo__tag" aria-hidden="true">
          <span className="cinema-promo__tag-dot" />
          {copy.tag}
        </p>
        <p className="cinema-promo__hint" aria-hidden="true">
          Role para a sessão começar
        </p>

        <div className="cinema-promo__panel">
          <p className="cinema-promo__kicker">{copy.kicker}</p>
          <h2 id="cinema-title" className="cinema-promo__title" tabIndex={-1} data-section-focus>
            <span className="cinema-promo__line">{copy.title[0]}</span>
            <span className="cinema-promo__line">{copy.title[1]}</span>
          </h2>
          <p className="cinema-promo__lead">{copy.lead}</p>
          <div className="cinema-promo__offer">
            <h3 className="visually-hidden">{copy.offer.title}</h3>
            <div className="cinema-promo__tickets" aria-hidden="true">
              {[2, 1].map((n) => (
                <div key={n} className={`cinema-promo__ticket cinema-promo__ticket--${n === 1 ? 'front' : 'back'}`}>
                  <div className="cinema-promo__ticket-main">
                    <p className="cinema-promo__ticket-brand">{copy.ticket.brand}</p>
                    <p className="cinema-promo__ticket-discount">{copy.ticket.discount}</p>
                    <p className="cinema-promo__ticket-note">{copy.ticket.note}</p>
                  </div>
                  <div className="cinema-promo__ticket-stub">
                    <span className="cinema-promo__ticket-admit">{copy.ticket.stub}</span>
                    <span className="cinema-promo__ticket-no">Nº 0{n}</span>
                    <span className="cinema-promo__ticket-bars" />
                  </div>
                </div>
              ))}
            </div>
            <p className="cinema-promo__offer-text">{copy.offer.text}</p>
          </div>
          <a className="button cinema-promo__cta" href={copy.cta.href} target="_blank" rel="noopener noreferrer">
            {copy.cta.label}
            <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2.4" />
            </svg>
            <span className="visually-hidden"> (abre em nova aba)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
