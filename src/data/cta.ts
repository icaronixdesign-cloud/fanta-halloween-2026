import { flavorById, withBase, type Flavor, type MediaItem } from './products';

/**
 * CTA final: segundo plano do vídeo `video-fanta_HD.mp4` (quadros 41–167 da fonte, 23,976 fps),
 * recodificado a 24 fps com um quadro-chave por quadro para o scrub ir e voltar sem atraso.
 * A lata na mão é a Fanta Uva (vampiro de cabelo penteado para trás).
 */

export const CTA_MEDIA: MediaItem = {
  id: 'cta',
  name: 'CTA final',
  video: withBase('/media/fanta/cta/fanta-cta-scrub.mp4'),
  poster: withBase('/media/fanta/cta/fanta-cta-quadro-000.jpg'),
  width: 1920,
  height: 1080,
  aspect: 16 / 9,
  fps: 24,
  frameCount: 127,
  lastFrameTimeSeconds: 126 / 24,
  bytes: 9_255_444,
  // Rosto, mãos e lata ao longo do trecho usado.
  safe: { x0: 0.3, x1: 0.68, y0: 0.05, y1: 0.95 },
};

/** Quadro 5: pose final da coreografia (a cena volta até aqui). Capa com movimento reduzido. */
export const CTA_FINAL_POSTER = withBase('/media/fanta/cta/fanta-cta-quadro-005.jpg');

/** Centro do assunto no quadro (rosto + lata), para enquadrar em telas estreitas. */
export const CTA_FOCUS_X = 0.47;

function requireFlavor(id: string): Flavor {
  const flavor = flavorById(id);
  if (!flavor) throw new Error(`Sabor ausente: ${id}`);
  return flavor;
}

export const CTA_FLAVOR = requireFlavor('uva');

export interface CtaCard {
  id: string;
  kicker: string;
  text: string;
  thumb: string;
  thumbAlt: string;
}

const LARANJA = requireFlavor('laranja');

export const CTA_CARDS: [CtaCard, CtaCard] = [
  {
    id: 'colecao',
    kicker: 'Edição Halloween 2026',
    text: 'Seis sabores, seis personagens.',
    thumb: LARANJA.thumb,
    thumbAlt: '',
  },
  {
    id: CTA_FLAVOR.id,
    kicker: `Nº ${CTA_FLAVOR.number} · ${CTA_FLAVOR.name}`,
    text: 'O vampiro da coleção.',
    thumb: CTA_FLAVOR.thumb,
    thumbAlt: '',
  },
];

export const CTA_TITLE_LINES = ['Um gole', 'e a noite', 'fica roxa.'];
