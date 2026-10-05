import siteData from './produtos-site.json';

/**
 * Dados de mídia: vêm do kit (04-produtos-site.json, revisão v2-tampa-fixa) sem alteração.
 * Dados de interface: cor de acento, quebra do nome e descrição visual da arte, medidos/observados
 * nos próprios vídeos. Nada de preço, ingredientes, disponibilidade ou dados comerciais.
 */

export const MEDIA_REVISION = siteData.revision;

/** Retângulo em frações do quadro 16:9 (0–1) onde o produto aparece em todos os quadros. */
export interface SafeArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface KitItem {
  id: string;
  name: string;
  type: string;
  video: string;
  poster: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  frameCount: number;
  lastFrameIndex: number;
  lastFrameTimeSeconds: number;
  bytes: number;
}

export interface MediaItem {
  id: string;
  name: string;
  video: string;
  poster: string;
  width: number;
  height: number;
  aspect: number;
  fps: number;
  frameCount: number;
  lastFrameTimeSeconds: number;
  bytes: number;
  safe: SafeArea;
}

export interface Flavor extends MediaItem {
  number: string;
  /** Linhas do nome em destaque. */
  nameLines: string[];
  /** Acento de interface, legível sobre preto. */
  accent: string;
  /** Tom do brilho de chão do vídeo, usado em halos discretos. */
  glow: string;
  /** Descrição visual do personagem da arte. */
  character: string;
  /** Paleta da arte. */
  palette: string;
  /** Miniatura recortada da capa v2 (cópia derivada). */
  thumb: string;
  /** Quadro 090 do vídeo (lata de costas, cópia derivada): capa durante a troca de sabor. */
  posterBack: string;
  /** Centro horizontal da lata no vídeo da coleção (fração do quadro). */
  collectionX: number;
}

export interface Collection extends MediaItem {
  /** Capa oficial (quadro 120, Ghost Face Punch à frente). */
  officialPoster: string;
  /** Cópia derivada do quadro 000, igual ao início da sequência de scroll. */
  firstFramePoster: string;
  /** Quadro representado pela capa oficial. */
  officialPosterFrame: number;
}

/** Prefixa caminhos públicos com a base do Vite, para não depender de caminho absoluto. */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

// Medido por desvio-padrão temporal de todos os quadros (ver README): a lata individual ocupa
// x 33,9–64,1% e y 13–90,7% do quadro; a coleção ocupa x 6,8–94,8% e y ~30–82% (abaixo é reflexo).
const FLAVOR_SAFE: SafeArea = { x0: 0.325, x1: 0.665, y0: 0.115, y1: 0.925 };
const COLLECTION_SAFE: SafeArea = { x0: 0.055, x1: 0.96, y0: 0.27, y1: 0.85 };

const kitItems = siteData.items as KitItem[];

function kitItem(id: string): KitItem {
  const item = kitItems.find((entry) => entry.id === id);
  if (!item) throw new Error(`Item ausente em produtos-site.json: ${id}`);
  return item;
}

function toMedia(item: KitItem, safe: SafeArea): MediaItem {
  return {
    id: item.id,
    name: item.name,
    video: withBase(item.video),
    poster: withBase(item.poster),
    width: item.width,
    height: item.height,
    aspect: item.width / item.height,
    fps: item.fps,
    frameCount: item.frameCount,
    lastFrameTimeSeconds: item.lastFrameTimeSeconds,
    bytes: item.bytes,
    safe,
  };
}

interface FlavorUi {
  nameLines: string[];
  accent: string;
  glow: string;
  character: string;
  palette: string;
  collectionX: number;
}

const FLAVOR_UI: Record<string, FlavorUi> = {
  'ghost-face-punch': {
    nameLines: ['Ghost', 'Face', 'Punch'],
    accent: '#ff5fae',
    glow: '#a7466d',
    character: 'Figura encapuzada com máscara de fantasma',
    palette: 'Preto, rosa e magenta',
    collectionX: 0.457,
  },
  guarana: {
    nameLines: ['Guaraná'],
    accent: '#52dd74',
    glow: '#268656',
    character: 'Lobisomem de fones e óculos redondos',
    palette: 'Verde ácido',
    collectionX: 0.619,
  },
  maracuja: {
    nameLines: ['Maracujá'],
    accent: '#f7c653',
    glow: '#a48148',
    character: 'Rosto costurado, versão âmbar',
    palette: 'Amarelo e âmbar',
    collectionX: 0.269,
  },
  uva: {
    nameLines: ['Uva'],
    accent: '#ac85ff',
    glow: '#7055a5',
    character: 'Vampiro de cabelo penteado para trás',
    palette: 'Roxo e lilás',
    collectionX: 0.127,
  },
  laranja: {
    nameLines: ['Laranja'],
    accent: '#ff8b3d',
    glow: '#af5f44',
    character: 'Espantalho com cabeça de abóbora',
    palette: 'Laranja queimado',
    collectionX: 0.757,
  },
  caju: {
    nameLines: ['Caju'],
    accent: '#ff5d4d',
    glow: '#a94a42',
    character: 'Rosto marcado por cicatrizes, versão vermelha',
    palette: 'Vermelho e coral',
    collectionX: 0.892,
  },
};

export const FLAVORS: Flavor[] = kitItems
  .filter((item) => item.type === 'flavor')
  .map((item, index) => {
    const ui = FLAVOR_UI[item.id];
    if (!ui) throw new Error(`Sem dados de interface para ${item.id}`);
    return {
      ...toMedia(item, FLAVOR_SAFE),
      ...ui,
      number: String(index + 1).padStart(2, '0'),
      thumb: withBase(`/media/fanta/derived/fanta-${item.id}-thumb-v2.webp`),
      posterBack: withBase(`/media/fanta/derived/fanta-${item.id}-quadro-090-v2.jpg`),
    };
  });

const collectionItem = kitItem('colecao');

export const COLLECTION: Collection = {
  ...toMedia(collectionItem, COLLECTION_SAFE),
  officialPoster: withBase(collectionItem.poster),
  officialPosterFrame: 120,
  firstFramePoster: withBase('/media/fanta/derived/fanta-colecao-quadro-000-v2.jpg'),
};

/** Ordem das latas, da esquerda para a direita, no vídeo da coleção. */
export const COLLECTION_ORDER: Flavor[] = [...FLAVORS].sort((a, b) => a.collectionX - b.collectionX);

export function flavorById(id: string): Flavor | undefined {
  return FLAVORS.find((flavor) => flavor.id === id);
}
