import { clamp, clamp01, smoothstep } from '../media/frames';

/**
 * Coreografia da CTA final, medida quadro a quadro na referência (reference-cta.mp4, 164 quadros).
 * Tudo é escrito em "batidas" da referência (0–163) e o scroll percorre essas batidas:
 *
 *  - vídeo: avança do quadro 0 ao 126 (acelera até 2× e assenta) e, sem parar a cena, volta ao
 *    quadro 5 (rápido no começo, assentando no fim). Interpolação monotônica, sem tranco na virada;
 *  - dois blocos sobem pela tela na velocidade da página (1,25 % da altura por batida), cada um
 *    acendendo no meio da tela;
 *  - o título monta letra a letra, linha após linha, enquanto o vídeo volta;
 *  - um degradê escurece a base e o botão sobe de baixo, assentando ao lado do título.
 */

export const CTA_BEATS = 163;
/** Parte do scroll usada pela coreografia; o resto segura a composição final antes de soltar. */
export const CTA_PLAY_END = 0.86;
/** Quadros do vídeo da CTA (segundo plano do vídeo original, 24 fps). */
export const CTA_FRAME_COUNT = 127;
/** Velocidade dos blocos, em fração da altura do palco por batida (igual à da referência). */
export const CTA_CARD_SPEED = 0.0125;

/** Batida da referência → quadro do vídeo (medido por diferença de imagem com a fonte). */
const VIDEO_KEYS: Array<[number, number]> = [
  [0, 0],
  [56, 55],
  [92, 111],
  [103, 119],
  [114, 126],
  [119, 107],
  [134, 47],
  [148, 20],
  [163, 5],
];

const videoCurve = monotoneCubic(VIDEO_KEYS);

export function beatForProgress(progress: number): number {
  return clamp01(progress / CTA_PLAY_END) * CTA_BEATS;
}

export function videoFrameForBeat(beat: number): number {
  return clamp(videoCurve(beat), 0, CTA_FRAME_COUNT - 1);
}

export interface CardMotion {
  /** Batida em que o topo do bloco está em `top` (fração da altura do palco). */
  beat: number;
  top: number;
  /** Batidas em que o bloco acende. */
  fadeFrom: number;
  fadeTo: number;
}

/** Topo do bloco (fração da altura) e opacidade numa batida. */
export function cardState(card: CardMotion, beat: number): { top: number; opacity: number } {
  return {
    top: card.top - (beat - card.beat) * CTA_CARD_SPEED,
    opacity: smoothstep(card.fadeFrom, card.fadeTo, beat),
  };
}

/** Bloco da esquerda: acende entre 13 e 24 e passa por 52 % na batida 23. */
export const CARD_LEFT: CardMotion = { beat: 23, top: 0.52, fadeFrom: 13, fadeTo: 24 };
/** Bloco da direita: acende entre 46 e 62 e passa por 54 % na batida 64. */
export const CARD_RIGHT: CardMotion = { beat: 64, top: 0.544, fadeFrom: 46, fadeTo: 62 };

/**
 * Montagem do título: letras entre as batidas 108 e 124, cada uma leva 6 batidas. Em tela em pé o
 * título espera o vídeo recuar (`PORTRAIT_TITLE_DELAY`).
 */
export const PORTRAIT_TITLE_DELAY = 6;
const TITLE_FROM = 108;
const TITLE_SPAN = 16;
const LETTER_BEATS = 6;

export function letterProgress(index: number, total: number, beat: number, delay = 0): number {
  const start = TITLE_FROM + delay + (total > 1 ? (index / (total - 1)) * TITLE_SPAN : 0);
  return clamp01((beat - start) / LETTER_BEATS);
}

export function scrimOpacity(beat: number): number {
  return smoothstep(122, 137, beat);
}

/**
 * Só em tela em pé: o vídeo cobre o palco e, enquanto o título chega, recua para o topo (escala
 * ancorada no alto) para a lata não ficar sob o texto.
 */
export function videoShrink(beat: number): number {
  return smoothstep(96, 118, beat);
}

/** Botão: 0 = abaixo do palco, 1 = assentado (sobe entre 138 e 152, desacelerando). */
export function buttonRise(beat: number): number {
  const t = clamp01((beat - 138) / 14);
  return 1 - Math.pow(1 - t, 3);
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

/** Interpolação cúbica monotônica (Fritsch–Carlson): sem ultrapassar as chaves nem tremer na virada. */
function monotoneCubic(points: Array<[number, number]>): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}
