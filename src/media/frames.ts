/**
 * Conversões entre progresso, quadro e tempo (03-GUIA-ANIMACOES.md, "Progresso → tempo").
 * O alvo é sempre o início de um quadro inteiro; o último quadro começa em (frames - 1) / fps,
 * nunca no instante terminal do arquivo.
 */

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

/** Progresso normalizado 0–1 → índice de quadro inteiro. */
export function progressToFrame(progress: number, frameCount: number): number {
  return Math.round(clamp01(progress) * (frameCount - 1));
}

/** Índice de quadro → tempo de início do quadro, em segundos. */
export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

/** Normaliza um quadro em laço (rotação contínua por arrasto). */
export function wrapFrame(frame: number, frameCount: number): number {
  return ((frame % frameCount) + frameCount) % frameCount;
}

/**
 * Remapeia o progresso de um trecho com pausas nas pontas: antes de `start` fica em 0,
 * depois de `end` fica em 1. Usado para segurar a lata de frente na entrada/saída do capítulo.
 */
export function holdRange(progress: number, start: number, end: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
