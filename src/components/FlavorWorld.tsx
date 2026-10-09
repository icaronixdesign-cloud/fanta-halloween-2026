import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref, type RefObject } from 'react';
import { FLAVORS } from '../data/products';
import { FLAVOR_WORLD, SLOT_DEPTH, type WorldSlot } from '../data/flavorWorld';
import { clamp, clamp01 } from '../media/frames';
import type { Framing } from '../media/framing';

/**
 * Mundo do sabor: frutas, gelo e gás em volta da lata, por trás dos textos.
 *
 * Nada aqui pinta sobre a lata: a camada inteira tem uma máscara com um "buraco" do tamanho da
 * área ocupada pela lata em todos os quadros (medida no vídeo: x 33,9–64,1 %, y 13–90,7 %).
 * Os elementos que chegam nascem desse buraco — saem de trás da lata enquanto ela gira — e os
 * que vão embora passam pela câmera (crescem, desfocam e somem). Tudo segue o mesmo capítulo
 * contínuo da lata, então é reversível e fica parado quando a rolagem para.
 */

export interface FlavorWorldHandle {
  /** Capítulo contínuo e velocidade (capítulos por segundo). */
  setPose(cf: number, velocity: number): void;
  /** Parallax do mouse (-1…1, já suavizado): cada lugar se desloca conforme a profundidade dele. */
  setParallax(x: number, y: number): void;
}

interface Props {
  ref?: Ref<FlavorWorldHandle>;
  framing: Framing | null;
  wide: boolean;
  displayed: number;
  reducedMotion: boolean;
  /** Nível leve: sem desfoque nem flutuação, só os lugares de destaque, gás a 30 quadros/s. */
  lite: boolean;
  active: boolean;
  stageRef: RefObject<HTMLElement | null>;
  introRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  controlsRef: RefObject<HTMLElement | null>;
  /** Muda quando os textos mudam de tamanho (troca de sabor, fontes). */
  layoutKey: string;
}

/** Área da lata em todos os quadros (fração do quadro 16:9). */
const CAN_UNION = { x0: 0.339, x1: 0.641, y0: 0.13, y1: 0.907 };

interface Slot {
  x: number;
  y: number;
  /** Altura do lugar, em px. */
  s: number;
}

type Slots = Partial<Record<WorldSlot, Slot>>;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Atraso de cada lugar na entrada/saída (capítulos): o herói chega primeiro. */
const STAGGER: Record<WorldSlot, number> = { hero: 0, lower: 0.025, upper: 0.05, floor: 0.07, drift: 0.09 };
/** Lugares que ficam no nível leve: a fruta em destaque e os dois planos que dão profundidade. */
const LITE_SLOTS: ReadonlySet<WorldSlot> = new Set(['hero', 'lower', 'upper']);

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t: number) => t * t;

function relBox(element: HTMLElement | null, stage: DOMRect): Box | null {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { left: r.left - stage.left, top: r.top - stage.top, right: r.right - stage.left, bottom: r.bottom - stage.top };
}

