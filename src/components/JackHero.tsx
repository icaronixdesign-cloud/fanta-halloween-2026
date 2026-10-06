import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flavorById } from '../data/products';
import { useInView, useScrollProgress } from '../interaction/hooks';
import { glideTo, goToFlavor, goToSection } from '../interaction/navigation';
import type { JackHero as Scene } from '../three/jackHero';

/**
 * Abertura com o Jack em 3D (gravidade zero, latas da coleção orbitando).
 * O palco fica preso enquanto o scroll leva do close com a chamada até o Jack oferecendo a lata;
 * no fim, as latas formam uma vitrine atrás dele e cada troca (setas, clique na lata, arraste ou
 * teclado) faz o Jack levar a lata às costas e voltar com o sabor que chegou ao centro.
 * O módulo three.js é carregado sob demanda; o texto aparece antes dele.
 */

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

// mesma ordem de HERO_FLAVORS e PICK_FROM do módulo 3D (que só chega depois)
const PICK_IDS = ['ghost-face-punch', 'guarana', 'maracuja', 'uva', 'laranja', 'caju'];
const PICK_FROM = 0.8;
type Phase = 'intro' | 'travel' | 'pick';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function JackHero({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const phaseRef = useRef<Phase>('intro');
  const near = useInView(sectionRef, '20% 0px 20% 0px');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [picked, setPicked] = useState({ index: PICK_IDS.indexOf('laranja'), dir: 0 });
  const flavor = flavorById(PICK_IDS[picked.index]);

  // só lê refs: estável para os ouvintes registrados uma vez
  const go = useCallback((delta: number) => {
    if (phaseRef.current !== 'pick') return;
    if (sceneRef.current?.go(delta)) setPicked((prev) => ({ ...prev, dir: Math.sign(delta) }));
  }, []);

  // gole: a cena decide se pode (só na vitrine); o palco ganha data-drinking para o botão e o cursor
  const setDrinking = useCallback((on: boolean) => {
    const ok = sceneRef.current?.drink(on) ?? false;
    const drinking = on && ok;
    const stage = stageRef.current;
    if (stage) stage.dataset.drinking = String(drinking);
    return drinking;
  }, []);

  // botão secundário: rola o hero inteiro até a vitrine (o Jack gira e as latas entram no caminho) e põe o
  // foco no seletor; sem movimento não há vitrine, então vai para a coleção no fim da página
  const showCollection = useCallback(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (reducedMotion || !section || !stage) {
      goToSection('sobre', reducedMotion);
      return;
    }
    const top = section.getBoundingClientRect().top + window.scrollY;
    glideTo(top + (section.offsetHeight - stage.offsetHeight) * 0.9, 3000, () => {
      let frames = 0;
      const focus = () => {
        const picker = pickerRef.current;
        if (picker && !picker.inert) picker.querySelectorAll<HTMLElement>('.jack-hero__arrow')[1]?.focus({ preventScroll: true });
        else if (++frames < 30) requestAnimationFrame(focus);
      };
      focus();
    });
  }, [reducedMotion]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // um canvas (e um contexto WebGL) por instância: duas cenas no mesmo contexto se corrompem
    const canvas = document.createElement('canvas');
    canvas.className = 'jack-hero__canvas-el';
    mount.append(canvas);
    let disposed = false;
    const force = new URLSearchParams(window.location.search).get('jack');
    const mobile = force ? force === 'mobile' : window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    import('../three/jackHero')
      .then(({ createJackHero }) =>
        createJackHero(canvas, {
          mobile,
          reduced: reducedMotion,
          onReady: () => !disposed && setState('ready'),
          onSelect: (index) => !disposed && setPicked((prev) => ({ ...prev, index })),
        }),
      )
      .then((scene) => {
        if (disposed) scene.dispose();
        else sceneRef.current = scene;
      })
      .catch((error) => {
        console.error('[jack-hero]', error);
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [reducedMotion]);

  useEffect(() => {
    sceneRef.current?.setActive(near);
  }, [near, state]);

  useEffect(() => {
    if (!finePointer || reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      sceneRef.current?.setPointer((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [finePointer, reducedMotion]);

  // vitrine: arrastar na horizontal troca de sabor; tocar/clicar numa lata a traz para o centro;
  // segurar sobre o Jack faz ele beber até soltar; setas do teclado enquanto a vitrine está na tela
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || reducedMotion) return;
    let start: { x: number; y: number; id: number; onJack: boolean } | null = null;
    let holdTimer = 0;
    let drinking = false;
    const toNdc = (event: PointerEvent): [number, number] => {
      const r = mount.getBoundingClientRect();
      return [((event.clientX - r.left) / r.width) * 2 - 1, -(((event.clientY - r.top) / r.height) * 2 - 1)];
    };
    const stopDrink = () => {
      window.clearTimeout(holdTimer);
      if (drinking) setDrinking(false);
      drinking = false;
    };
    const onDown = (event: PointerEvent) => {
      if (phaseRef.current !== 'pick' || event.button !== 0) return;
      const onJack = sceneRef.current?.hitJack(...toNdc(event)) ?? false;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId, onJack };
      // um instante parado antes de beber, para o arraste continuar trocando de sabor
      if (onJack) holdTimer = window.setTimeout(() => {
        drinking = setDrinking(true);
      }, 90);
    };
    const onMove = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId || drinking) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) window.clearTimeout(holdTimer);
    };
    const onUp = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      const wasDrinking = drinking;
      start = null;
      stopDrink();
      if (wasDrinking) return;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        go(dx < 0 ? 1 : -1);
      } else if (Math.hypot(dx, dy) < 10) {
        const k = sceneRef.current?.pickAt(...toNdc(event)) ?? 0;
        if (k) go(k);
      }
    };
    const onCancel = () => {
      start = null;
      stopDrink();
    };
    // segurar no celular não abre o menu de contexto da imagem
    const onContext = (event: Event) => {
      if (phaseRef.current === 'pick') event.preventDefault();
    };
    const onKey = (event: KeyboardEvent) => {
      if (phaseRef.current !== 'pick' || event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      go(event.key === 'ArrowRight' ? 1 : -1);
    };
    mount.addEventListener('pointerdown', onDown);
    mount.addEventListener('contextmenu', onContext);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      stopDrink();
      mount.removeEventListener('pointerdown', onDown);
      mount.removeEventListener('contextmenu', onContext);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [reducedMotion, go, setDrinking]);

  useScrollProgress(
    sectionRef,
    stageRef,
    ({ progress }) => {
      sceneRef.current?.setProgress(progress);
      const stage = stageRef.current;
      if (!stage) return;
      // a chamada sai para a esquerda junto com a câmera (como no stack do Figma)
      const out = smooth(0.08, 0.4, progress);
      stage.style.setProperty('--text-x', out.toFixed(4));
      stage.style.setProperty('--text-o', (1 - smooth(0.16, 0.38, progress)).toFixed(4));
      stage.style.setProperty('--end-o', smooth(0.74, 0.84, progress).toFixed(4));
      const phase: Phase = progress >= PICK_FROM ? 'pick' : progress > 0.3 ? 'travel' : 'intro';
      if (phase !== phaseRef.current) {
        phaseRef.current = phase;
        stage.dataset.phase = phase;
        if (pickerRef.current) pickerRef.current.inert = phase !== 'pick';
      }
    },
    !reducedMotion,
  );

  return (
    <section id="colecao" ref={sectionRef} className="jack-hero" aria-labelledby="hero-title" data-reduced={reducedMotion}>
      <div ref={stageRef} className="jack-hero__stage" data-state={state} data-phase="intro">
        <div
          ref={mountRef}
          className="jack-hero__canvas"
          role="img"
          aria-label={`Jack, um personagem com cabeça de abóbora entalhada e brilhante, segura uma lata de Fanta ${flavor?.name ?? 'Laranja'} diante das latas da coleção`}
        />

        <div className="jack-hero__copy">
          <p className="jack-hero__kicker">Seis sabores · seis personagens</p>
          <h1 id="hero-title" className="jack-hero__title" tabIndex={-1} data-section-focus>
            <span className="jack-hero__word">Escolha</span>
            <span className="jack-hero__word">o seu susto</span>
          </h1>
          <div className="jack-hero__ctas">
            <a
              className="button jack-hero__cta"
              href="#sabores"
              onClick={(event) => {
                event.preventDefault();
                goToSection('sabores', reducedMotion);
              }}
            >
              Explore os sabores
            </a>
            <a
              className="button jack-hero__cta is-secondary"
              href="#sobre"
              onClick={(event) => {
                event.preventDefault();
                showCollection();
              }}
            >
              Ver a coleção
            </a>
          </div>
        </div>

        {!reducedMotion && flavor && (
          <div
            ref={pickerRef}
            className="jack-hero__picker"
            role="group"
            aria-label="Escolha a lata do Jack"
            inert
            style={{ '--pick-accent': flavor.accent } as CSSProperties}
          >
            <button type="button" className="jack-hero__arrow" aria-label="Sabor anterior" onClick={() => go(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="jack-hero__flavor">
              <span className="jack-hero__count" aria-hidden="true">
                {flavor.number}
                <span> / {String(PICK_IDS.length).padStart(2, '0')}</span>
              </span>
              <span key={picked.index} className="jack-hero__name" data-dir={picked.dir} aria-live="polite">
                Fanta {flavor.name}
              </span>
              <span className="jack-hero__actions">
                <button
                  type="button"
                  className="jack-hero__more is-hold"
                  aria-label={`Segure para o Jack beber a Fanta ${flavor.name}`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDrinking(true);
                  }}
                  onPointerUp={() => setDrinking(false)}
                  onPointerCancel={() => setDrinking(false)}
                  onLostPointerCapture={() => setDrinking(false)}
                  onKeyDown={(event) => {
                    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                      event.preventDefault();
                      setDrinking(true);
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === ' ' || event.key === 'Enter') setDrinking(false);
                  }}
                  onBlur={() => setDrinking(false)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  Segure para um gole
                </button>
                <span className="jack-hero__dot" aria-hidden="true" />
                <button
                  type="button"
                  className="jack-hero__more"
                  onClick={() => {
                    if (!goToFlavor(flavor.id, { moveFocus: true })) goToSection('sabores', reducedMotion);
                  }}
                >
                  Conhecer o sabor
                </button>
              </span>
            </div>
            <button type="button" className="jack-hero__arrow" aria-label="Próximo sabor" onClick={() => go(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {!reducedMotion && (
          <p className="jack-hero__hint" aria-hidden="true">
            <span className="jack-hero__hint-line" />
            Role para explorar
          </p>
        )}
      </div>
    </section>
  );
}
