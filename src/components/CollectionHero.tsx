import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { COLLECTION, COLLECTION_ORDER, FLAVORS } from '../data/products';
import { holdRange } from '../media/frames';
import { computeFraming, type Framing, type Insets } from '../media/framing';
import type { ControlMode, ScrubVideoController } from '../media/ScrubVideoController';
import {
  useElementSize,
  useInView,
  usePointerParallax,
  useScrollProgress,
  useWideLayout,
} from '../interaction/hooks';
import { goToFlavor, goToSection } from '../interaction/navigation';
import { FramedVideo } from './FramedVideo';

/**
 * Abertura: o vídeo da coleção (240 quadros) é controlado pelo scroll, ida e volta.
 * Quadros ~45–180 trazem Ghost Face Punch à frente; as legendas acompanham essas fases.
 * Título e chamadas ocupam a faixa preta acima das latas e a faixa de reflexo abaixo delas.
 */

const SCRUB_FROM = 0.05;
const SCRUB_TO = 0.93;
const GHOST = FLAVORS[0];

function phaseFor(progress: number): 'intro' | 'destaque' | 'sabores' {
  if (progress < 0.25) return 'intro';
  if (progress < 0.66) return 'destaque';
  return 'sabores';
}

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

export function CollectionHero({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const controllerRef = useRef<ScrubVideoController | null>(null);
  const wide = useWideLayout();
  const size = useElementSize(stageRef);
  const near = useInView(sectionRef, '60% 0px 60% 0px');
  const [playMode, setPlayMode] = useState<ControlMode>('scroll');
  const [reducedVideoRequested, setReducedVideoRequested] = useState(false);
  usePointerParallax(stageRef, finePointer && !reducedMotion);

  const framing: Framing | null = useMemo(() => {
    if (!size.width || !size.height) return null;
    const { width: W, height: H } = size;
    const header = W < 720 ? 56 : 68;
    let insets: Insets;
    if (wide && H < 560) {
      // Celular deitado: chamada fica no cabeçalho; nomes viram números compactos.
      insets = { top: header + H * 0.2, bottom: 58, left: 16, right: 16 };
    } else if (wide) {
      insets = {
        top: header + Math.min(Math.max(H * 0.2, 120), 250),
        bottom: Math.max(H * 0.13, 88),
        left: Math.max(W * 0.02, 16),
        right: Math.max(W * 0.02, 16),
      };
    } else {
      insets = { top: header + Math.max(H * 0.3, 200), bottom: Math.max(H * 0.3, 200), left: 12, right: 12 };
    }
    return computeFraming({
      containerWidth: W,
      containerHeight: H,
      aspect: COLLECTION.aspect,
      safe: COLLECTION.safe,
      insets,
      anchorY: 0.5,
    });
  }, [size, wide]);

  useScrollProgress(
    sectionRef,
    stageRef,
    ({ progress }) => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.setProperty('--p', progress.toFixed(4));
      const phase = phaseFor(progress);
      if (stage.dataset.phase !== phase) stage.dataset.phase = phase;
      controllerRef.current?.setScrollProgress(holdRange(progress, SCRUB_FROM, SCRUB_TO));
    },
    !reducedMotion,
  );

  const geometry = useMemo(() => {
    if (!framing) return null;
    const safe = framing.safeRect;
    return {
      '--safe-top': `${safe.top}px`,
      '--safe-bottom': `${safe.bottom}px`,
      '--safe-left': `${safe.left}px`,
      '--safe-right': `${safe.right}px`,
      '--ghost-x': `${framing.left + GHOST.collectionX * framing.width}px`,
    } as CSSProperties;
  }, [framing]);

  const labelX = (x: number) => (framing ? framing.left + x * framing.width : 0);
  // Latas a menos de ~130 px umas das outras: mostra só o número (com nome acessível).
  const compactLabels = framing ? framing.width * 0.14 < 130 : false;

  const videoSrc = reducedMotion ? (reducedVideoRequested ? COLLECTION.video : null) : COLLECTION.video;

  const toggleReducedPlayback = async () => {
    const controller = controllerRef.current;
    if (!reducedVideoRequested) {
      setReducedVideoRequested(true);
      // Reproduz quando a fonte carregar (ver onLoadState).
      return;
    }
    if (!controller) return;
    if (controller.getMode() === 'play') controller.pause();
    else await controller.play();
  };

  return (
    <section id="colecao" ref={sectionRef} className="hero" aria-labelledby="hero-title" data-reduced={reducedMotion}>
      <div ref={stageRef} className={`hero__stage${wide ? ' is-wide' : ' is-stacked'}`} data-phase="intro" style={geometry ?? undefined}>
        <div className="hero__media">
          <FramedVideo
            media={COLLECTION}
            label="colecao"
            framing={framing}
            poster={reducedMotion ? COLLECTION.officialPoster : COLLECTION.firstFramePoster}
            errorPoster={COLLECTION.officialPoster}
            src={videoSrc}
            preload="auto"
            active={near}
            posterPriority="high"
            className="hero__video"
            ariaLabel="As seis latas da coleção Fanta Halloween 2026 lado a lado, com Ghost Face Punch em destaque"
            onController={(controller) => {
              controllerRef.current = controller;
              if (controller && reducedMotion) controller.setManualFrame(COLLECTION.officialPosterFrame);
            }}
            onFrame={(frame) => {
              if (readoutRef.current) readoutRef.current.textContent = String(frame).padStart(3, '0');
            }}
            onModeChange={setPlayMode}
            onLoadState={(state) => {
              if (state === 'ready' && reducedMotion && reducedVideoRequested) void controllerRef.current?.play();
            }}
          />
        </div>

        <div className="hero__captions">
          <div className="hero__caption is-intro">
            <p className="hero__kicker">
              <span>Coleção</span>
              <span aria-hidden="true">·</span>
              <span>06 sabores</span>
              <span aria-hidden="true">·</span>
              <span>Edição de Halloween</span>
            </p>
            <h1 id="hero-title" className="hero__title" tabIndex={-1} data-section-focus>
              <span className="visually-hidden">Fanta Halloween 2026</span>
              <span className="hero__title-brand" aria-hidden="true">Fanta</span>
              <span className="hero__title-main" aria-hidden="true">
                {'Halloween'.split('').map((letter, index) => (
                  <span key={index} className="hero__letter" style={{ '--i': index } as CSSProperties}>
                    {letter}
                  </span>
                ))}
              </span>
              <span className="hero__title-year" aria-hidden="true">2026</span>
            </h1>
          </div>

          <div className="hero__caption is-destaque">
            <p className="hero__kicker">
              <span className="hero__accent-dot" style={{ background: GHOST.accent }} />
              Destaque da coleção
            </p>
            <p className="hero__feature" style={{ color: GHOST.accent }}>
              Ghost Face Punch
            </p>
          </div>

          <div className="hero__caption is-sabores">
            <p className="hero__kicker">Seis sabores · seis personagens</p>
            <p className="hero__feature">Escolha seu susto</p>
          </div>
        </div>

        <span className="hero__pointer" aria-hidden="true" />

        {wide ? (
          <ul className={`hero__labels${compactLabels ? ' is-compact' : ''}`} aria-label="Sabores da coleção">
            {COLLECTION_ORDER.map((item) => (
              <li
                key={item.id}
                className={`hero__label${item.id === GHOST.id ? ' is-ghost' : ''}`}
                style={{ left: labelX(item.collectionX), '--item-accent': item.accent } as CSSProperties}
              >
                <a
                  href={`#sabor-${item.id}`}
                  aria-label={compactLabels ? item.name : undefined}
                  onClick={(event) => {
                    if (goToFlavor(item.id, { moveFocus: true })) event.preventDefault();
                  }}
                >
                  <span className="hero__label-number">{item.number}</span>
                  <span className="hero__label-name">{item.name}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="hero__chips" aria-label="Sabores da coleção">
            {COLLECTION_ORDER.map((item) => (
              <li key={item.id}>
                <a
                  href={`#sabor-${item.id}`}
                  className="hero__chip"
                  style={{ '--item-accent': item.accent } as CSSProperties}
                  onClick={(event) => {
                    if (goToFlavor(item.id, { moveFocus: true })) event.preventDefault();
                  }}
                >
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="hero__footer">
          <p className="hero__scroll-hint" aria-hidden="true">
            <span className="hero__scroll-line" />
            {reducedMotion ? 'Coleção completa' : 'Role para explorar'}
          </p>
          <div className="hero__actions">
            <a
              className="button is-primary"
              href="#sabores"
              onClick={(event) => {
                event.preventDefault();
                goToSection('sabores', reducedMotion);
              }}
            >
              Explore os sabores
            </a>
            {reducedMotion && (
              <button type="button" className="button is-ghost" onClick={toggleReducedPlayback} aria-pressed={playMode === 'play'}>
                {playMode === 'play' ? 'Pausar animação' : 'Reproduzir animação'}
              </button>
            )}
          </div>
          <p className="hero__readout" aria-hidden="true">
            Quadro <span ref={readoutRef}>000</span>/{String(COLLECTION.frameCount - 1).padStart(3, '0')}
          </p>
        </div>
      </div>
    </section>
  );
}
