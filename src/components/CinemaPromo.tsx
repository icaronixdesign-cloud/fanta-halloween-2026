import { useEffect, useRef, useState } from 'react';
import { CINEMA_PROMO } from '../data/cinemaPromo';
import { useInView, useScrollProgress } from '../interaction/hooks';
import type { CinemaPromo as Scene } from '../three/cinemaPromo';

/**
 * Promoção Fanta × Cinemark. O palco fica preso enquanto o scroll percorre a cena 3D (o Pânico sai do fundo
 * com o balde de pipoca, o vampiro o puxa com poderes e pega a Fanta Uva); no fim entra o painel da promoção
 * com o botão para a página do Cinemark. Com movimento reduzido a seção mostra só o quadro final.
 */

interface Props {
  reducedMotion: boolean;
  finePointer: boolean;
}

/** Trecho do scroll que percorre a animação (o resto é a chegada e o painel parado para ler). */
const PLAY_FROM = 0.04;
const PLAY_TO = 0.8;
/** Trecho do scroll em que o notebook amplia até a tela dele virar a viewport inteira. */
const ZOOM_FROM = 0.005;
const ZOOM_TO = 0.13;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Quanto a tela cresceu desde o notebook (1 no começo): o aro e a base crescem junto. */
  scale: number;
}

/**
 * Tela do notebook (px da viewport) para um zoom z (0 = notebook inteiro no centro, 1 = tela cheia). O notebook
 * cresce por igual (sem deformar) até a tela dele cobrir a viewport: em paisagem ela tem a proporção da viewport;
 * em retrato é 16:10 e passa das bordas laterais, e no fim a projeção coincide com a da tela cheia (sem salto).
 */
function screenRect(W: number, H: number, z: number): ScreenRect {
  const portrait = W / H < 1.15;
  const w0 = portrait ? W * 0.84 : W * 0.56;
  const h0 = portrait ? w0 / 1.6 : H * 0.56;
  const end = Math.max(W / w0, H / h0);
  // escala exponencial: a aproximação parece ter velocidade constante
  const scale = Math.pow(end, z);
  const cx = W / 2;
  const cy = H * (portrait ? 0.43 : 0.46) + (H / 2 - H * (portrait ? 0.43 : 0.46)) * z;
  const w = w0 * scale;
  const h = h0 * scale;
  return { x: cx - w / 2, y: cy - h / 2, w, h, scale };
}

