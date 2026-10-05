import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FLAVORS, flavorById, type Flavor } from '../data/products';
import { clamp, smoothstep, wrapFrame } from '../media/frames';
import { computeFraming, type Framing, type Insets } from '../media/framing';
import { preloadPoster } from '../media/posterCache';
import { registerProbe } from '../media/debug';
import type { ControlMode, LoadState, PreloadHint, ScrubVideoController } from '../media/ScrubVideoController';
import { attachDragRotate } from '../interaction/dragRotate';
import { clampChapter, facingFor, frameAt, poseAt } from '../interaction/flavorTimeline';
import {
  useElementSize,
  useInView,
  usePointerParallax,
  useScrollProgress,
  useWideLayout,
} from '../interaction/hooks';
import { cutTo, glideTo, registerFlavorNavigator, type FlavorNavigateOptions } from '../interaction/navigation';
import { scrollEngine, scrollYForProgress } from '../interaction/scrollEngine';
import { FlavorWorld, type FlavorWorldHandle } from './FlavorWorld';
import { FramedVideo } from './FramedVideo';

/**
 * Palco de sabores: seis capítulos de rolagem num palco preso.
 *
 * Um único número — o capítulo contínuo, suavizado — move tudo: o quadro de cada lata, o
 * cruzamento entre latas na troca (sempre de costas, onde as seis renderizações coincidem), o
 * mundo do sabor ao fundo, a barra do capítulo e o leve avanço de câmera na troca. O texto troca
 * no instante da troca, com animação por letra no sentido da rolagem.
 */

const COUNT = FLAVORS.length;
const MAX_LOADED_VIDEOS = 3;
const SETTLE_MS = 160;
/** Constante de tempo da suavização do capítulo (ms): inércia sem prender a página. */
const SMOOTHING_MS = 110;
/** Saltos maiores que isto (capítulos) não são suavizados: corte ou seleção distante. */
const SNAP_CHAPTERS = 1.25;
/** Deslizamento até o sabor vizinho (ms por capítulo). */
const GLIDE_MS = 1150;
const NAME_EXIT_MS = 720;
/**
 * O texto troca um pouco antes do meio do cruzamento, no sentido da rolagem (a cor nova dos
 * respingos aparece cedo). Parado dentro dessa faixa, mantém o que já está: sem pisca-pisca.
 */
const TEXT_LEAD = 0.025;

function textIndexFor(cf: number, velocity: number, current: number): number {
  const ahead = clamp(Math.floor(cf + TEXT_LEAD), 0, COUNT - 1);
  const behind = clamp(Math.floor(cf - TEXT_LEAD), 0, COUNT - 1);
  if (velocity > 0) return ahead;
  if (velocity < 0) return behind;
  return current === ahead || current === behind ? current : clamp(Math.floor(cf), 0, COUNT - 1);
}

const MODE_LABEL: Record<ControlMode, string> = {
  scroll: 'Rolagem',
  manual: 'Manual',
  returning: 'Voltando à rolagem',
  play: 'Reprodução contínua',
};

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

/**
 * Fila LRU dos sabores com vídeo atribuído. `priority` entra na frente, em ordem; o restante
 * mantém a ordem de uso. O sabor `keep` (exibido) nunca é descartado.
 */
function withLoaded(list: number[], priority: number[], keep: number): number[] {
  const next = [...priority, ...list.filter((value) => !priority.includes(value))];
  const result = next.slice(0, MAX_LOADED_VIDEOS);
  if (!result.includes(keep)) result[result.length - 1] = keep;
  const same = result.length === list.length && result.every((value, index) => value === list[index]);
  return same ? list : result;
}

