import { useSyncExternalStore } from 'react';

/**
 * Nível de qualidade da página: 'full' ou 'lite'. O leve mantém o giro da lata e a coreografia idênticos e corta o
 * que pesa em máquina fraca: mundo do sabor sem desfoque e com menos elementos, gás a 30 quadros/s e o Jack em
 * resolução 1× a 30 quadros/s. Vídeo 720p só quando o aparelho já abre no leve (ver FlavorShowcase).
 *
 * Começa leve em aparelho modesto (poucos núcleos, pouca memória, economia de dados) e rebaixa durante a visita se os
 * quadros da seção de sabores passarem do orçamento. Só rebaixa: voltar ao cheio no meio da visita trocaria o vídeo de
 * novo. `?q=lite` / `?q=full` forçam o nível (testes e comparação visual).
 */

export type Quality = 'full' | 'lite';

interface NavigatorHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function forced(): Quality | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('q');
  return value === 'lite' || value === 'full' ? value : null;
}

function detect(): Quality {
  const override = forced();
  if (override) return override;
  if (typeof navigator === 'undefined') return 'full';
  const nav = navigator as Navigator & NavigatorHints;
  if (nav.connection?.saveData) return 'lite';
  if ((nav.hardwareConcurrency ?? 8) <= 4) return 'lite';
  if ((nav.deviceMemory ?? 8) <= 4) return 'lite';
  return 'full';
}

let quality: Quality = detect();
let demotedBy = quality === 'lite' ? 'aparelho' : '';
const listeners = new Set<() => void>();

export function getQuality(): Quality {
  return quality;
}

/** Motivo do nível leve (diagnóstico): 'aparelho', 'quadros' ou vazio. */
export function getQualityReason(): string {
  return demotedBy;
}

export function demoteQuality(reason: string): void {
  if (quality === 'lite' || forced() === 'full') return;
  quality = 'lite';
  demotedBy = reason;
  listeners.forEach((listener) => listener());
}

export function subscribeQuality(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuality(): Quality {
  return useSyncExternalStore(subscribeQuality, getQuality, () => 'full');
}

/**
 * Vigia o ritmo dos quadros enquanto a seção anima. Chame `sample(now)` a cada requestAnimationFrame em que algo se
 * moveu: se em ~1 s um quarto dos quadros passar de 22 ms (p75), rebaixa para o leve. Intervalos > 100 ms (aba oculta,
 * pausa) não contam.
 */
export function createFrameMonitor(): { sample(now: number): void; reset(): void } {
  const WINDOW = 60;
  const BUDGET_MS = 22;
  const intervals: number[] = [];
  let last = 0;
  return {
    sample(now: number) {
      if (quality === 'lite') return;
      if (last) {
        const dt = now - last;
        if (dt > 0 && dt < 100) {
          intervals.push(dt);
          if (intervals.length > WINDOW) intervals.shift();
          if (intervals.length === WINDOW) {
            const sorted = [...intervals].sort((a, b) => a - b);
            if (sorted[Math.floor(WINDOW * 0.75)] > BUDGET_MS) demoteQuality('quadros');
          }
        }
      }
      last = now;
    },
    reset() {
      last = 0;
    },
  };
}