function computeSlots(W: number, H: number, can: Box, wide: boolean, intro: Box | null, list: Box | null, controls: Box | null): Slots {
  const slots: Slots = {};
  if (wide) {
    const rightW = W - can.right;
    // Fruta em destaque: canto de baixo à direita, na faixa livre abaixo da lista e do play.
    const above = controls ?? list;
    const bandTop = above ? above.bottom + 18 : H * 0.3;
    const bandBottom = H - Math.max(36, H * 0.06);
    const band = Math.max(0, bandBottom - bandTop);
    const heroS = Math.min(band * 0.94, rightW * 0.95, H * 0.37);
    if (heroS > 70) slots.hero = { x: can.right + rightW * 0.46, y: (bandTop + bandBottom) / 2, s: heroS };

    if (intro) {
      const zoneTop = Math.max(64, H * 0.075);
      const zoneH = intro.top - 12 - zoneTop;
      if (zoneH >= 60) {
        slots.upper = { x: intro.left + (intro.right - intro.left) * 0.62, y: zoneTop + zoneH / 2, s: Math.min(zoneH * 0.96, H * 0.17) };
      } else {
        const gap = Math.max(0, can.left - intro.right);
        slots.upper = { x: intro.right + gap * 0.5, y: H * 0.16, s: Math.min(H * 0.11, Math.max(60, gap * 1.4)) };
      }
      const lowTop = intro.bottom + 10;
      const lowS = Math.min(Math.max(H - lowTop, H * 0.16) * 1.2, H * 0.3);
      // Primeiro plano desfocado: preso ao pé da tela, saindo pela borda.
      slots.lower = { x: Math.max(lowS * 0.36, can.left * 0.52), y: Math.max(lowTop + lowS * 0.5, H - lowS * 0.36), s: lowS };
    }
    slots.floor = { x: can.right + Math.min(40, rightW * 0.1), y: can.bottom - H * 0.045, s: H * 0.11 };
    // Gás que escapa da borda da lata (metade dentro do degradê da máscara).
    slots.drift = { x: can.right + rightW * 0.04, y: H * 0.34, s: H * 0.15 };
    return slots;
  }

  // Empilhado: a lata ocupa quase toda a largura no celular; no tablet sobra uma faixa de cada lado.
  const sideW = Math.min(can.left, W - can.right);
  const mid = can.top + (can.bottom - can.top) * 0.5;
  if (sideW < 90) {
    const s = Math.min(W * 0.44, H * 0.22);
    slots.hero = { x: W + s * 0.06, y: mid + (can.bottom - can.top) * 0.16, s };
    slots.lower = { x: -s * 0.1, y: mid - (can.bottom - can.top) * 0.18, s: s * 0.82 };
  } else {
    const s = Math.min(sideW * 1.25, H * 0.26);
    slots.hero = { x: can.right + sideW * 0.55, y: mid + (can.bottom - can.top) * 0.14, s };
    slots.lower = { x: can.left - sideW * 0.55, y: mid - (can.bottom - can.top) * 0.2, s: s * 0.8 };
    slots.floor = { x: can.left - sideW * 0.4, y: can.bottom - H * 0.05, s: H * 0.08 };
    slots.drift = { x: can.right + sideW * 0.4, y: can.top + H * 0.04, s: H * 0.1 };
  }
  return slots;
}

interface SpriteRuntime {
  element: HTMLDivElement | null;
  /** A imagem leva o desfoque: o conteúdo filtrado não muda com a flutuação (mais barato). */
  media: HTMLImageElement | null;
  flavor: number;
  slot: WorldSlot;
  rot: number;
  scale: number;
  aspect: number;
  /** Último estado escrito (evita gravações iguais no DOM). */
  lastTransform: string;
  lastOpacity: string;
  lastFilter: string;
}

const SPRITES: Array<{ flavor: number; index: number }> = FLAVORS.flatMap((flavor, f) =>
  (FLAVOR_WORLD[flavor.id] ?? []).map((_, index) => ({ flavor: f, index })),
);

