import { Fragment, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  CTA_CARDS,
  CTA_FINAL_POSTER,
  CTA_FLAVOR,
  CTA_FOCUS_X,
  CTA_MEDIA,
  CTA_TITLE_LINES,
} from '../data/cta';
import {
  CARD_LEFT,
  CARD_RIGHT,
  CTA_BEATS,
  PORTRAIT_TITLE_DELAY,
  beatForProgress,
  buttonRise,
  cardState,
  easeOutCubic,
  letterProgress,
  scrimOpacity,
  videoFrameForBeat,
  videoShrink,
} from '../interaction/ctaTimeline';
import { useElementSize, useInView, useScrollProgress, useWideLayout } from '../interaction/hooks';
import { goToFlavor } from '../interaction/navigation';
import { clamp } from '../media/frames';
import type { Framing } from '../media/framing';
import type { ScrubVideoController } from '../media/ScrubVideoController';
import { FramedVideo } from './FramedVideo';

/**
 * CTA final em "scroll transform" (referência: reference-cta.mp4). O palco fica preso e um único
 * número — a batida da referência, suavizada — move o vídeo (vai e volta), os blocos que passam,
 * a montagem do título letra a letra, o degradê da base e a subida do botão.
 */

/** Constante de tempo da suavização (ms): inércia leve, sem prender a página. */
const SMOOTHING_MS = 90;
/** Saltos maiores que isto (batidas) não são suavizados: chegada por âncora ou corte. */
const SNAP_BEATS = 40;

interface Props {
  reducedMotion: boolean;
}

/** Em tela em pé, fração da altura do palco que o vídeo ocupa depois de recuar para o topo. */
const PORTRAIT_SETTLED_HEIGHT = 0.74;

/**
 * Vídeo cobrindo o palco. Em tela em pé, `settled` dá o enquadramento final (vídeo no topo,
 * fundido no preto onde ficam título e botão); com movimento, o vídeo chega lá por escala.
 */
function coverFraming(W: number, H: number, wide: boolean, settled: boolean): Framing {
  const aspect = CTA_MEDIA.aspect;
  const coverHeight = !wide && settled ? H * PORTRAIT_SETTLED_HEIGHT : H;
  const height = Math.max(coverHeight, W / aspect);
  const width = height * aspect;
  const left = clamp(W * 0.5 - CTA_FOCUS_X * width, W - width, 0);
  const top = wide ? clamp(H * 0.5 - 0.5 * height, H - height, 0) : 0;
  return {
    left,
    top,
    width,
    height,
    safeRect: { left, top, right: left + width, bottom: top + height, width, height },
    fades: { top: 0, left: 0, right: 0, bottom: wide ? 0 : height * 0.24 },
    containerWidth: W,
    containerHeight: H,
  };
}

