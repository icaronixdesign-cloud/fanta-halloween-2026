import { clamp, easeInOutCubic, frameToTime, wrapFrame } from './frames';

/**
 * Controlador reutilizável de um <video> renderizado (sem alfa).
 *
 * Apenas um estado controla o tempo do vídeo em cada instante:
 *  - 'scroll'    → o progresso da seção define o quadro; vídeo pausado, `currentTime` por busca.
 *  - 'manual'    → arrasto/slider define o quadro; o scroll é ignorado até a próxima rolagem.
 *  - 'returning' → transição curta do quadro manual de volta ao alvo do scroll (depois vira 'scroll').
 *  - 'play'      → o relógio do player (loop) controla; nenhuma busca é emitida.
 *
 * Buscas: no máximo uma pendente por vídeo; durante a busca só o alvo mais recente é guardado.
 * Um agendador em requestAnimationFrame quantiza em quadros e descarta atribuições redundantes.
 * Cada troca de fonte incrementa `generation`, e callbacks da fonte anterior são ignorados.
 */

export type ControlMode = 'scroll' | 'manual' | 'returning' | 'play';
export type LoadState = 'empty' | 'loading' | 'ready' | 'error';
export type PreloadHint = 'none' | 'metadata' | 'auto';

export interface ControllerSnapshot {
  label: string;
  src: string | null;
  generation: number;
  mode: ControlMode;
  loadState: LoadState;
  active: boolean;
  targetFrame: number;
  /** Quadro pedido pela seção (antes da suavização); igual a targetFrame quando assentado. */
  scrollTargetFrame: number;
  requestedFrame: number;
  /** Último quadro tido como exibido (rVFC quando disponível; senão `seeked`). */
  presentedFrame: number;
  /** mediaTime informado por requestVideoFrameCallback para o último quadro apresentado. */
  lastFrameCallbackMediaTime: number | null;
  frameCallbackSupported: boolean;
  seekPending: boolean;
  seeksIssued: number;
  seeksCompleted: number;
  seekTimeouts: number;
  revealed: boolean;
  playing: boolean;
  currentTime: number;
  readyState: number;
  paused: boolean;
}

export interface ScrubVideoOptions {
  label: string;
  fps: number;
  frameCount: number;
  /** Último quadro em segundos (início do último quadro). */
  lastFrameTimeSeconds: number;
  /** Arrasto em laço (rotação contínua). */
  wrapManual?: boolean;
  onFrame?: (frame: number, mode: ControlMode) => void;
  onLoadState?: (state: LoadState) => void;
  onModeChange?: (mode: ControlMode) => void;
  /** Primeiro quadro utilizável apresentado para a fonte atual (hora de cobrir a capa). */
  onReveal?: (revealed: boolean) => void;
  onPlayBlocked?: () => void;
}

const SEEK_TIMEOUT_MS = 1400;
const RETURN_DURATION_MS = 460;
/** Constante de tempo da suavização do scroll (ms). */
const SCROLL_SMOOTHING_MS = 55;

