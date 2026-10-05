import { clamp, smoothstep, wrapFrame } from '../media/frames';

/**
 * Coreografia do palco de sabores, em função de um único número: o capítulo contínuo `cf`
 * (0 = início do 1º sabor, 1 = troca para o 2º, … COUNT = fim do último).
 *
 * As seis latas foram renderizadas com o mesmo movimento, quadro a quadro (medido por SSIM de
 * bordas: deslocamento 0 é o melhor alinhamento). Por isso cada capítulo é uma volta completa
 * que começa e termina com a lata de costas (quadro 90): a troca de sabor acontece ali, num
 * cruzamento curto entre dois vídeos no mesmo quadro, onde só mudam a cor dos respingos, o tom
 * da tampa e o brilho do chão. De frente (quadro 0, meio do capítulo) o giro quase para.
 */

export const TURN_FRAMES = 180;
export const BACK_FRAME = 90;
/** Velocidade de giro de frente ÷ velocidade de costas. */
const DWELL_RATIO = 0.06;
/** Meia-largura, em capítulos, do cruzamento entre as duas latas na troca. */
export const SWAP_HALF = 0.05;
/** Trecho fora do palco preso em que a 1ª lata entra girando (e a última sai). */
export const EDGE_SPAN = 0.5;

/**
 * Volta acumulada ao longo do capítulo (0 → 1), com velocidade r + (1 − r)·cos²(πq):
 * rápida nas trocas, quase parada de frente. Contínua entre capítulos (mesma velocidade nas pontas).
 */
export function turnEase(q: number): number {
  const whole = Math.floor(q);
  const x = q - whole;
  const r = DWELL_RATIO;
  const value = (r * x + (1 - r) * (x / 2 + Math.sin(2 * Math.PI * x) / (4 * Math.PI))) / (r + (1 - r) / 2);
  return whole + value;
}

/** Nas pontas da seção, a entrada (1º sabor) e a saída (último) ocupam também o trecho fora do palco. */
function edgeLocal(index: number, local: number, count: number): number {
  const stretch = 0.5 / (0.5 + EDGE_SPAN);
  if (index === 0 && local < 0.5) return 0.5 - (0.5 - Math.max(local, -EDGE_SPAN)) * stretch;
  if (index === count - 1 && local > 0.5) return 0.5 + (Math.min(local, 1 + EDGE_SPAN) - 0.5) * stretch;
  return local;
}

/** Quadro (float, 0–179) da lata `index` quando o capítulo contínuo vale `cf`. */
export function frameAt(index: number, cf: number, count: number): number {
  const local = edgeLocal(index, cf - index, count);
  return wrapFrame(BACK_FRAME + TURN_FRAMES * turnEase(local), TURN_FRAMES);
}

/** Capa adequada ao ângulo: de frente (quadro 0) ou de costas (quadro 90). */
export function facingFor(frame: number): 'front' | 'back' {
  return frame >= 45 && frame < 135 ? 'back' : 'front';
}

export interface StagePose {
  /** Sabor em primeiro plano: texto, seletor, controles. */
  index: number;
  /** Progresso local desse sabor (0–1, limitado). */
  local: number;
  /** Durante a troca: sabor de baixo (sai) e de cima (entra), com a opacidade do de cima. */
  swap: { under: number; over: number; mix: number } | null;
  /** Distância (capítulos) até a troca mais próxima, com sinal. */
  toSwap: number;
}

export function poseAt(cf: number, count: number): StagePose {
  const index = clamp(Math.floor(cf), 0, count - 1);
  const local = clamp(cf - index, 0, 1);
  const boundary = Math.round(cf);
  const toSwap = cf - boundary;
  let swap: StagePose['swap'] = null;
  if (boundary >= 1 && boundary <= count - 1 && Math.abs(toSwap) < SWAP_HALF) {
    swap = { under: boundary - 1, over: boundary, mix: smoothstep(-SWAP_HALF, SWAP_HALF, toSwap) };
  }
  return { index, local, swap, toSwap: boundary >= 1 && boundary <= count - 1 ? toSwap : 1 };
}

/** Limites do capítulo contínuo (inclui a entrada e a saída fora do palco). */
export function clampChapter(cf: number, count: number): number {
  return clamp(cf, -EDGE_SPAN, count + EDGE_SPAN);
}
