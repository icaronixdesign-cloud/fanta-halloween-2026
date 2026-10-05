import { clamp01, easeInOutCubic } from '../media/frames';
import { jumpTo } from './scrollEngine';

/**
 * Seleção direta de sabor a partir de qualquer seção. O palco de sabores registra o navegador;
 * antes disso (ou sem JS) os links `#sabor-<id>` funcionam como âncoras comuns.
 */

export interface FlavorNavigateOptions {
  /** Mover o foco para o palco depois do salto (vindo de fora da seção). */
  moveFocus?: boolean;
}

type FlavorNavigator = (id: string, options?: FlavorNavigateOptions) => void;

let navigator: FlavorNavigator | null = null;

export function registerFlavorNavigator(fn: FlavorNavigator): () => void {
  navigator = fn;
  return () => {
    if (navigator === fn) navigator = null;
  };
}

export function goToFlavor(id: string, options?: FlavorNavigateOptions): boolean {
  if (!navigator) return false;
  navigator(id, options);
  return true;
}

const CUT_OUT_MS = 170;
let cutTimer = 0;

/**
 * Corte rápido para preto ao saltar entre seções distantes, para o salto instantâneo não parecer
 * um tranco. Com movimento reduzido, salta direto.
 */
export function cutTo(y: number, reducedMotion: boolean, after?: () => void): void {
  cancelGlide();
  const root = document.documentElement;
  if (reducedMotion || Math.abs(window.scrollY - y) < window.innerHeight * 0.75) {
    jumpTo(y);
    after?.();
    return;
  }
  window.clearTimeout(cutTimer);
  root.classList.add('is-cutting');
  cutTimer = window.setTimeout(() => {
    jumpTo(y);
    after?.();
    requestAnimationFrame(() => root.classList.remove('is-cutting'));
  }, CUT_OUT_MS);
}

let glideRaf = 0;
let glideCleanup: (() => void) | null = null;

/** Interrompe um deslizamento em curso (a pessoa voltou a rolar). */
export function cancelGlide(): void {
  if (glideRaf) cancelAnimationFrame(glideRaf);
  glideRaf = 0;
  glideCleanup?.();
  glideCleanup = null;
}

/**
 * Rolagem animada curta (sabor vizinho): a página passa pelo trecho da troca, então a lata gira
 * e o mundo do sabor muda como na rolagem manual. Qualquer roda, toque ou tecla interrompe.
 */
export function glideTo(y: number, duration: number, after?: () => void): void {
  cancelGlide();
  // Um corte pendente (clique anterior) perde para o deslizamento mais recente.
  window.clearTimeout(cutTimer);
  document.documentElement.classList.remove('is-cutting');
  const from = window.scrollY;
  const delta = y - from;
  const start = performance.now();
  const interrupt = () => cancelGlide();
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  let listening = false;
  glideCleanup = () => {
    if (listening) events.forEach((type) => window.removeEventListener(type, interrupt));
  };
  const step = (now: number) => {
    // Ouvintes só a partir do 1º quadro: o Enter/clique que iniciou o deslizamento não o cancela.
    if (!listening) {
      listening = true;
      events.forEach((type) => window.addEventListener(type, interrupt, { passive: true }));
    }
    const t = clamp01((now - start) / duration);
    jumpTo(from + delta * easeInOutCubic(t));
    if (t < 1) {
      glideRaf = requestAnimationFrame(step);
      return;
    }
    glideRaf = 0;
    glideCleanup?.();
    glideCleanup = null;
    after?.();
  };
  glideRaf = requestAnimationFrame(step);
}

/** Rola até uma seção pelo id (âncoras do cabeçalho e chamadas). */
export function goToSection(id: string, reducedMotion: boolean): void {
  const element = document.getElementById(id);
  if (!element) return;
  const y = element.getBoundingClientRect().top + window.scrollY;
  cutTo(y, reducedMotion, () => {
    const heading = element.querySelector<HTMLElement>('[data-section-focus]');
    heading?.focus({ preventScroll: true });
  });
}
