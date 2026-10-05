import type { SafeArea } from '../data/products';
import { clamp } from './frames';

/**
 * Enquadramento sem cortar o produto.
 *
 * O vídeo mantém sempre 16:9 (sem deformar). Ele cresce até cobrir o palco, mas nunca a ponto de
 * a área segura (onde a lata — tampa, base, logo e personagem — aparece em todos os quadros) sair
 * da região disponível. Quando o vídeo fica menor que o palco, as bordas de estúdio são fundidas
 * ao preto da página com degradês que só ocupam a faixa vazia fora da área segura.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FramingInput {
  containerWidth: number;
  containerHeight: number;
  aspect: number;
  safe: SafeArea;
  /** Região do palco onde a área segura precisa caber (desconta textos e controles). */
  insets: Insets;
  /** Posição do centro da área segura dentro da região (0–1). */
  anchorX?: number;
  anchorY?: number;
  /** Limite superior da largura do vídeo (px). */
  maxWidth?: number;
}

export interface EdgeFades {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Framing {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Área segura em coordenadas do palco (px). */
  safeRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  fades: EdgeFades;
  containerWidth: number;
  containerHeight: number;
}

const MAX_FADE_FRACTION = 0.14;
const FADE_GAP = 6;

export function computeFraming(input: FramingInput): Framing {
  const { containerWidth: W, containerHeight: H, aspect, safe, insets } = input;
  const regionLeft = insets.left;
  const regionTop = insets.top;
  const regionW = Math.max(1, W - insets.left - insets.right);
  const regionH = Math.max(1, H - insets.top - insets.bottom);
  const safeW = safe.x1 - safe.x0;
  const safeH = safe.y1 - safe.y0;

  const widthLimitBySafe = Math.min(regionW / safeW, (regionH / safeH) * aspect);
  const coverWidth = Math.max(W, H * aspect);
  let width = Math.min(coverWidth, widthLimitBySafe);
  if (input.maxWidth) width = Math.min(width, input.maxWidth);
  width = Math.max(1, width);
  const height = width / aspect;

  const safeCx = ((safe.x0 + safe.x1) / 2) * width;
  const safeCy = ((safe.y0 + safe.y1) / 2) * height;
  let left = regionLeft + regionW * (input.anchorX ?? 0.5) - safeCx;
  let top = regionTop + regionH * (input.anchorY ?? 0.5) - safeCy;

  // Faixa em que a área segura continua inteira dentro da região.
  const safeLeftMin = regionLeft - safe.x0 * width;
  const safeLeftMax = regionLeft + regionW - safe.x1 * width;
  const safeTopMin = regionTop - safe.y0 * height;
  const safeTopMax = regionTop + regionH - safe.y1 * height;

  // Preferência: quando o vídeo é maior que o palco, encostar as bordas para fora (sem faixas).
  left = preferCover(left, width, W, safeLeftMin, safeLeftMax);
  top = preferCover(top, height, H, safeTopMin, safeTopMax);

  const safeRect = {
    left: left + safe.x0 * width,
    top: top + safe.y0 * height,
    right: left + safe.x1 * width,
    bottom: top + safe.y1 * height,
    width: safeW * width,
    height: safeH * height,
  };

  const fades: EdgeFades = {
    top: top > 0.5 ? fadeSize(height, safe.y0 * height) : 0,
    bottom: top + height < H - 0.5 ? fadeSize(height, (1 - safe.y1) * height) : 0,
    left: left > 0.5 ? fadeSize(width, safe.x0 * width) : 0,
    right: left + width < W - 0.5 ? fadeSize(width, (1 - safe.x1) * width) : 0,
  };

  return { left, top, width, height, safeRect, fades, containerWidth: W, containerHeight: H };
}

function preferCover(pos: number, size: number, container: number, safeMin: number, safeMax: number): number {
  if (safeMin > safeMax) return pos;
  let next = clamp(pos, safeMin, safeMax);
  if (size >= container) {
    const coverMin = container - size;
    const coverMax = 0;
    const lo = Math.max(coverMin, safeMin);
    const hi = Math.min(coverMax, safeMax);
    if (lo <= hi) next = clamp(next, lo, hi);
  }
  return next;
}

/** O degradê de borda nunca alcança a área segura. */
function fadeSize(size: number, gapToSafe: number): number {
  return Math.max(0, Math.min(size * MAX_FADE_FRACTION, gapToSafe - FADE_GAP));
}
