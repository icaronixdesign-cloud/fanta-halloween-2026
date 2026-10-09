import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useInView } from '../interaction/hooks';
import { goToSection } from '../interaction/navigation';
import type { FinalShelf as Scene } from '../three/finalShelf';

/**
 * Vitrine final e CTA: as seis latas expostas e o Jack, pequeno, embaixo, carregando a caixa cheia de Fanta.
 * Ele chega andando pela lateral quando a seção aparece; as setas (tela ou teclado) o fazem andar enquanto
 * estão pressionadas, um toque dá um passo e um clique no palco o leva até ali. O título e o botão ficam por
 * cima do canvas, então ele passa por trás deles.
 */

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

/** Abaixo disto o toque na seta vira um passo, não uma caminhada contínua (ms). */
const TAP_MS = 220;
/** Pausa na rolagem (ms) que conta como "parado": hora de montar a cena sem ninguém ver o engasgo. */
const IDLE_LOAD_MS = 450;

export function FinalShelf({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  // o laço só roda com a seção à vista
  const visible = useInView(sectionRef, '0px');
  const [load, setLoad] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [arrived, setArrived] = useState(false);
  const pressedAt = useRef(0);

  // Carrega uma vez. Montar a cena (GLB, shaders, texturas) ocupa o thread principal por centenas de ms: feito no meio
  // da rolagem, travava a última lata dos sabores. Então, a até três telas daqui, espera uma pausa na rolagem; quem não
  // para de rolar carrega com uma tela de folga, como antes.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || load) return;
    let near = false;
    let idle = 0;
    const onScroll = () => {
      window.clearTimeout(idle);
      if (near) idle = window.setTimeout(() => setLoad(true), IDLE_LOAD_MS);
    };
    const early = new IntersectionObserver(
      ([entry]) => {
        near = entry.isIntersecting;
        onScroll();
      },
      { rootMargin: '300% 0px 300% 0px' },
    );
    const late = new IntersectionObserver(([entry]) => entry.isIntersecting && setLoad(true), {
      rootMargin: '100% 0px 100% 0px',
    });
    early.observe(section);
    late.observe(section);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      early.disconnect();
      late.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(idle);
    };
  }, [load]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !load) return;
    // um canvas (e um contexto WebGL) por instância, como no hero
    const canvas = document.createElement('canvas');
    canvas.className = 'final-shelf__canvas-el';
    mount.append(canvas);
    let disposed = false;
    const force = new URLSearchParams(window.location.search).get('jack');
    const mobile = force ? force === 'mobile' : window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    import('../three/finalShelf')
      .then(({ createFinalShelf }) =>
        createFinalShelf(canvas, { mobile, reduced: reducedMotion, onReady: () => !disposed && setState('ready') }),
      )
      .then((scene) => {
        if (disposed) scene.dispose();
        else sceneRef.current = scene;
      })
      .catch((error) => {
        console.error('[final-shelf]', error);
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

  // chegada: quando um bom pedaço da seção está na tela (uma vez só). O texto não espera o 3D; o Jack entra
  // assim que a cena fica pronta
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || arrived) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setArrived(true), {
      threshold: 0.45,
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [arrived]);

  useEffect(() => {
    if (arrived && state === 'ready') sceneRef.current?.enter();
  }, [arrived, state]);

  useEffect(() => {
    if (!finePointer || reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      sceneRef.current?.setPointer((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [finePointer, reducedMotion]);

  // teclado: ←/→ andam enquanto pressionadas, com metade da seção à vista (sem roubar as setas de campos e sliders)
  useEffect(() => {
    const section = sectionRef.current;
    if (!visible || !section) return;
    const pressed: number[] = [];
    const sync = () => sceneRef.current?.hold(pressed[pressed.length - 1] ?? 0);
    const dirOf = (event: KeyboardEvent) => (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
    const onDown = (event: KeyboardEvent) => {
      const dir = dirOf(event);
      if (!dir || event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], .final-shelf__arrow')) return;
      const r = section.getBoundingClientRect();
      if (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0) < window.innerHeight * 0.5) return;
      event.preventDefault();
      if (event.repeat || pressed.includes(dir)) return;
      pressed.push(dir);
      sync();
    };
    const onUp = (event: KeyboardEvent) => {
      const dir = dirOf(event);
      const index = pressed.indexOf(dir);
      if (index < 0) return;
      pressed.splice(index, 1);
      sync();
    };
    const release = () => {
      pressed.length = 0;
      sync();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [visible]);

  // clique/toque no palco: anda até ali
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let down: { x: number; y: number; id: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button === 0) down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const onUp = (event: PointerEvent) => {
      if (!down || down.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 10) return;
      const r = mount.getBoundingClientRect();
      sceneRef.current?.walkTo(((event.clientX - r.left) / r.width) * 2 - 1, -(((event.clientY - r.top) / r.height) * 2 - 1));
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('pointerup', onUp);
    return () => {
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('pointerup', onUp);
    };
  }, []);

  // setas da tela: segurar anda, um toque curto dá um passo; Enter/Espaço também dão um passo
  const dirOf = (element: HTMLElement) => Number(element.dataset.dir) || 0;
  const onArrowDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pressedAt.current = performance.now();
    sceneRef.current?.hold(dirOf(event.currentTarget));
  };
  const onArrowUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    sceneRef.current?.hold(0);
    // com movimento reduzido o próprio toque já deu o passo (sem caminhada contínua)
    if (!reducedMotion && performance.now() - pressedAt.current < TAP_MS) sceneRef.current?.step(dirOf(event.currentTarget));
    pressedAt.current = 0;
  };
  const onArrowRelease = () => sceneRef.current?.hold(0);
  const onArrowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (!event.repeat) sceneRef.current?.hold(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      sceneRef.current?.step(dirOf(event.currentTarget));
    }
  };
  const onArrowKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') sceneRef.current?.hold(0);
  };
  const arrowProps = {
    onPointerDown: onArrowDown,
    onPointerUp: onArrowUp,
    onPointerCancel: onArrowRelease,
    onLostPointerCapture: onArrowRelease,
    onKeyDown: onArrowKeyDown,
    onKeyUp: onArrowKeyUp,
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
  };

  return (
    <section
      id="vitrine"
      ref={sectionRef}
      className="final-shelf"
      aria-labelledby="vitrine-title"
      data-state={state}
      data-arrived={arrived}
    >
      <div
        ref={mountRef}
        className="final-shelf__canvas"
        role="img"
        aria-label="As seis latas da coleção Fanta Halloween expostas num chão espelhado; embaixo, Jack, o personagem de cabeça de abóbora, carrega uma caixa de ferro cheia de latas de Fanta"
      />

      <div className="final-shelf__copy">
        <p className="final-shelf__kicker">Edição Halloween 2026 · seis sabores</p>
        <h2 id="vitrine-title" className="final-shelf__title" tabIndex={-1} data-section-focus>
          <span className="final-shelf__line">Seis sustos</span>
          <span className="final-shelf__line">numa caixa só.</span>
        </h2>
        <a
          className="button final-shelf__cta"
          href="#sabores"
          onClick={(event) => {
            event.preventDefault();
            goToSection('sabores', reducedMotion);
          }}
        >
          Escolha o seu sabor
          <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
            <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" />
          </svg>
        </a>
      </div>

      <div className="final-shelf__controls" role="group" aria-label="Mover o Jack">
        <button type="button" className="final-shelf__arrow" aria-label="Andar para a esquerda" data-dir="-1" {...arrowProps}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="final-shelf__hint" aria-hidden="true">
          Mova o Jack
        </span>
        <button type="button" className="final-shelf__arrow" aria-label="Andar para a direita" data-dir="1" {...arrowProps}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </section>
  );
}
