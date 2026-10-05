import { withBase } from './products';

/**
 * Elementos de fundo por sabor (frutas, gelo, gás). São imagens geradas para este projeto
 * (Figma AI, gpt-image), recortadas e convertidas para alfa a partir do fundo preto — cópias
 * derivadas em `public/media/fanta/derived/sabores-elementos/`. São direção de arte para o sabor,
 * não lista de ingredientes: o site não afirma composição de nenhum produto.
 *
 * Cada elemento ocupa um "lugar" calculado a partir do enquadramento real da lata e dos blocos de
 * texto (ver FlavorWorld). A profundidade define desfoque, brilho e quanto o mouse o desloca.
 */

export type WorldSlot = 'hero' | 'upper' | 'lower' | 'floor' | 'drift';

export interface WorldSprite {
  src: string;
  /** Tamanho do recorte, em px (para a proporção). */
  w: number;
  h: number;
  slot: WorldSlot;
  /** Rotação de repouso, em graus. */
  rot: number;
  /** Escala relativa ao tamanho do lugar. */
  scale?: number;
  flip?: boolean;
}

const asset = (name: string) => withBase(`/media/fanta/derived/sabores-elementos/${name}.webp`);

const ICE = {
  cube: { src: asset('gelo-cubo'), w: 408, h: 440 },
  cubeSmall: { src: asset('gelo-cubo-menor'), w: 296, h: 392 },
  fizz: { src: asset('gelo-bolhas'), w: 432, h: 496 },
  chips: { src: asset('gelo-lascas'), w: 352, h: 360 },
};

export const FLAVOR_WORLD: Record<string, WorldSprite[]> = {
  'ghost-face-punch': [
    { src: asset('ghost-face-punch-roma'), w: 580, h: 728, slot: 'hero', rot: -8 },
    { src: asset('ghost-face-punch-framboesas'), w: 456, h: 448, slot: 'upper', rot: 12 },
    { src: asset('ghost-face-punch-sementes'), w: 584, h: 456, slot: 'lower', rot: -6 },
    { ...ICE.cubeSmall, slot: 'floor', rot: 14 },
    { ...ICE.fizz, slot: 'drift', rot: 0 },
  ],
  guarana: [
    { src: asset('guarana-cacho'), w: 576, h: 688, slot: 'hero', rot: 6 },
    { src: asset('guarana-fruto'), w: 344, h: 344, slot: 'upper', rot: -14 },
    { src: asset('guarana-sementes'), w: 472, h: 376, slot: 'lower', rot: 10 },
    { ...ICE.chips, slot: 'floor', rot: -8 },
    { ...ICE.fizz, slot: 'drift', rot: 180, flip: true },
  ],
  maracuja: [
    { src: asset('maracuja-metade'), w: 572, h: 688, slot: 'hero', rot: -4, flip: true },
    { src: asset('maracuja-metade-menor'), w: 408, h: 424, slot: 'upper', rot: 18 },
    { src: asset('maracuja-polpa'), w: 368, h: 448, slot: 'lower', rot: -10, scale: 0.9 },
    { ...ICE.cube, slot: 'floor', rot: 10 },
    { ...ICE.fizz, slot: 'drift', rot: 0 },
  ],
  uva: [
    { src: asset('uva-cacho'), w: 576, h: 872, slot: 'hero', rot: 10, scale: 1.08 },
    { src: asset('uva-metades'), w: 384, h: 344, slot: 'upper', rot: -10 },
    { src: asset('uva-bagos'), w: 400, h: 480, slot: 'lower', rot: 8 },
    { ...ICE.cubeSmall, slot: 'floor', rot: -12, flip: true },
    { ...ICE.fizz, slot: 'drift', rot: 180 },
  ],
  laranja: [
    { src: asset('laranja-rodela'), w: 544, h: 760, slot: 'hero', rot: 8 },
    { src: asset('laranja-metade'), w: 488, h: 496, slot: 'upper', rot: -16 },
    { src: asset('laranja-casca'), w: 488, h: 544, slot: 'lower', rot: 14 },
    { ...ICE.chips, slot: 'floor', rot: 6, flip: true },
    { ...ICE.fizz, slot: 'drift', rot: 0, flip: true },
  ],
  caju: [
    { src: asset('caju-fruto'), w: 496, h: 784, slot: 'hero', rot: -10 },
    { src: asset('caju-corte'), w: 432, h: 592, slot: 'upper', rot: 14 },
    { src: asset('caju-fatia'), w: 424, h: 408, slot: 'lower', rot: -12 },
    { ...ICE.cube, slot: 'floor', rot: -6, flip: true },
    { ...ICE.fizz, slot: 'drift', rot: 180 },
  ],
};

/** Profundidade de cada lugar: 0 = fundo (pequeno, desfocado, escuro), 1 = primeiro plano. */
export const SLOT_DEPTH: Record<WorldSlot, { depth: number; blur: number; opacity: number; parallax: number }> = {
  hero: { depth: 0.55, blur: 0, opacity: 0.94, parallax: 16 },
  upper: { depth: 0.15, blur: 2.4, opacity: 0.6, parallax: 6 },
  lower: { depth: 0.95, blur: 6, opacity: 0.82, parallax: 30 },
  floor: { depth: 0.45, blur: 0.8, opacity: 0.78, parallax: 12 },
  drift: { depth: 0.25, blur: 1.2, opacity: 0.42, parallax: 8 },
};
