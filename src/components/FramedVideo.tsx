import { useEffect, useRef, type CSSProperties } from 'react';
import type { MediaItem } from '../data/products';
import { registerController } from '../media/debug';
import type { Framing } from '../media/framing';
import {
  ScrubVideoController,
  type ControlMode,
  type LoadState,
  type PreloadHint,
} from '../media/ScrubVideoController';

/**
 * Vídeo 16:9 enquadrado + capa JPG por baixo. A capa fica visível até o controlador confirmar um
 * quadro utilizável da fonte atual; em erro, a capa permanece (e pode trocar para `errorPoster`).
 * Os degradês de borda só cobrem a faixa de estúdio vazia fora da área segura do produto.
 * Com `posterBack`, uma segunda capa (lata de costas) cobre os quadros do meio da volta; o palco
 * escolhe qual delas aparece pelo atributo `data-facing` do elemento.
 */

export interface FramedVideoProps {
  media: MediaItem;
  label: string;
  framing: Framing | null;
  /** Capa exibida até o vídeo ficar pronto. `null` adia o download da imagem. */
  poster: string | null;
  errorPoster?: string;
  /** Capa da lata de costas (quadro 90), usada enquanto o vídeo não cobre a troca. */
  posterBack?: string | null;
  /** Elemento do quadro, para o palco controlar opacidade/ângulo sem re-renderizar. */
  elementRef?: (element: HTMLDivElement | null) => void;
  /** Fonte do vídeo; `null` mantém o elemento sem download. */
  src: string | null;
  preload: PreloadHint;
  active: boolean;
  wrapManual?: boolean;
  posterPriority?: 'high' | 'low' | 'auto';
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  onController?: (controller: ScrubVideoController | null) => void;
  onFrame?: (frame: number, mode: ControlMode) => void;
  onModeChange?: (mode: ControlMode) => void;
  onLoadState?: (state: LoadState) => void;
  onPlayBlocked?: () => void;
}

export function FramedVideo(props: FramedVideoProps) {
  const {
    media,
    label,
    framing,
    poster,
    posterBack,
    elementRef,
    src,
    preload,
    active,
    wrapManual,
    posterPriority = 'auto',
    className,
    style,
    ariaLabel,
  } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);
  const controllerRef = useRef<ScrubVideoController | null>(null);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  });

  // Um controlador por elemento de vídeo, criado na montagem e destruído na desmontagem.
  useEffect(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;
    const controller = new ScrubVideoController(video, {
      label,
      fps: media.fps,
      frameCount: media.frameCount,
      lastFrameTimeSeconds: media.lastFrameTimeSeconds,
      wrapManual,
      onFrame: (value, mode) => callbacks.current.onFrame?.(value, mode),
      onModeChange: (mode) => {
        frame.dataset.mode = mode;
        callbacks.current.onModeChange?.(mode);
      },
      onLoadState: (state) => {
        frame.dataset.load = state;
        const fallback = callbacks.current.errorPoster;
        if (state === 'error' && fallback && posterRef.current) posterRef.current.src = fallback;
        callbacks.current.onLoadState?.(state);
      },
      onReveal: (revealed) => {
        frame.dataset.revealed = revealed ? 'true' : 'false';
      },
      onPlayBlocked: () => callbacks.current.onPlayBlocked?.(),
    });
    controllerRef.current = controller;
    frame.dataset.mode = controller.getMode();
    frame.dataset.load = controller.getLoadState();
    frame.dataset.revealed = 'false';
    const unregister = registerController(label, controller);
    controller.setSource(callbacks.current.src, callbacks.current.preload);
    controller.setActive(callbacks.current.active);
    callbacks.current.onController?.(controller);
    return () => {
      unregister();
      callbacks.current.onController?.(null);
      controller.destroy();
      controllerRef.current = null;
    };
  }, [label, media.fps, media.frameCount, media.lastFrameTimeSeconds, wrapManual]);

  useEffect(() => {
    controllerRef.current?.setSource(src, preload);
  }, [src, preload]);

  useEffect(() => {
    if (!elementRef) return;
    elementRef(frameRef.current);
    return () => elementRef(null);
  }, [elementRef]);

  useEffect(() => {
    controllerRef.current?.setActive(active);
  }, [active]);

  const frameStyle: CSSProperties = framing
    ? {
        ...style,
        left: `${framing.left}px`,
        top: `${framing.top}px`,
        width: `${framing.width}px`,
        height: `${framing.height}px`,
      }
    : { ...style, visibility: 'hidden' };

  return (
    <div
      ref={frameRef}
      className={`framed-video${className ? ` ${className}` : ''}`}
      style={frameStyle}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <img
        ref={posterRef}
        className="framed-video__poster"
        src={poster ?? undefined}
        alt=""
        width={media.width}
        height={media.height}
        decoding="async"
        fetchPriority={posterPriority}
        draggable={false}
      />
      {posterBack !== undefined && (
        <img
          className="framed-video__poster is-back"
          src={posterBack ?? undefined}
          alt=""
          width={media.width}
          height={media.height}
          decoding="async"
          fetchPriority="low"
          draggable={false}
        />
      )}
      <video
        ref={videoRef}
        className="framed-video__media"
        width={media.width}
        height={media.height}
        muted
        playsInline
        preload="none"
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden="true"
      />
      {framing && (
        <>
          <span className="framed-video__fade is-top" style={{ height: framing.fades.top }} />
          <span className="framed-video__fade is-bottom" style={{ height: framing.fades.bottom }} />
          <span className="framed-video__fade is-left" style={{ width: framing.fades.left }} />
          <span className="framed-video__fade is-right" style={{ width: framing.fades.right }} />
        </>
      )}
    </div>
  );
}