export function CinemaPromo({ reducedMotion, finePointer }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const progressRef = useRef(0);
  const viewRef = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const lidRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const visible = useInView(sectionRef, '0px');
  const [load, setLoad] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const copy = CINEMA_PROMO;

  // carrega com uma tela de folga
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || load) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setLoad(true), {
      rootMargin: '100% 0px 100% 0px',
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [load]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !load) return;
    // um canvas (e um contexto WebGL) por instância, como nas outras cenas
    const canvas = document.createElement('canvas');
    canvas.className = 'cinema-promo__canvas-el';
    mount.append(canvas);
    let disposed = false;
    const force = new URLSearchParams(window.location.search).get('jack');
    const mobile = force ? force === 'mobile' : window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
    import('../three/cinemaPromo')
      .then(({ createCinemaPromo }) =>
        createCinemaPromo(canvas, { mobile, reduced: reducedMotion, onReady: () => !disposed && setState('ready') }),
      )
      .then((scene) => {
        if (disposed) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        const v = viewRef.current;
        scene.setScreen(v.x, v.y, v.w, v.h);
        scene.setProgress(progressRef.current);
      })
      .catch((error) => {
        console.error('[cinema-promo]', error);
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, [load, reducedMotion]);

  useEffect(() => {
    sceneRef.current?.setActive(visible);
  }, [visible, state]);

  useScrollProgress(
    sectionRef,
    stageRef,
    ({ progress }) => {
      const t = smooth(0, 1, (progress - PLAY_FROM) / (PLAY_TO - PLAY_FROM)) * 0.12 +
        Math.min(Math.max((progress - PLAY_FROM) / (PLAY_TO - PLAY_FROM), 0), 1) * 0.88;
      progressRef.current = t;
      sceneRef.current?.setProgress(t);
      const stage = stageRef.current;
      if (!stage) return;
      const panel = smooth(0.78, 0.88, progress);
      stage.style.setProperty('--panel', panel.toFixed(4));
      stage.style.setProperty('--hint', (1 - smooth(0.0, 0.05, progress)).toFixed(4));
      stage.dataset.panel = panel > 0.5 ? 'on' : 'off';

      // notebook: a tela amplia junto com o começo do filme até ocupar a viewport (a cena desenha só dentro dela)
      const z = smooth(ZOOM_FROM, ZOOM_TO, progress);
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      if (!W || !H) return;
      const r = screenRect(W, H, z);
      const portrait = W / H < 1.15;
      const bezel = (portrait ? 7 : 12) * r.scale;
      const full = z > 0.999;
      stage.style.setProperty('--zoom', z.toFixed(4));
      stage.dataset.screen = full ? 'full' : 'laptop';
      const mount = mountRef.current;
      if (mount) {
        const radius = (portrait ? 4 : 6) * (1 - z);
        const px = (v: number) => `${Math.max(0, v).toFixed(1)}px`;
        mount.style.clipPath = full
          ? ''
          : `inset(${px(r.y)} ${px(W - r.x - r.w)} ${px(H - r.y - r.h)} ${px(r.x)} round ${radius.toFixed(1)}px)`;
      }
      const lid = lidRef.current;
      if (lid) {
        lid.style.transform = `translate(${(r.x - bezel).toFixed(1)}px, ${(r.y - bezel).toFixed(1)}px)`;
        lid.style.width = `${(r.w + 2 * bezel).toFixed(1)}px`;
        lid.style.height = `${(r.h + 2 * bezel).toFixed(1)}px`;
        lid.style.setProperty('--bezel', `${bezel.toFixed(2)}px`);
        lid.style.borderRadius = `${((portrait ? 12 : 18) * r.scale).toFixed(1)}px`;
      }
      const base = baseRef.current;
      if (base) {
        const bw = (r.w + 2 * bezel) * 1.14;
        const bh = Math.max(8, (r.w + 2 * bezel) * 0.028);
        base.style.transform = `translate(${(r.x + r.w / 2 - bw / 2).toFixed(1)}px, ${(r.y + r.h + bezel - 1).toFixed(1)}px)`;
        base.style.width = `${bw.toFixed(1)}px`;
        base.style.height = `${bh.toFixed(1)}px`;
      }
      const view = full ? { x: 0, y: 0, w: 1, h: 1 } : { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H };
      viewRef.current = view;
      sceneRef.current?.setScreen(view.x, view.y, view.w, view.h);
    },
    !reducedMotion,
  );

  useEffect(() => {
    if (!finePointer || reducedMotion) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      sceneRef.current?.setPointer((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [finePointer, reducedMotion]);

  return (
    <section
      id="cinema"
      ref={sectionRef}
      className="cinema-promo"
      aria-labelledby="cinema-title"
      data-reduced={reducedMotion}
    >
      <div
        ref={stageRef}
        className="cinema-promo__stage"
        data-state={state}
        data-panel={reducedMotion ? 'on' : 'off'}
        data-screen={reducedMotion ? 'full' : 'laptop'}
      >
        <div className="cinema-promo__glow" aria-hidden="true" />
        <div
          ref={mountRef}
          className="cinema-promo__canvas"
          role="img"
          aria-label="Numa sala de cinema escura, o Pânico sai da luz da tela segurando um balde de pipoca; um vampiro de terno entra pela esquerda, estende a mão e puxa o balde no ar com um rastro roxo até a palma dele, depois pega uma Fanta Uva que flutuava à sua frente e a mostra"
        />

        {/* notebook: aro em volta da tela (só a borda, o centro fica vazado sobre o canvas) e a base */}
        <div ref={lidRef} className="cinema-promo__lid" aria-hidden="true" />
        <div ref={baseRef} className="cinema-promo__base" aria-hidden="true" />

        <p className="cinema-promo__tag" aria-hidden="true">
          <span className="cinema-promo__tag-dot" />
          {copy.kicker}
        </p>
        <p className="cinema-promo__hint" aria-hidden="true">
          Role para a sessão começar
        </p>

        <div className="cinema-promo__panel">
          <p className="cinema-promo__kicker">{copy.kicker}</p>
          <h2 id="cinema-title" className="cinema-promo__title" tabIndex={-1} data-section-focus>
            <span className="cinema-promo__line">{copy.title[0]}</span>
            <span className="cinema-promo__line">{copy.title[1]}</span>
          </h2>
          <p className="cinema-promo__lead">{copy.lead}</p>
          {copy.details.length > 0 && (
            <ul className="cinema-promo__details">
              {copy.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <a className="button cinema-promo__cta" href={copy.cta.href} target="_blank" rel="noopener noreferrer">
            {copy.cta.label}
            <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2.4" />
            </svg>
            <span className="visually-hidden"> (abre em nova aba)</span>
          </a>
          <p className="cinema-promo__note">{copy.note}</p>
        </div>
      </div>
    </section>
  );
}