export function FlavorWorld({
  ref,
  framing,
  wide,
  displayed,
  reducedMotion,
  lite,
  active,
  stageRef,
  introRef,
  listRef,
  controlsRef,
  layoutKey,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const groupRefs = useRef<(HTMLDivElement | null)[]>([]);
  const runtime = useRef<SpriteRuntime[]>(
    SPRITES.map(({ flavor, index }) => {
      const sprite = FLAVOR_WORLD[FLAVORS[flavor].id][index];
      return {
        element: null,
        media: null,
        flavor,
        slot: sprite.slot,
        rot: sprite.rot,
        scale: sprite.scale ?? 1,
        aspect: sprite.w / sprite.h,
        lastTransform: '',
        lastOpacity: '',
        lastFilter: '',
      };
    }),
  );
  const slotsRef = useRef<Slots>({});
  const canRef = useRef<Box>({ left: 0, top: 0, right: 0, bottom: 0 });
  const sizeRef = useRef({ W: 0, H: 0 });
  const pose = useRef({ cf: reducedMotion ? displayed + 0.5 : 0, velocity: 0, mx: 0, my: 0 });
  const [wanted, setWanted] = useState<number[]>([]);

  // Imagens: só do sabor exibido e dos vizinhos; uma vez pedidas, ficam.
  const want = reducedMotion ? [displayed] : [displayed, displayed + 1, displayed - 1];
  const missing = want.filter((index) => index >= 0 && index < FLAVORS.length && !wanted.includes(index));
  if (missing.length) setWanted([...wanted, ...missing]);

  /** Escreve transform/opacidade/desfoque de cada elemento para o capítulo atual. */
  const paint = useCallback(() => {
    const { cf, mx, my } = pose.current;
    const { W, H } = sizeRef.current;
    if (!W || !H) return;
    const can = canRef.current;
    const cx = (can.left + can.right) / 2;
    const cy = (can.top + can.bottom) / 2;
    const unit = H / 900;
    const groupVisible = new Array<boolean>(FLAVORS.length).fill(false);

    for (const sprite of runtime.current) {
      const element = sprite.element;
      const slot = slotsRef.current[sprite.slot];
      if (!element) continue;
      const delta = cf - (sprite.flavor + 0.5);
      const stagger = STAGGER[sprite.slot];
      const arrive = reducedMotion ? 1 : easeOutCubic(clamp01((delta + 0.54 - stagger) / 0.36));
      const depart = reducedMotion ? 0 : easeInQuad(clamp01((delta - 0.14 + stagger * 0.5) / 0.4));
      const depth = SLOT_DEPTH[sprite.slot];
      let opacity = depth.opacity * clamp01(arrive / 0.3) * (1 - clamp01((depart - 0.3) / 0.65));
      // Movimento reduzido: só o sabor escolhido, parado no lugar.
      if (!slot || (reducedMotion && Math.abs(delta) > 0.5) || (lite && !LITE_SLOTS.has(sprite.slot))) opacity = 0;
      if (opacity < 0.004) {
        if (sprite.lastOpacity !== '0') {
          element.style.opacity = '0';
          sprite.lastOpacity = '0';
        }
        continue;
      }
      groupVisible[sprite.flavor] = true;

      const h = slot!.s * sprite.scale;
      const w = h * sprite.aspect;
      // Chegada: sai de trás da lata (dentro do buraco da máscara) até o lugar.
      const ox = cx + (slot!.x - cx) * 0.18;
      const oy = cy + (slot!.y - cy) * 0.18;
      let x = ox + (slot!.x - ox) * arrive;
      let y = oy + (slot!.y - oy) * arrive;
      let scale = 0.42 + 0.58 * arrive;
      const spin = sprite.slot === 'hero' || sprite.slot === 'floor' ? 1 : -1;
      let rot = sprite.rot - (1 - arrive) * 38 * spin;
      let blur = depth.blur + (1 - arrive) * 7;
      // Saída: passa pela câmera, para fora e um pouco para cima.
      if (depart > 0) {
        const dx = slot!.x - cx;
        const dy = slot!.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const travel = depart * W * 0.16 * (0.6 + depth.depth);
        x += (dx / len) * travel;
        y += (dy / len) * travel - depart * H * 0.07;
        scale *= 1 + depart * (0.3 + 0.55 * depth.depth);
        rot += depart * 26 * spin;
        blur += depart * (5 + 10 * depth.depth);
      }
      // profundidade: quanto mais perto, mais o mouse o desloca (a lata anda -8px)
      x -= mx * depth.parallax;
      y -= my * depth.parallax * 0.6;
      const transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
      const opacityText = opacity.toFixed(3);
      const blurPx = Math.round(blur * unit);
      // leve: sem desfoque (cada raio novo é mais um passe de GPU sobre a imagem inteira)
      const filter = blurPx > 0 && !lite ? `blur(${blurPx}px)` : 'none';
      if (transform !== sprite.lastTransform) {
        element.style.transform = transform;
        sprite.lastTransform = transform;
      }
      if (opacityText !== sprite.lastOpacity) {
        element.style.opacity = opacityText;
        sprite.lastOpacity = opacityText;
      }
      if (filter !== sprite.lastFilter && sprite.media) {
        sprite.media.style.filter = filter;
        sprite.lastFilter = filter;
      }
      const size = `${w.toFixed(1)}px`;
      if (element.style.width !== size) {
        element.style.width = size;
        element.style.height = `${h.toFixed(1)}px`;
      }
    }
    groupRefs.current.forEach((group, index) => {
      if (!group) return;
      const value = groupVisible[index] ? '' : 'none';
      if (group.style.display !== value) group.style.display = value;
    });
  }, [reducedMotion, lite]);

  // Lugares: dependem do enquadramento da lata e dos blocos de texto.
  const relayout = useCallback(() => {
    const stage = stageRef.current;
    const root = rootRef.current;
    if (!stage || !root || !framing) return;
    const stageRect = stage.getBoundingClientRect();
    const W = stageRect.width;
    const H = stageRect.height;
    sizeRef.current = { W, H };
    const can: Box = {
      left: framing.left + CAN_UNION.x0 * framing.width,
      right: framing.left + CAN_UNION.x1 * framing.width,
      top: framing.top + CAN_UNION.y0 * framing.height,
      bottom: framing.top + CAN_UNION.y1 * framing.height,
    };
    canRef.current = can;
    root.style.setProperty('--hole-l', `${can.left.toFixed(1)}px`);
    root.style.setProperty('--hole-r', `${can.right.toFixed(1)}px`);
    root.style.setProperty('--hole-t', `${can.top.toFixed(1)}px`);
    root.style.setProperty('--hole-b', `${can.bottom.toFixed(1)}px`);
    slotsRef.current = computeSlots(
      W,
      H,
      can,
      wide,
      relBox(introRef.current, stageRect),
      relBox(listRef.current, stageRect),
      relBox(controlsRef.current, stageRect),
    );
    paint();
  }, [framing, wide, stageRef, introRef, listRef, controlsRef, paint]);

  useEffect(() => {
    relayout();
    // A fonte do nome e as animações de entrada mudam a altura do bloco logo depois.
    const timer = window.setTimeout(relayout, 260);
    return () => window.clearTimeout(timer);
  }, [relayout, layoutKey]);

  useImperativeHandle(
    ref,
    () => ({
      setPose(cf: number, velocity: number) {
        pose.current.cf = cf;
        pose.current.velocity = velocity;
        paint();
      },
      setParallax(x: number, y: number) {
        pose.current.mx = x;
        pose.current.my = y;
        paint();
      },
    }),
    [paint],
  );

  // troca de nível no meio da visita: reescreve tudo (lugares que somem, desfoque)
  useEffect(() => {
    paint();
  }, [paint]);

  // Movimento reduzido: sem rolagem presa, os elementos seguem o sabor escolhido.
  useEffect(() => {
    if (!reducedMotion) return;
    pose.current.cf = displayed + 0.5;
    paint();
  }, [reducedMotion, displayed, paint]);

  // Gás: bolhas subindo, mais rápidas enquanto a lata gira. Só com a seção em cena.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || reducedMotion || !active) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = lite ? 1 : Math.min(2, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    interface Bubble {
      x: number;
      y: number;
      r: number;
      speed: number;
      wobble: number;
      phase: number;
      alpha: number;
    }
    let bubbles: Bubble[] = [];
    // Cada bolha (anel + brilho) é desenhada uma vez por tamanho num canvas pequeno; por quadro só há drawImage com
    // alfa. Desenhar dois arcos e montar duas cores rgba() por bolha a cada quadro pesava no thread principal.
    const GLYPH_SIZES = 8;
    const glyphs = Array.from({ length: GLYPH_SIZES }, (_, index) => {
      const r = 0.8 + (3.6 * index) / (GLYPH_SIZES - 1);
      const half = Math.ceil(r + 1.5);
      const glyph = document.createElement('canvas');
      glyph.width = glyph.height = Math.ceil(half * 2 * dpr);
      const g = glyph.getContext('2d')!;
      g.scale(dpr, dpr);
      g.beginPath();
      g.arc(half, half, r, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255, 252, 245, 0.55)';
      g.lineWidth = 0.8;
      g.stroke();
      g.beginPath();
      g.arc(half - r * 0.35, half - r * 0.35, Math.max(0.5, r * 0.3), 0, Math.PI * 2);
      g.fillStyle = 'rgba(255, 255, 255, 0.8)';
      g.fill();
      return { canvas: glyph, half };
    });
    const spawn = (anywhere: boolean): Bubble => ({
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 10 + Math.random() * 40,
      r: 0.8 + Math.pow(Math.random(), 2.2) * 3.6,
      speed: 18 + Math.random() * 46,
      wobble: 4 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.5,
    });
    const resize = () => {
      W = stage.clientWidth;
      H = stage.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(clamp((W * H) / (lite ? 40000 : 20000), lite ? 12 : 18, lite ? 40 : 80));
      bubbles = Array.from({ length: count }, () => spawn(true));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    let raf = 0;
    let last = 0;
    let boost = 0;
    let odd = false;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // leve: 30 quadros/s bastam para bolhas pequenas subindo
      odd = !odd;
      if (lite && odd) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      boost += (Math.min(6, Math.abs(pose.current.velocity) * 3) - boost) * Math.min(1, dt * 6);
      context.clearRect(0, 0, W, H);
      context.globalCompositeOperation = 'lighter';
      const t = now / 1000;
      for (const bubble of bubbles) {
        bubble.y -= bubble.speed * (1 + boost) * dt;
        if (bubble.y < -12) Object.assign(bubble, spawn(false));
        const x = bubble.x + Math.sin(t * 1.6 + bubble.phase) * bubble.wobble;
        const fade = clamp01(bubble.y / (H * 0.25)) * clamp01((H - bubble.y + 40) / 120);
        const alpha = bubble.alpha * fade;
        if (alpha < 0.02) continue;
        const glyph = glyphs[Math.min(GLYPH_SIZES - 1, Math.round(((bubble.r - 0.8) / 3.6) * (GLYPH_SIZES - 1)))];
        context.globalAlpha = alpha;
        context.drawImage(glyph.canvas, x - glyph.half, bubble.y - glyph.half, glyph.half * 2, glyph.half * 2);
      }
      context.globalAlpha = 1;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      context.clearRect(0, 0, W, H);
    };
  }, [active, reducedMotion, lite, stageRef]);

  return (
    <div ref={rootRef} className={`world${lite ? ' is-lite' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="world__fizz" />
      {FLAVORS.map((flavor, f) => (
        <div
          key={flavor.id}
          ref={(element) => {
            groupRefs.current[f] = element;
          }}
          className="world__group"
          data-flavor={flavor.id}
          style={{ display: 'none' }}
        >
          {(FLAVOR_WORLD[flavor.id] ?? []).map((sprite, index) => {
            const runtimeIndex = SPRITES.findIndex((entry) => entry.flavor === f && entry.index === index);
            return (
              <div
                key={`${sprite.slot}-${index}`}
                ref={(element) => {
                  runtime.current[runtimeIndex].element = element;
                }}
                className={`world__sprite is-${sprite.slot}`}
                style={{ opacity: 0 }}
              >
                <div
                  className="world__float"
                  style={
                    {
                      '--float-dur': `${(5.5 + ((f * 7 + index * 3) % 5) * 0.9).toFixed(1)}s`,
                      '--float-delay': `${(-((f * 5 + index * 11) % 9) * 0.7).toFixed(1)}s`,
                    } as CSSProperties
                  }
                >
                  <img
                    ref={(element) => {
                      runtime.current[runtimeIndex].media = element;
                    }}
                    src={wanted.includes(f) ? sprite.src : undefined}
                    alt=""
                    width={sprite.w}
                    height={sprite.h}
                    decoding="async"
                    draggable={false}
                    style={sprite.flip ? { transform: 'scaleX(-1)' } : undefined}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
