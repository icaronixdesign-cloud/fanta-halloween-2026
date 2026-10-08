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
  /** O mesmo vídeo recortado no centro (faixa `VIDEO_CROP` do quadro, resolução cheia), para telas em pé. */
  videoCrop: string;
}

/**
 * Faixa horizontal (fração do quadro 16:9) coberta pelos vídeos `-m`: 896×1080 px a partir de x = 504 px. No celular
 * em pé só o miolo do quadro aparece; o recorte tem o mesmo detalhe em ~40% dos bytes e da decodificação. O quadro
 * lógico continua 16:9 (área segura, máscaras e capas inalteradas): o vídeo recortado só é posicionado dentro dele.
 */
export const VIDEO_CROP = { x0: 504 / 1920, x1: 1400 / 1920 };

/** Prefixa caminhos públicos com a base do Vite, para não depender de caminho absoluto. */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

// Medido por desvio-padrão temporal de todos os quadros (ver README): a lata individual ocupa
// x 33,9–64,1% e y 13–90,7% do quadro.
const FLAVOR_SAFE: SafeArea = { x0: 0.325, x1: 0.665, y0: 0.115, y1: 0.925 };

const kitItems = siteData.items as KitItem[];

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
}

const FLAVOR_UI: Record<string, FlavorUi> = {
  'ghost-face-punch': {
    nameLines: ['Ghost', 'Face', 'Punch'],
    accent: '#ff5fae',
    glow: '#a7466d',
    character: 'Figura encapuzada com máscara de fantasma',
    palette: 'Preto, rosa e magenta',
  },
  guarana: {
    nameLines: ['Guaraná'],
    accent: '#52dd74',
    glow: '#268656',
    character: 'Lobisomem de fones e óculos redondos',
    palette: 'Verde ácido',
  },
  maracuja: {
    nameLines: ['Maracujá'],
    accent: '#f7c653',
    glow: '#a48148',
    character: 'Rosto costurado, versão âmbar',
    palette: 'Amarelo e âmbar',
  },
  uva: {
    nameLines: ['Uva'],
    accent: '#ac85ff',
    glow: '#7055a5',
    character: 'Vampiro de cabelo penteado para trás',
    palette: 'Roxo e lilás',
  },
  laranja: {
    nameLines: ['Laranja'],
    accent: '#ff8b3d',
    glow: '#af5f44',
    character: 'Espantalho com cabeça de abóbora',
    palette: 'Laranja queimado',
  },
  caju: {
    nameLines: ['Caju'],
    accent: '#ff5d4d',
    glow: '#a94a42',
    character: 'Rosto marcado por cicatrizes, versão vermelha',
    palette: 'Vermelho e coral',
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
      videoCrop: withBase(item.video.replace(/\.mp4$/, '-m.mp4')),
    };
  });

export function flavorById(id: string): Flavor | undefined {
  return FLAVORS.find((flavor) => flavor.id === id);
}