export function FinalCta({ reducedMotion }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLAnchorElement>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const controllerRef = useRef<ScrubVideoController | null>(null);
  const wide = useWideLayout();
  const size = useElementSize(stageRef);
  // Fonte e capa carregam com folga; o agendador do vídeo só liga perto da tela.
  const near = useInView(sectionRef, '120% 0px 120% 0px');
  const active = useInView(sectionRef, '25% 0px 25% 0px');

  const framing = useMemo(
    () => (size.width && size.height ? coverFraming(size.width, size.height, wide, reducedMotion) : null),
    [size, wide, reducedMotion],
  );
  // Recuo em tela em pé: escala ancorada no topo, no centro do palco.
  const videoStyle = useMemo<CSSProperties | undefined>(
    () =>
      framing && !wide
        ? ({
            transformOrigin: `${(size.width / 2 - framing.left).toFixed(1)}px 0px`,
            '--shrink-to': PORTRAIT_SETTLED_HEIGHT,
          } as CSSProperties)
        : undefined,
    [framing, wide, size.width],
  );

  // ───────────── uma batida move tudo ─────────────
  const motion = useRef({ target: 0, current: 0, primed: false, raf: 0, last: 0, applied: -1 });
  const stageHeight = useRef(0);
  const titleDelay = useRef(0);
  const lastChars = useRef<number[]>([]);

  const apply = useCallback((beat: number, force = false) => {
    const state = motion.current;
    if (!force && Math.abs(beat - state.applied) < 0.002) return;
    state.applied = beat;

    controllerRef.current?.setScrollFrame(videoFrameForBeat(beat));

    const H = stageHeight.current;
    [CARD_LEFT, CARD_RIGHT].forEach((card, index) => {
      const element = cardRefs.current[index];
      if (!element) return;
      const { top, opacity } = cardState(card, beat);
      element.style.transform = `translate3d(0, ${(top * H).toFixed(1)}px, 0)`;
      element.style.opacity = opacity.toFixed(3);
      element.style.visibility = opacity <= 0.001 || top < -0.5 ? 'hidden' : 'visible';
    });

    const chars = charRefs.current;
    for (let i = 0; i < chars.length; i += 1) {
      const value = Math.round(easeOutCubic(letterProgress(i, chars.length, beat, titleDelay.current)) * 1000) / 1000;
      if (!force && lastChars.current[i] === value) continue;
      lastChars.current[i] = value;
      chars[i]?.style.setProperty('--e', String(value));
    }

    scrimRef.current?.style.setProperty('opacity', scrimOpacity(beat).toFixed(3));
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty('--rise', buttonRise(beat).toFixed(4));
      stage.style.setProperty('--shrink', videoShrink(beat).toFixed(4));
      const settled = beat >= CTA_BEATS - 12 ? 'true' : 'false';
      if (stage.dataset.settled !== settled) stage.dataset.settled = settled;
    }
  }, []);

  // Laço de suavização: só roda enquanto a batida exibida persegue o alvo.
  const kick = useCallback(() => {
    const state = motion.current;
    if (state.raf) return;
    const step = (now: number) => {
      state.raf = 0;
      const dt = state.last ? Math.min(64, now - state.last) : 16;
      state.last = now;
      const diff = state.target - state.current;
      if (Math.abs(diff) < 0.01) state.current = state.target;
      else state.current += diff * (1 - Math.exp(-dt / SMOOTHING_MS));
      apply(state.current);
      if (state.current !== state.target) state.raf = requestAnimationFrame(step);
      else state.last = 0;
    };
    state.raf = requestAnimationFrame(step);
  }, [apply]);

  useScrollProgress(
    sectionRef,
    stageRef,
    ({ progress, scrollY, sectionTop, viewportHeight }) => {
      // Entrada: o topo do vídeo nasce do preto da seção anterior até o palco prender.
      const enter = clamp((scrollY + viewportHeight - sectionTop) / viewportHeight, 0, 1);
      stageRef.current?.style.setProperty('--entry-fade', clamp((1 - enter) * 2.5, 0, 1).toFixed(3));
      const state = motion.current;
      state.target = beatForProgress(progress);
      if (!state.primed || Math.abs(state.target - state.current) > SNAP_BEATS) {
        state.primed = true;
        state.current = state.target;
        apply(state.current, true);
        return;
      }
      kick();
    },
    !reducedMotion,
  );

  useEffect(() => {
    const state = motion.current;
    return () => {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }, []);

  // O vídeo ocupa a tela inteira: enquanto a seção está sob a faixa do header, o header sobe e some
  // (volta quando a vitrine seguinte chega ao topo). Vale também com movimento reduzido.
  useScrollProgress(sectionRef, null, ({ scrollY, sectionTop }) => {
    const section = sectionRef.current;
    if (!section) return;
    const band = scrollY + 40;
    const hidden = band >= sectionTop && band < sectionTop + section.offsetHeight;
    const root = document.documentElement;
    if (hidden) root.dataset.header = 'hidden';
    else if (root.dataset.header === 'hidden') delete root.dataset.header;
  });

  useEffect(
    () => () => {
      delete document.documentElement.dataset.header;
    },
    [],
  );

  // Altura do palco para converter a posição dos blocos; reaplica a batida atual no resize.
  useEffect(() => {
    stageHeight.current = size.height;
    titleDelay.current = wide ? 0 : PORTRAIT_TITLE_DELAY;
    if (!reducedMotion && motion.current.primed) apply(motion.current.current, true);
  }, [size.height, wide, reducedMotion, apply]);

  const onController = useCallback((controller: ScrubVideoController | null) => {
    controllerRef.current = controller;
    if (controller) controller.jumpToScrollFrame(videoFrameForBeat(motion.current.current));
  }, []);

  // Índice global de cada letra (a montagem corre linha após linha).
  let charIndex = 0;
  const titleLabel = CTA_TITLE_LINES.join(' ');

  return (
    <section
      id="cta"
      ref={sectionRef}
      className="cta"
      data-reduced={reducedMotion}
      aria-labelledby="cta-title"
    >
      <div className={`cta__stage${wide ? ' is-wide' : ''}`} ref={stageRef} data-settled={reducedMotion ? 'true' : 'false'}>
        {reducedMotion ? (
          framing && (
            <div
              className="cta__still framed-video"
              style={{ left: framing.left, top: framing.top, width: framing.width, height: framing.height }}
            >
              <img
                className="framed-video__poster"
                src={near ? CTA_FINAL_POSTER : undefined}
                alt=""
                width={CTA_MEDIA.width}
                height={CTA_MEDIA.height}
                decoding="async"
              />
              <span className="framed-video__fade is-bottom" style={{ height: framing.fades.bottom }} />
            </div>
          )
        ) : (
          <FramedVideo
            media={CTA_MEDIA}
            label="cta"
            framing={framing}
            poster={near ? CTA_MEDIA.poster : null}
            src={near ? CTA_MEDIA.video : null}
            preload="auto"
            active={active}
            className="cta__video"
            style={videoStyle}
            onController={onController}
          />
        )}

        <div className="cta__entry" aria-hidden="true" />
        <div className="cta__scrim" ref={scrimRef} aria-hidden="true" />

        {!reducedMotion && (
          <div className="cta__cards" aria-hidden="true">
            {CTA_CARDS.map((card, index) => (
              <div
                key={card.id}
                className={`cta__card ${index === 0 ? 'is-left' : 'is-right'}`}
                ref={(element) => {
                  cardRefs.current[index] = element;
                }}
              >
                <div className="cta__card-copy">
                  <p className="cta__card-kicker">{card.kicker}</p>
                  <p className="cta__card-text">{card.text}</p>
                </div>
                <img
                  className="cta__card-thumb"
                  src={near ? card.thumb : undefined}
                  alt={card.thumbAlt}
                  width={200}
                  height={320}
                  decoding="async"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}

        <div className="cta__content">
          <h2 id="cta-title" className="cta__title" tabIndex={-1} data-section-focus>
            <span className="visually-hidden">{titleLabel}</span>
            {CTA_TITLE_LINES.map((line) => (
              <span key={line} className="cta__line" aria-hidden="true">
                {line.split(' ').map((word, wordIndex) => (
                  <Fragment key={`${word}-${wordIndex}`}>
                    {wordIndex > 0 && ' '}
                    <span className="cta__word">
                    {[...word].map((char) => {
                      const index = charIndex;
                      charIndex += 1;
                      return (
                        <span
                          key={index}
                          className="cta__char"
                          ref={(element) => {
                            charRefs.current[index] = element;
                          }}
                        >
                          {char}
                        </span>
                      );
                    })}
                  </span>
                  </Fragment>
                ))}
              </span>
            ))}
          </h2>
          <a
            ref={actionRef}
            className="cta__action"
            href={`#sabor-${CTA_FLAVOR.id}`}
            style={{ '--item-accent': CTA_FLAVOR.accent } as CSSProperties}
            onClick={(event) => {
              if (goToFlavor(CTA_FLAVOR.id, { moveFocus: true })) event.preventDefault();
            }}
          >
            <span className="cta__action-kicker">
              Nº {CTA_FLAVOR.number} · {CTA_FLAVOR.name}
            </span>
            <span className="cta__action-label">
              Conheça a Fanta {CTA_FLAVOR.name}
              <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
                <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" />
              </svg>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