/** Nome em linhas e letras, cada letra com seu índice para o escalonamento da animação. */
function NameLines({ flavor }: { flavor: Flavor }) {
  let charIndex = 0;
  return (
    <>
      {flavor.nameLines.map((line, lineIndex) => (
        <span key={line} className="showcase__name-line" style={{ '--line': lineIndex } as CSSProperties}>
          {[...line].map((char, index) => (
            <span key={index} className="showcase__name-char" style={{ '--ci': charIndex++ } as CSSProperties}>
              {char}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

const nameStyle = (flavor: Flavor) =>
  ({
    '--len': Math.max(...flavor.nameLines.map((line) => line.length)),
    '--chars': flavor.name.length,
  }) as CSSProperties;

export function FlavorShowcase({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const worldRef = useRef<FlavorWorldHandle>(null);

  const wide = useWideLayout();
  const stageSize = useElementSize(stageRef);
  const topSize = useElementSize(topRef);
  const bottomSize = useElementSize(bottomRef);
  const near = useInView(sectionRef, '120% 0px 120% 0px');
  const onStage = useInView(sectionRef, '15% 0px 15% 0px');
  usePointerParallax(stageRef, finePointer && !reducedMotion);

  const [displayed, setDisplayed] = useState(0);
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [exiting, setExiting] = useState<{ flavor: Flavor; key: number } | null>(null);
  const [settled, setSettled] = useState(0);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [mode, setMode] = useState<ControlMode>(reducedMotion ? 'manual' : 'scroll');
  const [loadState, setLoadState] = useState<LoadState>('empty');
  const [interacted, setInteracted] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [notice, setNotice] = useState('');
  const [postersWanted, setPostersWanted] = useState(false);

  const displayedRef = useRef(0);
  const controllers = useRef<(ScrubVideoController | null)[]>(Array(COUNT).fill(null));
  const layerElements = useRef<(HTMLDivElement | null)[]>(Array(COUNT).fill(null));
  const sliderHeld = useRef(false);
  const pendingPlay = useRef(false);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  // Capítulo contínuo: alvo (rolagem) e valor suavizado que move a cena.
  const chapter = useRef({ target: 0, current: 0, velocity: 0, ready: false, raf: 0, last: 0 });

  const flavor = FLAVORS[displayed];

  // ───────────── enquadramento ─────────────
  const framing: Framing | null = useMemo(() => {
    if (!stageSize.width || !stageSize.height) return null;
    const { width: W, height: H } = stageSize;
    let insets: Insets;
    if (wide) {
      const side = Math.max(W * 0.29, 240);
      insets = { top: 76, bottom: 64, left: side, right: side };
    } else {
      // O bloco do nome começa em header + 8px (CSS); a lata começa abaixo dele.
      const header = W < 720 ? 56 : 68;
      insets = {
        top: header + 8 + Math.max(topSize.height, 96) + 10,
        bottom: Math.max(bottomSize.height, 110) + 8,
        left: 16,
        right: 16,
      };
    }
    return computeFraming({
      containerWidth: W,
      containerHeight: H,
      aspect: flavor.aspect,
      safe: flavor.safe,
      insets,
      anchorY: wide ? 0.5 : 0.52,
    });
  }, [stageSize, topSize.height, bottomSize.height, wide, flavor.aspect, flavor.safe]);

  // ───────────── troca do sabor em primeiro plano ─────────────
  const commitDisplayed = useCallback((index: number) => {
    const old = displayedRef.current;
    if (old === index) return;
    displayedRef.current = index;
    const oldController = controllers.current[old];
    if (oldController?.getMode() === 'play') oldController.pause();
    setDirection(index > old ? 'down' : 'up');
    setExiting({ flavor: FLAVORS[old], key: performance.now() });
    setDisplayed(index);
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(null), NAME_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  /** Escreve a cena para um capítulo contínuo: camadas, quadros, mundo e variáveis do palco. */
  const applyPose = useCallback(
    (cf: number, velocity: number) => {
      const pose = poseAt(cf, COUNT);
      const stage = stageRef.current;
      for (let index = 0; index < COUNT; index++) {
        const element = layerElements.current[index];
        if (!element) continue;
        let opacity = 0;
        let z = 0;
        if (pose.swap) {
          if (index === pose.swap.under) {
            opacity = 1;
            z = 1;
          } else if (index === pose.swap.over) {
            opacity = pose.swap.mix;
            z = 2;
          }
        } else if (index === pose.index) {
          opacity = 1;
          z = 2;
        }
        const visible = opacity > 0.001;
        element.style.opacity = visible ? opacity.toFixed(3) : '0';
        element.style.visibility = visible ? 'visible' : 'hidden';
        element.style.zIndex = String(z);
        if (!visible) continue;
        const frame = frameAt(index, cf, COUNT);
        element.dataset.facing = facingFor(frame);
        const controller = controllers.current[index];
        if (!controller) continue;
        // A troca acontece pelo scroll: reprodução contínua do sabor que sai é encerrada.
        if (pose.swap && controller.getMode() === 'play') controller.pause();
        controller.setScrollFrame(frame);
      }
      if (stage) {
        stage.style.setProperty('--q', pose.local.toFixed(4));
        stage.style.setProperty('--sp', clamp(cf / COUNT, 0, 1).toFixed(4));
        stage.style.setProperty('--push', (1 - smoothstep(0, 0.22, Math.abs(pose.toSwap))).toFixed(4));
      }
      worldRef.current?.setPose(cf, velocity);
      const textIndex = textIndexFor(cf, velocity, displayedRef.current);
      if (textIndex !== displayedRef.current) commitDisplayed(textIndex);
    },
    [commitDisplayed],
  );

  // Laço de suavização: segue o alvo da rolagem e para sozinho quando alcança.
  const tickRef = useRef<FrameRequestCallback>(() => {});
  useEffect(() => {
    tickRef.current = (now) => {
      const state = chapter.current;
      state.raf = 0;
      const dt = state.last ? Math.min(64, now - state.last) : 16;
      state.last = now;
      const previous = state.current;
      let next = previous + (state.target - previous) * (1 - Math.exp(-dt / SMOOTHING_MS));
      if (Math.abs(state.target - next) < 0.0004) next = state.target;
      state.velocity = (next - previous) / (dt / 1000);
      state.current = next;
      if (next !== state.target) {
        applyPose(next, state.velocity);
        state.raf = requestAnimationFrame((time) => tickRef.current(time));
      } else {
        state.velocity = 0;
        state.last = 0;
        applyPose(next, 0);
      }
    };
  }, [applyPose]);

  useEffect(() => {
    const state = chapter.current;
    return () => {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, []);

  // Sabor "assentado": ele e os dois vizinhos ganham vídeo. Passagens rápidas mostram só capas.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(displayed), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [displayed]);

  // Capas: baixam quando a seção se aproxima e continuam disponíveis depois disso.
  if (near && !postersWanted) setPostersWanted(true);

  // Fila de vídeos derivada durante o render (sem efeito em cascata).
  const loadInputs = `${settled}:${near ? 1 : 0}:${reducedMotion ? 1 : 0}:${interacted ? 1 : 0}`;
  const [appliedLoadInputs, setAppliedLoadInputs] = useState('');
  if (loadInputs !== appliedLoadInputs) {
    setAppliedLoadInputs(loadInputs);
    if (reducedMotion) {
      // Movimento reduzido: só capas até a pessoa pedir giro (slider, arrasto ou reprodução).
      if (interacted) setLoaded((list) => withLoaded(list, [settled], settled));
    } else if (near) {
      const neighbours = [settled + 1, settled - 1].filter((value) => value >= 0 && value < COUNT);
      setLoaded((list) => withLoaded(list, [settled, ...neighbours], settled));
    }
  }

  /** Intenção (hover/foco no seletor): adianta capa e vídeo do sabor. */
  const preloadIntent = useCallback(
    (index: number) => {
      if (reducedMotion) return;
      void preloadPoster(FLAVORS[index].poster);
      const current = displayedRef.current;
      setLoaded((list) => (list.includes(index) ? list : withLoaded(list, [current, index], current)));
    },
    [reducedMotion],
  );

  // ───────────── rolagem → capítulo contínuo ─────────────
  useScrollProgress(
    sectionRef,
    stageRef,
    ({ scrollY, sectionTop, range }) => {
      const raw = range > 0 ? ((scrollY - sectionTop) / range) * COUNT : 0;
      const state = chapter.current;
      state.target = clampChapter(raw, COUNT);
      if (!state.ready || Math.abs(state.target - state.current) > SNAP_CHAPTERS) {
        state.ready = true;
        state.current = state.target;
        state.velocity = 0;
        applyPose(state.current, 0);
        return;
      }
      if (!state.raf && state.target !== state.current) {
        state.raf = requestAnimationFrame((time) => tickRef.current(time));
      }
    },
    !reducedMotion,
  );

  // ───────────── seleção direta ─────────────
  const selectFlavor = useCallback(
    (index: number, options?: FlavorNavigateOptions) => {
      const target = clamp(index, 0, COUNT - 1);
      const focusStage = () => {
        if (options?.moveFocus) nameRef.current?.focus({ preventScroll: true });
      };
      const section = sectionRef.current;
      if (reducedMotion) {
        commitDisplayed(target);
        if (section && options?.moveFocus) {
          cutTo(section.getBoundingClientRect().top + window.scrollY, true, focusStage);
        }
        return;
      }
      if (!section) return;
      void preloadPoster(FLAVORS[target].poster);
      const y = scrollYForProgress(section, stageRef.current, (target + 0.5) / COUNT);
      const distance = Math.abs(target + 0.5 - chapter.current.current);
      const pinned = Math.abs(section.getBoundingClientRect().top) < 2 || chapter.current.current > 0;
      const after = () => {
        scrollEngine.measureNow();
        focusStage();
      };
      // Vizinho: desliza pela troca (a lata gira, o mundo muda). Longe: corte rápido para preto.
      if (pinned && distance <= 1.6 && chapter.current.current < COUNT) {
        glideTo(y, GLIDE_MS * clamp(distance, 0.5, 1.4), after);
      } else {
        cutTo(y, false, after);
      }
    },
    [reducedMotion, commitDisplayed],
  );

  useEffect(
    () =>
      registerFlavorNavigator((id, options) => {
        const target = flavorById(id);
        if (target) selectFlavor(FLAVORS.indexOf(target), options);
      }),
    [selectFlavor],
  );

  // ───────────── controladores e leitura do quadro ─────────────
  const layerCallbacks = useMemo(
    () =>
      FLAVORS.map((_, index) => ({
        onController: (controller: ScrubVideoController | null) => {
          controllers.current[index] = controller;
          if (controller && !reducedRef.current) {
            controller.jumpToScrollFrame(frameAt(index, chapter.current.current, COUNT));
          }
        },
        elementRef: (element: HTMLDivElement | null) => {
          layerElements.current[index] = element;
          if (element && chapter.current.ready) applyPose(chapter.current.current, 0);
        },
        onFrame: (frame: number, frameMode: ControlMode) => {
          if (index !== displayedRef.current) return;
          const total = FLAVORS[index].frameCount;
          if (readoutRef.current) readoutRef.current.textContent = String(frame).padStart(3, '0');
          const slider = sliderRef.current;
          // Em modo manual o slider guarda a intenção da pessoa (teclado/arrasto), não o quadro
          // apresentado, que pode estar atrasado enquanto o vídeo carrega.
          if (slider && frameMode !== 'manual' && !sliderHeld.current) {
            slider.value = String(frame);
            slider.setAttribute('aria-valuetext', `Quadro ${frame + 1} de ${total}`);
          }
          stageRef.current?.style.setProperty('--turn', (frame / (total - 1)).toFixed(4));
        },
        onModeChange: (value: ControlMode) => {
          if (index === displayedRef.current) setMode(value);
        },
        onLoadState: (state: LoadState) => {
          if (index !== displayedRef.current) return;
          setLoadState(state);
          if (state === 'error') setNotice('O vídeo deste sabor não carregou. A capa continua disponível.');
          if (state === 'ready' && pendingPlay.current) {
            pendingPlay.current = false;
            void controllers.current[index]?.play();
          }
        },
        onPlayBlocked: () => {
          setNotice('O navegador bloqueou a reprodução. Use o arrasto ou o controle de giro.');
        },
      })),
    [applyPose],
  );

  useEffect(() => {
    const controller = controllers.current[displayed];
    setMode(controller?.getMode() ?? (reducedMotion ? 'manual' : 'scroll'));
    setLoadState(controller?.getLoadState() ?? 'empty');
    setNotice('');
    const frame = Math.round(controller?.getCurrentFrame() ?? 0);
    if (readoutRef.current) readoutRef.current.textContent = String(frame).padStart(3, '0');
    if (sliderRef.current) sliderRef.current.value = String(frame);
  }, [displayed, reducedMotion]);

  // Vizinhos já posicionados no ângulo em que vão aparecer (evita um quadro velho no cruzamento).
  useEffect(() => {
    if (reducedMotion) return;
    for (const index of [displayed - 1, displayed + 1]) {
      const element = layerElements.current[index];
      if (!element || element.style.visibility === 'visible') continue;
      controllers.current[index]?.jumpToScrollFrame(frameAt(index, chapter.current.current, COUNT));
    }
  }, [displayed, loaded, reducedMotion]);

  // Movimento reduzido: sem rolagem presa; só o sabor escolhido aparece, de frente.
  useEffect(() => {
    if (!reducedMotion) return;
    layerElements.current.forEach((element, index) => {
      if (!element) return;
      const current = index === displayed;
      element.style.opacity = current ? '1' : '0';
      element.style.visibility = current ? 'visible' : 'hidden';
      element.style.zIndex = current ? '2' : '0';
      element.dataset.facing = 'front';
    });
    controllers.current.forEach((controller) => {
      if (controller && controller.getMode() === 'scroll') controller.setManualFrame(0);
    });
  }, [reducedMotion, displayed, loaded]);

  // Diagnóstico (?debug): capítulo suavizado e quadro esperado para cada sabor.
  useEffect(
    () =>
      registerProbe('showcase', () => ({
        cf: chapter.current.current,
        target: chapter.current.target,
        settled: chapter.current.target === chapter.current.current,
        displayed: displayedRef.current,
        expectedFrame: (index: number, cf: number) => Math.round(frameAt(index, cf, COUNT)) % 180,
      })),
    [],
  );

  const markInteracted = useCallback(() => {
    setInteracted(true);
    setHintDismissed(true);
  }, []);

  /** Reflete o quadro manual no slider (valor e texto acessível). */
  const syncSlider = useCallback((frame: number) => {
    const total = FLAVORS[displayedRef.current].frameCount;
    const value = Math.round(wrapFrame(frame, total)) % total;
    const slider = sliderRef.current;
    if (!slider) return;
    slider.value = String(value);
    slider.setAttribute('aria-valuetext', `Quadro ${value + 1} de ${total}`);
  }, []);

  const onSliderInput = (value: number) => {
    markInteracted();
    controllers.current[displayedRef.current]?.setManualFrame(value);
    syncSlider(value);
  };

  const togglePlay = async () => {
    markInteracted();
    const controller = controllers.current[displayedRef.current];
    if (!controller) return;
    if (controller.getMode() === 'play') {
      controller.pause();
      return;
    }
    setNotice('');
    if (controller.getLoadState() === 'empty') {
      pendingPlay.current = true; // começa quando a fonte carregar
      return;
    }
    const ok = await controller.play();
    if (!ok && controller.getLoadState() === 'error') setNotice('Vídeo indisponível; a capa continua visível.');
  };

  // Arrasto horizontal sobre a lata.
  const safeRect = framing?.safeRect;
  const dragWidth = safeRect?.width ?? 300;
  useEffect(() => {
    const element = dragRef.current;
    if (!element) return;
    return attachDragRotate(element, {
      getFrame: () => controllers.current[displayedRef.current]?.getCurrentFrame() ?? 0,
      setFrame: (frame) => {
        controllers.current[displayedRef.current]?.setManualFrame(frame);
        syncSlider(frame);
      },
      framesPerPixel: () => FLAVORS[displayedRef.current].frameCount / Math.max(360, dragWidth * 2.4),
      inertia: () => !reducedRef.current,
      stillInControl: () => controllers.current[displayedRef.current]?.getMode() === 'manual',
      onDragStart: markInteracted,
    });
  }, [dragWidth, markInteracted, syncSlider]);

  const stageStyle = {
    '--accent': flavor.accent,
    '--glow': flavor.glow,
    ...(safeRect
      ? {
          '--can-x': `${(safeRect.left + safeRect.width / 2).toFixed(1)}px`,
          '--can-y': `${(safeRect.top + safeRect.height / 2).toFixed(1)}px`,
        }
      : null),
  } as CSSProperties;

  const dragStyle: CSSProperties | undefined = safeRect
    ? {
        left: safeRect.left - safeRect.width * 0.12,
        top: safeRect.top,
        width: safeRect.width * 1.24,
        height: safeRect.height,
      }
    : undefined;

  const hintStyle: CSSProperties | undefined = safeRect
    ? { left: safeRect.left + safeRect.width / 2, top: Math.min(safeRect.bottom + 6, stageSize.height - 40) }
    : undefined;

  const playing = mode === 'play';
  const loadingVideo = loadState === 'loading' && interacted;

  return (
    <section
      id="sabores"
      ref={sectionRef}
      className="showcase"
      data-reduced={reducedMotion ? 'true' : 'false'}
      aria-labelledby="sabores-titulo"
      style={{ '--chapters': COUNT } as CSSProperties}
    >
      {FLAVORS.map((item, index) => (
        <span
          key={item.id}
          id={`sabor-${item.id}`}
          className="showcase__anchor"
          style={{ '--i': index } as CSSProperties}
          aria-hidden="true"
        />
      ))}

      <div
        ref={stageRef}
        className={`showcase__stage${wide ? ' is-wide' : ' is-stacked'}`}
        style={stageStyle}
        data-flavor={flavor.id}
        data-dir={direction}
      >
        <h2 id="sabores-titulo" className="visually-hidden">
          Explore os sabores
        </h2>

        <div className="showcase__media">
          {FLAVORS.map((item, index) => {
            const isCurrent = index === displayed;
            const isNeighbour = Math.abs(index - displayed) === 1;
            const isLoaded = loaded.includes(index);
            const preload: PreloadHint = isCurrent || isNeighbour ? 'auto' : 'metadata';
            return (
              <FramedVideo
                key={item.id}
                media={item}
                label={`sabor:${item.id}`}
                framing={framing}
                poster={postersWanted || isCurrent ? item.poster : null}
                posterBack={postersWanted && !reducedMotion ? item.posterBack : null}
                src={isLoaded ? item.video : null}
                preload={preload}
                active={onStage && (isCurrent || (isNeighbour && !reducedMotion))}
                wrapManual
                posterPriority={isCurrent ? 'high' : 'low'}
                className={`showcase__layer${isCurrent ? ' is-current' : ''}`}
                ariaLabel={isCurrent ? `Lata de Fanta ${item.name} girando` : undefined}
                {...layerCallbacks[index]}
              />
            );
          })}
        </div>

        <FlavorWorld
          ref={worldRef}
          framing={framing}
          wide={wide}
          displayed={displayed}
          reducedMotion={reducedMotion}
          active={onStage}
          stageRef={stageRef}
          introRef={topRef}
          listRef={listRef}
          controlsRef={controlsRef}
          layoutKey={`${flavor.id}:${topSize.height.toFixed(0)}:${bottomSize.height.toFixed(0)}`}
        />

        <div
          ref={dragRef}
          className="showcase__drag"
          style={dragStyle}
          aria-hidden="true"
          data-hint={hintDismissed ? 'off' : 'on'}
        />
        <p className="showcase__hint" style={hintStyle} data-visible={!hintDismissed} aria-hidden="true">
          <span className="showcase__hint-arrows">←</span>
          {finePointer ? 'Arraste para girar' : 'Deslize na lata para girar'}
          <span className="showcase__hint-arrows">→</span>
        </p>

        <div ref={topRef} className="showcase__intro">
          <p className="showcase__eyebrow">
            <span className="showcase__count">
              <span className="showcase__count-current" key={flavor.id}>
                {flavor.number}
              </span>
              <span className="showcase__count-total"> / {String(COUNT).padStart(2, '0')}</span>
            </span>
            <span className="showcase__eyebrow-label">Sabor</span>
          </p>
          <div className="showcase__name-wrap">
            <h3
              ref={nameRef}
              className="showcase__name"
              tabIndex={-1}
              data-section-focus
              aria-label={flavor.name}
              style={nameStyle(flavor)}
            >
              <span key={flavor.id} className="showcase__name-inner is-enter">
                <NameLines flavor={flavor} />
              </span>
            </h3>
            {exiting && exiting.flavor.id !== flavor.id && (
              <p
                key={exiting.key}
                className="showcase__name showcase__name--exit"
                aria-hidden="true"
                style={nameStyle(exiting.flavor)}
              >
                <span className="showcase__name-inner is-exit">
                  <NameLines flavor={exiting.flavor} />
                </span>
              </p>
            )}
          </div>
          <dl className="showcase__facts" key={`facts-${flavor.id}`}>
            <div>
              <dt>Personagem</dt>
              <dd>{flavor.character}</dd>
            </div>
            <div>
              <dt>Paleta</dt>
              <dd>{flavor.palette}</dd>
            </div>
          </dl>
          <div className="showcase__chapter-bar" aria-hidden="true">
            <span />
          </div>
        </div>

        <span className="showcase__numeral" aria-hidden="true" key={`numeral-${flavor.id}`}>
          {flavor.number}
        </span>

        <div ref={bottomRef} className="showcase__panel">
          <nav className="flavor-picker" aria-label="Escolha um sabor">
            <p className="flavor-picker__title">Sabores</p>
            <ol ref={listRef} className="flavor-picker__list">
              {FLAVORS.map((item, index) => (
                <li key={item.id}>
                  <a
                    href={`#sabor-${item.id}`}
                    className="flavor-picker__item"
                    aria-current={index === displayed ? 'true' : undefined}
                    style={{ '--item-accent': item.accent } as CSSProperties}
                    onClick={(event) => {
                      event.preventDefault();
                      selectFlavor(index);
                    }}
                    onPointerEnter={() => preloadIntent(index)}
                    onFocus={() => preloadIntent(index)}
                  >
                    <img className="flavor-picker__thumb" src={item.thumb} alt="" width={200} height={320} loading="lazy" />
                    <span className="flavor-picker__number">{item.number}</span>
                    <span className="flavor-picker__name">{item.name}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div ref={controlsRef} className="spin-controls" role="group" aria-label={`Girar a lata de ${flavor.name}`}>
            <div className="spin-controls__row">
              <button
                type="button"
                className="icon-button"
                onClick={() => selectFlavor((displayed - 1 + COUNT) % COUNT)}
                aria-label={`Sabor anterior: ${FLAVORS[(displayed - 1 + COUNT) % COUNT].name}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <label className="spin-controls__slider">
                <span className="spin-controls__label">
                  Girar a lata
                  <span className="spin-controls__readout" aria-hidden="true">
                    <span ref={readoutRef}>000</span>/{String(flavor.frameCount - 1).padStart(3, '0')}
                  </span>
                </span>
                <input
                  ref={sliderRef}
                  type="range"
                  min={0}
                  max={flavor.frameCount - 1}
                  step={1}
                  defaultValue={0}
                  aria-valuetext="Quadro 1 de 180"
                  onChange={(event) => onSliderInput(Number(event.currentTarget.value))}
                  onPointerDown={() => {
                    sliderHeld.current = true;
                  }}
                  onPointerUp={() => {
                    sliderHeld.current = false;
                  }}
                  onPointerCancel={() => {
                    sliderHeld.current = false;
                  }}
                />
              </label>
              <button
                type="button"
                className="icon-button is-play"
                onClick={togglePlay}
                aria-pressed={playing}
                aria-label={playing ? 'Pausar giro contínuo' : 'Girar sozinha (reprodução contínua)'}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5v14M16 5v14" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 5l12 7-12 7z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => selectFlavor((displayed + 1) % COUNT)}
                aria-label={`Próximo sabor: ${FLAVORS[(displayed + 1) % COUNT].name}`}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <p className="spin-controls__status">
              <span className="spin-controls__dot" data-mode={mode} aria-hidden="true" />
              Controle: <strong>{MODE_LABEL[mode]}</strong>
              {loadingVideo && <span className="spin-controls__loading"> · carregando giro…</span>}
              {loadState === 'error' && <span className="spin-controls__loading"> · capa (vídeo indisponível)</span>}
            </p>
          </div>
        </div>

        <p className="visually-hidden" aria-live="polite">
          {`Sabor ${flavor.number} de ${String(COUNT).padStart(2, '0')}: ${flavor.name}. ${notice}`}
        </p>
      </div>
    </section>
  );
}
