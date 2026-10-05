import { clamp01 } from '../media/frames';

/**
 * Um único ouvinte de scroll/resize para a página inteira. Cada seção registrada recebe seu
 * progresso (0–1) dentro de um requestAnimationFrame, sem re-renderizar React a cada evento.
 * Remede em resize, mudança de orientação, carregamento de fontes e mudança de altura do documento.
 */

export interface ScrollInfo {
  progress: number;
  scrollY: number;
  sectionTop: number;
  /** Distância rolável enquanto o palco fica preso. */
  range: number;
  viewportHeight: number;
}

type Callback = (info: ScrollInfo) => void;

interface Entry {
  element: HTMLElement;
  stage: HTMLElement | null;
  callback: Callback;
  top: number;
  range: number;
}

class ScrollEngine {
  private readonly entries = new Set<Entry>();
  private raf = 0;
  private needsMeasure = true;
  private resizeObserver: ResizeObserver | null = null;
  private attached = false;

  register(element: HTMLElement, callback: Callback, stage: HTMLElement | null = null): () => void {
    const entry: Entry = { element, stage, callback, top: 0, range: 0 };
    this.entries.add(entry);
    this.attach();
    this.requestMeasure();
    return () => {
      this.entries.delete(entry);
      if (this.entries.size === 0) this.detach();
    };
  }

  requestMeasure = (): void => {
    this.needsMeasure = true;
    this.schedule();
  };

  /** Topo absoluto de uma seção registrada (para saltos programáticos). */
  measureNow(): void {
    this.measure();
    this.update();
  }

  private readonly onScroll = (): void => this.schedule();

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.needsMeasure) this.measure();
      this.update();
    });
  }

  private measure(): void {
    this.needsMeasure = false;
    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    for (const entry of this.entries) {
      const rect = entry.element.getBoundingClientRect();
      entry.top = rect.top + scrollY;
      const stageHeight = entry.stage ? entry.stage.offsetHeight : viewportHeight;
      entry.range = Math.max(0, entry.element.offsetHeight - stageHeight);
    }
  }

  private update(): void {
    const scrollY = window.scrollY;
    const viewportHeight = window.innerHeight;
    for (const entry of this.entries) {
      const progress =
        entry.range > 0 ? clamp01((scrollY - entry.top) / entry.range) : scrollY >= entry.top ? 1 : 0;
      entry.callback({ progress, scrollY, sectionTop: entry.top, range: entry.range, viewportHeight });
    }
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.requestMeasure);
    window.addEventListener('orientationchange', this.requestMeasure);
    window.addEventListener('load', this.requestMeasure);
    document.fonts?.ready.then(this.requestMeasure).catch(() => {});
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.requestMeasure);
      this.resizeObserver.observe(document.body);
    }
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.requestMeasure);
    window.removeEventListener('orientationchange', this.requestMeasure);
    window.removeEventListener('load', this.requestMeasure);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export const scrollEngine = new ScrollEngine();

/** Posição absoluta (scrollY) para um progresso dentro de uma seção com palco preso. */
export function scrollYForProgress(section: HTMLElement, stage: HTMLElement | null, progress: number): number {
  const top = section.getBoundingClientRect().top + window.scrollY;
  const stageHeight = stage ? stage.offsetHeight : window.innerHeight;
  const range = Math.max(0, section.offsetHeight - stageHeight);
  return top + range * clamp01(progress);
}

/** Salto instantâneo (sem passar pelos capítulos intermediários). */
export function jumpTo(y: number): void {
  window.scrollTo({ top: Math.round(y), left: 0, behavior: 'instant' as ScrollBehavior });
}