const supportsFrameCallback =
  typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export class ScrubVideoController {
  readonly video: HTMLVideoElement;
  private readonly opts: ScrubVideoOptions;

  private generation = 0;
  private src: string | null = null;
  private mode: ControlMode = 'scroll';
  private loadState: LoadState = 'empty';
  private active = false;
  private destroyed = false;
  private raf = 0;
  private lastTick = 0;

  private scrollFrame = 0;
  private manualFrame = 0;
  private manualAnchorScrollFrame = 0;
  private returnFrom = 0;
  private returnStartedAt = 0;
  private smoothFrame = 0;
  private targetFrame = 0;
  /** Entrada já suavizada por fora (coreografia dos sabores): sem suavização extra no scroll. */
  private directScroll = false;

  private requestedFrame = -1;
  private presentedFrame = -1;
  private lastFrameCallbackMediaTime: number | null = null;
  private seekPending = false;
  private seekIssuedAt = 0;
  private seekGeneration = -1;
  private seeksIssued = 0;
  private seeksCompleted = 0;
  private seekTimeouts = 0;
  private maxTime = Infinity;
  private revealed = false;
  private frameCallbackHandle = 0;
  private playing = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(video: HTMLVideoElement, opts: ScrubVideoOptions) {
    this.video = video;
    this.opts = opts;
    this.maxTime = opts.lastFrameTimeSeconds;
    // Scrub: sem autoplay, sem loop, sem controles nativos. O controlador é o único a mexer no tempo.
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = false;
    video.loop = false;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('disableremoteplayback', '');
    this.listen('loadedmetadata', this.handleMetadata);
    this.listen('durationchange', this.handleMetadata);
    this.listen('loadeddata', this.handleLoadedData);
    this.listen('seeked', this.handleSeeked);
    this.listen('error', this.handleError);
    this.listen('pause', this.handlePause);
  }

  // ───────────────────────────── fonte e ciclo de vida ─────────────────────────────

  setSource(src: string | null, preload: PreloadHint = 'auto'): void {
    if (this.destroyed) return;
    if (src === this.src) {
      if (src) this.setPreload(preload);
      return;
    }
    this.generation += 1;
    this.stopPlayback(false);
    this.cancelFrameCallback();
    this.src = src;
    this.seekPending = false;
    this.requestedFrame = -1;
    this.presentedFrame = -1;
    this.lastFrameCallbackMediaTime = null;
    this.maxTime = this.opts.lastFrameTimeSeconds;
    this.setRevealed(false);
    if (!src) {
      this.video.removeAttribute('src');
      this.video.load();
      this.setLoadState('empty');
      return;
    }
    this.video.preload = preload;
    this.video.src = src;
    this.setLoadState('loading');
    this.kick();
  }

  setPreload(preload: PreloadHint): void {
    if (!this.src) return;
    // Só sobe a prioridade; nunca rebaixa um vídeo já carregando por completo.
    const rank = { none: 0, metadata: 1, auto: 2 } as const;
    const current = (this.video.preload || 'metadata') as PreloadHint;
    if (rank[preload] > (rank[current] ?? 0)) this.video.preload = preload;
  }

  /** Liga/desliga o agendador. Fora da área relevante, pausa e não agenda callbacks. */
  setActive(active: boolean): void {
    if (this.destroyed || active === this.active) return;
    this.active = active;
    if (!active) {
      if (this.mode === 'play') this.stopPlayback(true);
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.lastTick = 0;
      return;
    }
    this.kick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cancelFrameCallback();
    this.generation += 1;
    this.cleanups.forEach((fn) => fn());
    this.cleanups.length = 0;
    try {
      this.video.pause();
    } catch {
      /* elemento já removido */
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  // ───────────────────────────── entradas ─────────────────────────────

  /** Progresso da seção (0–1) já remapeado para o trecho que gira a lata. */
  setScrollProgress(progress: number): void {
    const frame = clamp(progress, 0, 1) * (this.opts.frameCount - 1);
    this.directScroll = false;
    this.applyScrollFrame(frame);
  }

  /**
   * Quadro (float) vindo de uma coreografia já suavizada. Em laço quando `wrapManual`
   * (179 → 0 continua o giro em vez de voltar a volta inteira).
   */
  setScrollFrame(frame: number): void {
    this.directScroll = true;
    this.applyScrollFrame(this.normalizeFrame(frame));
  }

  /** Igual a `setScrollFrame`, mas assume o controle na hora (sai de manual/reprodução). */
  jumpToScrollFrame(frame: number): void {
    if (this.mode === 'play') this.stopPlayback(false);
    this.directScroll = true;
    this.scrollFrame = this.normalizeFrame(frame);
    this.smoothFrame = this.scrollFrame;
    this.setMode('scroll');
    this.kick();
  }

  private applyScrollFrame(frame: number): void {
    this.scrollFrame = frame;
    if (this.mode === 'manual' && this.frameDistance(frame, this.manualAnchorScrollFrame) >= 1) {
      // Próxima rolagem depois de uma exploração manual: volta suavemente ao alvo da seção.
      this.returnFrom = this.manualFrame;
      this.returnStartedAt = performance.now();
      this.setMode('returning');
    }
    this.kick();
  }

  /** Posiciona a seção sem animação (ex.: troca de sabor, montagem). */
  jumpToScrollProgress(progress: number): void {
    if (this.mode === 'play') this.stopPlayback(false);
    this.directScroll = false;
    this.scrollFrame = clamp(progress, 0, 1) * (this.opts.frameCount - 1);
    this.smoothFrame = this.scrollFrame;
    this.setMode('scroll');
    this.kick();
  }

  /** Exploração manual (arrasto/slider/teclado). Suspende o scrub por scroll. */
  setManualFrame(frame: number): void {
    if (this.mode === 'play') this.stopPlayback(false);
    const next = this.opts.wrapManual
      ? wrapFrame(frame, this.opts.frameCount)
      : clamp(frame, 0, this.opts.frameCount - 1);
    this.manualFrame = next;
    this.manualAnchorScrollFrame = this.scrollFrame;
    this.setMode('manual');
    this.kick();
  }

  /** Quadro (float) que está sendo exibido/perseguido agora; base para começar um arrasto. */
  getCurrentFrame(): number {
    if (this.mode === 'play') return this.video.currentTime * this.opts.fps;
    if (this.mode === 'manual') return this.manualFrame;
    return this.smoothFrame;
  }

  getMode(): ControlMode {
    return this.mode;
  }

  getSource(): string | null {
    return this.src;
  }

  getLoadState(): LoadState {
    return this.loadState;
  }

  /** Reprodução contínua opcional. Resolve false se o navegador bloquear. */
  async play(): Promise<boolean> {
    if (!this.src || this.loadState === 'error' || this.destroyed) return false;
    const generation = this.generation;
    const startFrame = Math.round(this.getCurrentFrame());
    this.seekPending = false;
    this.setMode('play');
    this.video.loop = true;
    if (Math.abs(this.video.currentTime * this.opts.fps - startFrame) > 0.5) {
      this.video.currentTime = Math.min(this.maxTime, frameToTime(startFrame, this.opts.fps));
    }
    try {
      await this.video.play();
      if (generation !== this.generation || this.mode !== 'play') return false;
      this.playing = true;
      this.setRevealed(true);
      this.watchFrame();
      this.kick();
      return true;
    } catch {
      if (generation === this.generation) {
        this.video.loop = false;
        this.playing = false;
        this.manualFrame = startFrame;
        this.manualAnchorScrollFrame = this.scrollFrame;
        this.setMode('manual');
        this.opts.onPlayBlocked?.();
      }
      return false;
    }
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.stopPlayback(true);
  }

  // ───────────────────────────── diagnóstico ─────────────────────────────

  getSnapshot(): ControllerSnapshot {
    return {
      label: this.opts.label,
      src: this.src,
      generation: this.generation,
      mode: this.mode,
      loadState: this.loadState,
      active: this.active,
      targetFrame: this.targetFrame,
      scrollTargetFrame: this.normalizeFrame(Math.round(this.scrollFrame)),
      requestedFrame: this.requestedFrame,
      presentedFrame: this.presentedFrame,
      lastFrameCallbackMediaTime: this.lastFrameCallbackMediaTime,
      frameCallbackSupported: supportsFrameCallback,
      seekPending: this.seekPending,
      seeksIssued: this.seeksIssued,
      seeksCompleted: this.seeksCompleted,
      seekTimeouts: this.seekTimeouts,
      revealed: this.revealed,
      playing: this.playing,
      currentTime: this.video.currentTime,
      readyState: this.video.readyState,
      paused: this.video.paused,
    };
  }

  // ───────────────────────────── agendador ─────────────────────────────

  private kick(): void {
    if (!this.active || this.destroyed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    if (!this.active || this.destroyed) return;
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 16;
    this.lastTick = now;
    const keepGoing = this.step(now, dt);
    if (keepGoing) this.raf = requestAnimationFrame(this.tick);
    else this.lastTick = 0;
  };

  /** Retorna true enquanto houver trabalho (convergência, busca pendente ou reprodução). */
  private step(now: number, dt: number): boolean {
    const { frameCount, fps } = this.opts;

    if (this.mode === 'play') {
      // Com rVFC a leitura do quadro vem do próprio callback; sem ele, lê o relógio a cada frame.
      if (supportsFrameCallback) return false;
      this.reportFrame(Math.round(this.video.currentTime * fps) % frameCount);
      return this.playing;
    }

    let converging = false;
    if (this.mode === 'returning') {
      const t = clamp((now - this.returnStartedAt) / RETURN_DURATION_MS, 0, 1);
      let delta = this.scrollFrame - this.returnFrom;
      if (this.opts.wrapManual && Math.abs(delta) > frameCount / 2) delta -= Math.sign(delta) * frameCount;
      const value = this.returnFrom + delta * easeInOutCubic(t);
      this.smoothFrame = this.opts.wrapManual ? wrapFrame(value, frameCount) : value;
      if (t >= 1) {
        this.smoothFrame = this.scrollFrame;
        this.setMode('scroll');
      } else converging = true;
    } else if (this.mode === 'manual') {
      this.smoothFrame = this.manualFrame;
    } else if (this.directScroll) {
      this.smoothFrame = this.scrollFrame;
    } else {
      const diff = this.scrollFrame - this.smoothFrame;
      if (Math.abs(diff) < 0.04) this.smoothFrame = this.scrollFrame;
      else {
        this.smoothFrame += diff * (1 - Math.exp(-dt / SCROLL_SMOOTHING_MS));
        converging = true;
      }
    }

    let frame = Math.round(this.smoothFrame);
    frame = this.opts.wrapManual ? wrapFrame(frame, frameCount) : clamp(frame, 0, frameCount - 1);
    this.targetFrame = frame;

    if (!this.src || this.loadState === 'error') return converging;
    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) return converging; // 'loadedmetadata' chama kick()

    if (this.seekPending) {
      if (now - this.seekIssuedAt > SEEK_TIMEOUT_MS) {
        // Busca que não terminou: libera o agendador em vez de esperar para sempre.
        this.seekPending = false;
        this.seekTimeouts += 1;
        this.requestedFrame = -1;
      } else return true;
    }

    if (frame !== this.requestedFrame) {
      this.issueSeek(frame);
      return true;
    }
    return converging;
  }

  private issueSeek(frame: number): void {
    const time = Math.min(this.maxTime, frameToTime(frame, this.opts.fps));
    this.requestedFrame = frame;
    this.seekPending = true;
    this.seekIssuedAt = performance.now();
    this.seekGeneration = this.generation;
    this.seeksIssued += 1;
    this.watchFrame();
    this.video.currentTime = time;
  }

  // ───────────────────────────── eventos do elemento ─────────────────────────────

  private readonly handleMetadata = (): void => {
    const duration = this.video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    // Nunca buscar o instante terminal: limita ao início do último quadro e à duração real.
    const halfFrame = 0.5 / this.opts.fps;
    this.maxTime = Math.max(0, Math.min(this.opts.lastFrameTimeSeconds, duration - halfFrame));
    this.kick();
  };

  private readonly handleLoadedData = (): void => {
    if (this.loadState !== 'error') this.setLoadState('ready');
    if (this.requestedFrame < 0 && !this.seekPending) {
      const current = Math.round(this.video.currentTime * this.opts.fps);
      if (current === this.targetFrame) {
        // O quadro já decodificado é o alvo: nada a buscar, pode cobrir a capa.
        this.requestedFrame = current;
        this.presentedFrame = current;
        this.setRevealed(true);
        this.opts.onFrame?.(current, this.mode);
      }
    }
    this.kick();
  };

  private readonly handleSeeked = (): void => {
    if (this.seekGeneration !== this.generation) return;
    this.seekPending = false;
    this.seeksCompleted += 1;
    if (this.mode !== 'play') {
      // Fallback quando rVFC não existe ou não dispara (quadro idêntico): assume o quadro pedido.
      if (!supportsFrameCallback || this.presentedFrame !== this.requestedFrame) {
        this.reportFrame(this.requestedFrame);
      }
    }
    if (this.loadState === 'loading' && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.setLoadState('ready');
    }
    if (this.loadState === 'ready') this.setRevealed(true);
    this.kick();
  };

  private readonly handleError = (): void => {
    if (!this.src) return;
    this.seekPending = false;
    this.stopPlayback(false);
    this.setRevealed(false);
    this.setLoadState('error');
  };

  private readonly handlePause = (): void => {
    // Pausa externa (sistema, aba oculta) durante a reprodução: mantém o quadro e passa a manual.
    if (this.mode === 'play' && this.playing) this.stopPlayback(true);
  };

  // ───────────────────────────── utilitários internos ─────────────────────────────

  private stopPlayback(keepPositionAsManual: boolean): void {
    const wasPlaying = this.mode === 'play';
    this.playing = false;
    this.video.loop = false;
    if (!this.video.paused) this.video.pause();
    if (!wasPlaying) return;
    if (keepPositionAsManual) {
      const frame = Math.round(this.video.currentTime * this.opts.fps);
      this.manualFrame = clamp(frame, 0, this.opts.frameCount - 1);
      this.manualAnchorScrollFrame = this.scrollFrame;
      this.smoothFrame = this.manualFrame;
      this.requestedFrame = Math.round(this.manualFrame);
      this.setMode('manual');
    } else {
      this.smoothFrame = this.scrollFrame;
      this.requestedFrame = -1;
      this.setMode('scroll');
    }
  }

  private normalizeFrame(frame: number): number {
    const { frameCount, wrapManual } = this.opts;
    return wrapManual ? wrapFrame(frame, frameCount) : clamp(frame, 0, frameCount - 1);
  }

  /** Distância entre quadros, pelo caminho mais curto quando o giro é em laço. */
  private frameDistance(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return this.opts.wrapManual ? Math.min(diff, this.opts.frameCount - diff) : diff;
  }

  private watchFrame(): void {
    if (!supportsFrameCallback || this.frameCallbackHandle) return;
    const generation = this.generation;
    this.frameCallbackHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.frameCallbackHandle = 0;
      if (generation !== this.generation || this.destroyed) return;
      this.lastFrameCallbackMediaTime = metadata.mediaTime;
      const frame = Math.round(metadata.mediaTime * this.opts.fps) % this.opts.frameCount;
      this.reportFrame(frame);
      if (this.mode === 'play' && this.playing) this.watchFrame();
    });
  }

  private cancelFrameCallback(): void {
    if (this.frameCallbackHandle && supportsFrameCallback) {
      this.video.cancelVideoFrameCallback(this.frameCallbackHandle);
    }
    this.frameCallbackHandle = 0;
  }

  private reportFrame(frame: number): void {
    if (frame < 0) return;
    this.presentedFrame = frame;
    this.opts.onFrame?.(frame, this.mode);
  }

  private setMode(mode: ControlMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.opts.onModeChange?.(mode);
  }

  private setLoadState(state: LoadState): void {
    if (state === this.loadState) return;
    this.loadState = state;
    this.opts.onLoadState?.(state);
  }

  private setRevealed(revealed: boolean): void {
    if (revealed === this.revealed) return;
    this.revealed = revealed;
    this.opts.onReveal?.(revealed);
  }

  private listen(type: keyof HTMLMediaElementEventMap, handler: () => void): void {
    this.video.addEventListener(type, handler);
    this.cleanups.push(() => this.video.removeEventListener(type, handler));
  }
}
